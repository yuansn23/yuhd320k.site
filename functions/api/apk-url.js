// GET /api/apk-url?site=k924uu.site — 返回对应站点的APK地址
// v2: 计数器合并为单一 KV key + 300s 冷却锁，大幅降低 KV 写入次数
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    // 优先使用 ?site= 参数（跨域前端），否则用 Referer/Host
    var site = url.searchParams.get('site') || '';
    if (!site) {
      const referer = request.headers.get('Referer') || '';
      try { site = new URL(referer).hostname; } catch (e) {}
    }
    if (!site) site = request.headers.get('Host') || '';

    const username = (await env.kvadmin.get('site:' + site)) || '';
    const prefix = username ? username + ':' : '';

    // 读取 APK URL（保持从独立 key 读取，向后兼容）
    const apkUrl = (await env.kvadmin.get(prefix + 'apk_url')) || '';

    // 非阻塞计数器更新（带冷却锁，避免 KV 写入超限）
    context.waitUntil(updateCounter(env, prefix));

    return new Response(JSON.stringify({ url: apkUrl, _site: site, _user: username || '' }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=30'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ url: '' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// 计数器更新：使用冷却锁 + 合并 JSON key
// - 冷却期 300s（5分钟），超期内跳过写入
// - 统计数据合并到单一 key: username:stats = { total, days: {"YYYY-MM-DD": N} }
// - 从原来的 2 writes/请求 → 最多 2 writes/300s = 576 writes/天（上限）
async function updateCounter(env, prefix) {
  try {
    const lockKey = prefix + 'counter_lock';
    const statsKey = prefix + 'stats';

    // 检查冷却锁（1 KV read）
    const locked = await env.kvadmin.get(lockKey);
    if (locked) return; // 冷却期内，跳过写入

    // 设置冷却锁，300s TTL（1 KV write）
    await env.kvadmin.put(lockKey, '1', { expirationTtl: 300 });

    // 读取现有统计数据（1 KV read）
    const today = new Date().toISOString().slice(0, 10);
    const statsRaw = await env.kvadmin.get(statsKey);
    const stats = statsRaw ? JSON.parse(statsRaw) : { total: 0, days: {} };

    // 递增计数器
    stats.total = (stats.total || 0) + 1;
    stats.days[today] = (stats.days[today] || 0) + 1;

    // 清理超过 60 天的旧数据，控制 JSON 体积
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const d of Object.keys(stats.days)) {
      if (d < cutoffStr) delete stats.days[d];
    }

    // 写回合并后的统计数据（1 KV write）
    await env.kvadmin.put(statsKey, JSON.stringify(stats));
  } catch (e) {
    // 计数器更新失败不影响主流程
    console.error('Counter update failed:', e.message);
  }
}

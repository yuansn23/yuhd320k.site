// GET /api/apk-url?site=k924uu.site — 返回对应站点的APK地址
// v3: 计数器迁移到 D1，告别 KV 写入限制
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    var site = url.searchParams.get('site') || '';
    if (!site) {
      const referer = request.headers.get('Referer') || '';
      try { site = new URL(referer).hostname; } catch (e) {}
    }
    if (!site) site = request.headers.get('Host') || '';

    const siteRow = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
    const username = siteRow ? siteRow.username : '';
    const prefix = username ? username + ':' : '';

    // APK URL 继续从 KV 读取（低频配置数据，无写入限额压力）
    const apkUrl = (await env.kvadmin.get(prefix + 'apk_url')) || '';

    // 计数器写入 D1 —— 非阻塞，无限额
    const today = new Date().toISOString().slice(0, 10);
    context.waitUntil(
      env.DB.prepare(
        'INSERT INTO download_counts (username, date, count) VALUES (?1, ?2, 1) ON CONFLICT (username, date) DO UPDATE SET count = count + 1'
      ).bind(username || '_anon', today).run()
    );

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

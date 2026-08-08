// GET /api/admin/my-stats — 子账户下载统计 + 上传历史
// v3: 计数器 D1 优先，KV 回退 + 自动迁移
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    // D1 优先
    var account = await env.DB.prepare('SELECT password, site FROM accounts WHERE username = ?1').bind(user).first();
    // KV 回退
    if (!account) {
      var kvRaw = await env.kvadmin.get('account:' + user);
      if (kvRaw) { account = JSON.parse(kvRaw); account.password = account.pw; }
    }
    if (!account) return null;
    if (auth !== 'Basic ' + btoa(user + ':' + role + ':' + (account.password || account.pw))) return null;
    return { user, role, site: account.site || '' };
  } catch (e) { return null; }
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const me = await getMyUser(request, env);
    if (!me) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    var total = 0;
    var daily = [];

    // 1. 并行：D1 每日数据 + KV 旧每日数据
    const past30 = new Date();
    past30.setDate(past30.getDate() - 30);
    const dateFrom = past30.toISOString().slice(0, 10);

    // 构建 KV 每日 key 列表（最近 30 天）
    var now = new Date();
    var dayKV = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKV.push({ key: me.user + ':download_' + d.toISOString().slice(0, 10), date: d.toISOString().slice(0, 10) });
    }

    const [d1Result, kvResults] = await Promise.all([
      env.DB.prepare('SELECT date, count FROM download_counts WHERE username = ?1 AND date >= ?2').bind(me.user, dateFrom).all(),
      Promise.all(dayKV.map(function(dk){ return env.kvadmin.get(dk.key); }))
    ]);

    // 2. 构建 D1 已有日期集合 + D1 每日数据
    var d1Map = {};
    if (d1Result && d1Result.results) {
      for (var r = 0; r < d1Result.results.length; r++) {
        var row = d1Result.results[r];
        d1Map[row.date] = row.count;
        total += row.count;
      }
    }

    // 3. 合并 KV 数据：D1 没有的日期用 KV 补上，并自动迁移到 D1
    var inserts = [];
    for (var j = 0; j < dayKV.length; j++) {
      var kvCount = parseInt(kvResults[j] || '0');
      if (kvCount > 0 && !d1Map[dayKV[j].date]) {
        // KV 有但 D1 没有 → 迁移
        d1Map[dayKV[j].date] = kvCount;
        total += kvCount;
        inserts.push(
          env.DB.prepare('INSERT OR IGNORE INTO download_counts (username, date, count) VALUES (?1, ?2, ?3)')
            .bind(me.user, dayKV[j].date, kvCount)
        );
      }
    }
    // 非阻塞迁移
    if (inserts.length > 0) {
      context.waitUntil(env.DB.batch(inserts).catch(function(){}));
    }

    // 4. 输出合并后的每日数据（按日期倒序）
    var dates = Object.keys(d1Map).sort().reverse();
    for (var k = 0; k < dates.length; k++) {
      daily.push({ date: dates[k], count: d1Map[dates[k]] });
    }

    // 并行读取 KV 配置数据
    const [apkUrl, historyRaw] = await Promise.all([
      env.kvadmin.get(me.user + ':apk_url'),
      env.kvadmin.get(me.user + ':apk_history')
    ]);
    const history = JSON.parse(historyRaw || '[]');

    return new Response(JSON.stringify({ total, apkUrl: apkUrl || '', history, daily, site: me.site }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=15' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

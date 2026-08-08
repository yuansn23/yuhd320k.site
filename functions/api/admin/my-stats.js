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

    // 1. 先查 D1
    const past30 = new Date();
    past30.setDate(past30.getDate() - 30);
    const dateFrom = past30.toISOString().slice(0, 10);

    const totalResult = await env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM download_counts WHERE username = ?1').bind(me.user).first();
    total = totalResult ? totalResult.total : 0;

    // 2. D1 没有数据 → KV 回退
    if (total === 0) {
      var kvTotal = parseInt((await env.kvadmin.get(me.user + ':download_count')) || '0');
      if (kvTotal > 0) {
        total = kvTotal;
        // 读取旧 KV 每日数据并迁移到 D1
        var now = new Date();
        var dayKeys = [];
        for (var i = 29; i >= 0; i--) {
          var d = new Date(now);
          d.setDate(d.getDate() - i);
          dayKeys.push({ key: me.user + ':download_' + d.toISOString().slice(0, 10), date: d.toISOString().slice(0, 10) });
        }
        var dayResults = await Promise.all(dayKeys.map(function(dk){ return env.kvadmin.get(dk.key); }));

        // 批量写入 D1
        var inserts = [];
        for (var j = 0; j < dayResults.length; j++) {
          var count = parseInt(dayResults[j] || '0');
          if (count > 0) {
            daily.push({ date: dayKeys[j].date, count: count });
            inserts.push(
              env.DB.prepare('INSERT OR IGNORE INTO download_counts (username, date, count) VALUES (?1, ?2, ?3)')
                .bind(me.user, dayKeys[j].date, count)
            );
          }
        }
        if (inserts.length > 0) {
          try { await env.DB.batch(inserts); } catch (e) {}
        }
      }
    } else {
      // D1 有数据，直接读
      var dailyResult = await env.DB.prepare('SELECT date, count FROM download_counts WHERE username = ?1 AND date >= ?2 ORDER BY date DESC').bind(me.user, dateFrom).all();
      daily = (dailyResult && dailyResult.results) ? dailyResult.results.map(function(r){ return { date: r.date, count: r.count }; }) : [];
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

// GET /api/admin/download-count — 返回下载统计（总计 + 最近30天）
// v3: D1 优先，KV 回退 + 自动迁移
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const user = env.ADMIN_USER || '';
    const pass = env.ADMIN_PASS || '';
    const auth = request.headers.get('Authorization') || '';
    if (auth !== 'Basic ' + btoa(user + ':' + pass)) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 1. D1 查询
    const past30 = new Date();
    past30.setDate(past30.getDate() - 30);
    const dateFrom = past30.toISOString().slice(0, 10);

    const [totalResult, dailyResult] = await Promise.all([
      env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM download_counts').first(),
      env.DB.prepare('SELECT date, count FROM download_counts WHERE date >= ?1 ORDER BY date DESC').bind(dateFrom).all()
    ]);

    var total = totalResult ? totalResult.total : 0;
    var daily = dailyResult && dailyResult.results ? dailyResult.results : [];

    // 2. KV 回退：D1 总数为 0 但有旧 KV 数据
    if (total === 0) {
      var kvTotal = parseInt((await env.kvadmin.get('download_count')) || '0');
      if (kvTotal > 0) {
        total = kvTotal;
        // 读取并迁移旧 KV 每日数据
        var now = new Date();
        var dayKeys = [];
        for (var i = 29; i >= 0; i--) {
          var d = new Date(now);
          d.setDate(d.getDate() - i);
          dayKeys.push({ key: 'download_' + d.toISOString().slice(0, 10), date: d.toISOString().slice(0, 10) });
        }
        var dayResults = await Promise.all(dayKeys.map(function(dk){ return env.kvadmin.get(dk.key); }));
        var inserts = [];
        var kvDaily = [];
        for (var j = 0; j < dayResults.length; j++) {
          var count = parseInt(dayResults[j] || '0');
          if (count > 0) {
            kvDaily.push({ date: dayKeys[j].date, count: count });
            inserts.push(
              env.DB.prepare('INSERT OR IGNORE INTO download_counts (username, date, count) VALUES (?1, ?2, ?3)')
                .bind('_anon', dayKeys[j].date, count)
            );
          }
        }
        daily = kvDaily;
        if (inserts.length > 0) {
          try { await env.DB.batch(inserts); } catch (e) {}
        }
      }
    }

    return new Response(JSON.stringify({ total: total, daily: daily }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ total: 0, daily: [], error: e.message }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

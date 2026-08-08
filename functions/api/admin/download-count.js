// GET /api/admin/download-count — 返回下载统计（总计 + 最近30天）
// v3: D1 + KV 合并，不丢历史数据
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

    // 构建 KV 每日 key 列表（最近 30 天）
    var past30 = new Date();
    past30.setDate(past30.getDate() - 30);
    var dateFrom = past30.toISOString().slice(0, 10);
    var now = new Date();
    var dayKV = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKV.push({ key: 'download_' + d.toISOString().slice(0, 10), date: d.toISOString().slice(0, 10) });
    }

    // 并行：D1 + KV
    const [d1Result, kvResults] = await Promise.all([
      env.DB.prepare('SELECT date, count FROM download_counts WHERE date >= ?1').bind(dateFrom).all(),
      Promise.all(dayKV.map(function(dk){ return env.kvadmin.get(dk.key); }))
    ]);

    // 合并：D1 优先，KV 补漏
    var d1Map = {};
    var total = 0;
    if (d1Result && d1Result.results) {
      for (var r = 0; r < d1Result.results.length; r++) {
        var row = d1Result.results[r];
        d1Map[row.date] = row.count;
        total += row.count;
      }
    }

    var inserts = [];
    for (var j = 0; j < dayKV.length; j++) {
      var kvCount = parseInt(kvResults[j] || '0');
      if (kvCount > 0 && !d1Map[dayKV[j].date]) {
        d1Map[dayKV[j].date] = kvCount;
        total += kvCount;
        inserts.push(
          env.DB.prepare('INSERT OR IGNORE INTO download_counts (username, date, count) VALUES (?1, ?2, ?3)')
            .bind('_anon', dayKV[j].date, kvCount)
        );
      }
    }
    if (inserts.length > 0) {
      context.waitUntil(env.DB.batch(inserts).catch(function(){}));
    }

    var dates = Object.keys(d1Map).sort().reverse();
    var daily = [];
    for (var k = 0; k < dates.length; k++) {
      daily.push({ date: dates[k], count: d1Map[dates[k]] });
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

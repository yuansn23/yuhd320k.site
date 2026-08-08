// GET /api/admin/download-count — 返回下载统计（总计 + 最近30天）
// v3: 从 D1 读取统计数据
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

    const past30 = new Date();
    past30.setDate(past30.getDate() - 30);
    const dateFrom = past30.toISOString().slice(0, 10);

    // 并行：总数 + 每日明细
    const [totalResult, dailyResult] = await Promise.all([
      env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM download_counts').first(),
      env.DB.prepare('SELECT date, count FROM download_counts WHERE date >= ?1 ORDER BY date DESC').bind(dateFrom).all()
    ]);

    const total = totalResult ? totalResult.total : 0;
    const daily = dailyResult && dailyResult.results ? dailyResult.results : [];

    return new Response(JSON.stringify({
      total: total,
      daily: daily.map(function(r){ return { date: r.date, count: r.count }; })
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ total: 0, daily: [], error: e.message }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

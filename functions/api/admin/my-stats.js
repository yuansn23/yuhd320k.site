// GET /api/admin/my-stats — 子账户下载统计 + 上传历史
// v3: 计数器从 D1 读取，配置从 KV 读取
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    const account = await env.DB.prepare('SELECT password, site FROM accounts WHERE username = ?1').bind(user).first();
    if (!account) return null;
    if (auth !== 'Basic ' + btoa(user + ':' + role + ':' + account.password)) return null;
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

    // 并行：D1 统计 + KV 配置 + KV 历史
    const past30 = new Date();
    past30.setDate(past30.getDate() - 30);
    const dateFrom = past30.toISOString().slice(0, 10);

    const [totalResult, dailyResult, apkUrl, historyRaw] = await Promise.all([
      env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM download_counts WHERE username = ?1').bind(me.user).first(),
      env.DB.prepare('SELECT date, count FROM download_counts WHERE username = ?1 AND date >= ?2 ORDER BY date DESC').bind(me.user, dateFrom).all(),
      env.kvadmin.get(me.user + ':apk_url'),
      env.kvadmin.get(me.user + ':apk_history')
    ]);

    const total = totalResult ? totalResult.total : 0;
    const daily = dailyResult && dailyResult.results ? dailyResult.results : [];
    const history = JSON.parse(historyRaw || '[]');

    return new Response(JSON.stringify({
      total,
      apkUrl: apkUrl || '',
      history,
      daily: daily.map(function(r){ return { date: r.date, count: r.count }; }),
      site: me.site
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=15' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

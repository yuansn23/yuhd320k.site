// GET /api/admin/my-stats — 子账户下载统计 + 上传历史
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    const raw = await env.kvadmin.get('account:' + user);
    if (!raw) return null;
    const account = JSON.parse(raw);
    if (auth !== 'Basic ' + btoa(user + ':' + role + ':' + account.pw)) return null;
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
    const prefix = me.user + ':';

    // 并行读取基础数据
    const [totalRaw, apkUrl, historyRaw] = await Promise.all([
      env.kvadmin.get(prefix + 'download_count'),
      env.kvadmin.get(prefix + 'apk_url'),
      env.kvadmin.get(prefix + 'apk_history')
    ]);
    const total = parseInt(totalRaw || '0');
    const history = JSON.parse(historyRaw || '[]');

    // 并行读取30天每日统计
    var daily = [];
    var now = new Date();
    var dayKeys = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKeys.push({ key: prefix + 'download_' + d.toISOString().slice(0, 10), date: d.toISOString().slice(0, 10) });
    }
    var dayResults = await Promise.all(dayKeys.map(function(dk){ return env.kvadmin.get(dk.key); }));
    for (var j = 0; j < dayResults.length; j++) {
      var count = parseInt(dayResults[j] || '0');
      if (count > 0) daily.push({ date: dayKeys[j].date, count: count });
    }

    return new Response(JSON.stringify({ total, apkUrl: apkUrl || '', history, daily, site: me.site }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

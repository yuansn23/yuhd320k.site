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

    const total = parseInt((await env.kvadmin.get(prefix + 'download_count')) || '0');
    const apkUrl = (await env.kvadmin.get(prefix + 'apk_url')) || '';
    const history = JSON.parse((await env.kvadmin.get(prefix + 'apk_history')) || '[]');

    // 每日统计（近30天）
    var daily = [];
    var now = new Date();
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      var key = prefix + 'download_' + d.toISOString().slice(0, 10);
      var count = parseInt((await env.kvadmin.get(key)) || '0');
      if (count > 0) daily.push({ date: key.replace(prefix + 'download_', ''), count });
    }

    return new Response(JSON.stringify({ total, apkUrl, history, daily, site: me.site }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

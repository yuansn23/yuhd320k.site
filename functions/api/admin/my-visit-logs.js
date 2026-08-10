// GET /api/admin/my-visit-logs — 子账户查看自己落地页的访问流量
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    var account = await env.DB.prepare('SELECT password FROM accounts WHERE username = ?1').bind(user).first();
    if (!account) { var kvRaw = await env.kvadmin.get('account:' + user); if (kvRaw) { account = JSON.parse(kvRaw); account.password = account.pw; } }
    if (!account) return null;
    if (auth !== 'Basic ' + btoa(user + ':' + role + ':' + (account.password || account.pw))) return null;
    return { user, role };
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

    const url = new URL(request.url);
    const filterSite = url.searchParams.get('site') || '';
    const dateStart = url.searchParams.get('start') || '';
    const dateEnd = url.searchParams.get('end') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500);

    var result;
    // 6 种组合：site + start + end, site + start, site + end, start + end, site only, none
    if (filterSite && dateStart && dateEnd) {
      result = await env.DB.prepare('SELECT site, visit_time, ip, device, lang, media FROM visit_logs WHERE username = ?1 AND site = ?2 AND visit_time >= ?3 AND visit_time <= ?4 ORDER BY visit_time DESC LIMIT ?5')
        .bind(me.user, filterSite, dateStart + 'T00:00:00.000Z', dateEnd + 'T23:59:59.999Z', limit).all();
    } else if (filterSite && dateStart) {
      result = await env.DB.prepare('SELECT site, visit_time, ip, device, lang, media FROM visit_logs WHERE username = ?1 AND site = ?2 AND visit_time >= ?3 ORDER BY visit_time DESC LIMIT ?4')
        .bind(me.user, filterSite, dateStart + 'T00:00:00.000Z', limit).all();
    } else if (filterSite && dateEnd) {
      result = await env.DB.prepare('SELECT site, visit_time, ip, device, lang, media FROM visit_logs WHERE username = ?1 AND site = ?2 AND visit_time <= ?3 ORDER BY visit_time DESC LIMIT ?4')
        .bind(me.user, filterSite, dateEnd + 'T23:59:59.999Z', limit).all();
    } else if (dateStart && dateEnd) {
      result = await env.DB.prepare('SELECT site, visit_time, ip, device, lang, media FROM visit_logs WHERE username = ?1 AND visit_time >= ?2 AND visit_time <= ?3 ORDER BY visit_time DESC LIMIT ?4')
        .bind(me.user, dateStart + 'T00:00:00.000Z', dateEnd + 'T23:59:59.999Z', limit).all();
    } else if (dateStart) {
      result = await env.DB.prepare('SELECT site, visit_time, ip, device, lang, media FROM visit_logs WHERE username = ?1 AND visit_time >= ?2 ORDER BY visit_time DESC LIMIT ?3')
        .bind(me.user, dateStart + 'T00:00:00.000Z', limit).all();
    } else if (filterSite) {
      result = await env.DB.prepare('SELECT site, visit_time, ip, device, lang, media FROM visit_logs WHERE username = ?1 AND site = ?2 ORDER BY visit_time DESC LIMIT ?3')
        .bind(me.user, filterSite, limit).all();
    } else {
      result = await env.DB.prepare('SELECT site, visit_time, ip, device, lang, media FROM visit_logs WHERE username = ?1 ORDER BY visit_time DESC LIMIT ?2')
        .bind(me.user, limit).all();
    }

    var logs = result && result.results ? result.results : [];

    return new Response(JSON.stringify({ logs: logs, total: logs.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

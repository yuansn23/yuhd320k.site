// GET /api/admin/my-click-logs — 子账户点击统计
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    var account = await env.DB.prepare('SELECT password, site FROM accounts WHERE username = ?1').bind(user).first();
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

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page')) || 1;
    const siteFilter = url.searchParams.get('site') || '';
    const limit = 50;
    const offset = (page - 1) * limit;

    var total = 0;
    var rows = [];

    // 统计总数
    if (siteFilter) {
      var tc = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM click_logs WHERE username = ?1 AND site = ?2').bind(me.user, siteFilter).first();
    } else {
      var tc = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM click_logs WHERE username = ?1').bind(me.user).first();
    }
    total = tc ? tc.cnt : 0;

    // 分页查询
    if (siteFilter) {
      var rr = await env.DB.prepare('SELECT click_time, site, ip, device, lang FROM click_logs WHERE username = ?1 AND site = ?2 ORDER BY click_time DESC LIMIT ?3 OFFSET ?4').bind(me.user, siteFilter, limit, offset).all();
    } else {
      var rr = await env.DB.prepare('SELECT click_time, site, ip, device, lang FROM click_logs WHERE username = ?1 ORDER BY click_time DESC LIMIT ?2 OFFSET ?3').bind(me.user, limit, offset).all();
    }
    rows = (rr && rr.results) ? rr.results : [];

    // 获取用户的站点列表用作筛选下拉
    var sites = [];
    try {
      var sr = await env.DB.prepare('SELECT site FROM account_sites WHERE username = ?1').bind(me.user).all();
      if (sr && sr.results) sites = sr.results.map(function(r){ return r.site; });
      if (!sites.length && me.site) sites = [me.site];
    } catch (e) {}

    return new Response(JSON.stringify({ total: total, page: page, pageSize: limit, rows: rows, sites: sites }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=15' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

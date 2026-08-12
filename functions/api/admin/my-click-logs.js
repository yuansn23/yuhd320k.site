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
    const filterSite = url.searchParams.get('site') || '';
    const dateStart = url.searchParams.get('start') || '';
    const dateEnd = url.searchParams.get('end') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const page = Math.max(parseInt(url.searchParams.get('page') || '1'), 1);
    const offset = (page - 1) * limit;

    // 动态构建 WHERE
    var whereBase = 'username = ?1';
    var condParams = [me.user];
    var idx = 2;
    if (filterSite) { whereBase += ' AND site = ?' + (idx++); condParams.push(filterSite); }
    if (dateStart) { whereBase += ' AND click_time >= ?' + (idx++); condParams.push(dateStart + 'T00:00:00.000Z'); }
    if (dateEnd) { whereBase += ' AND click_time <= ?' + (idx++); condParams.push(dateEnd + 'T23:59:59.999Z'); }

    // 统计总数（表可能不存在，兜底返回 0）
    var total = 0;
    try {
      var countSql = 'SELECT COUNT(*) AS cnt FROM click_logs WHERE ' + whereBase;
      var countResult = null;
      if (condParams.length === 1) countResult = await env.DB.prepare(countSql).bind(condParams[0]).first();
      else if (condParams.length === 2) countResult = await env.DB.prepare(countSql).bind(condParams[0], condParams[1]).first();
      else if (condParams.length === 3) countResult = await env.DB.prepare(countSql).bind(condParams[0], condParams[1], condParams[2]).first();
      else countResult = await env.DB.prepare(countSql).bind(condParams[0], condParams[1], condParams[2], condParams[3]).first();
      total = countResult ? countResult.cnt : 0;
    } catch (e) {}

    // 分页查询（表可能不存在，兜底返回空）
    var rows = [];
    try {
      var dataSql = 'SELECT click_time, site, ip, device, lang FROM click_logs WHERE ' + whereBase + ' ORDER BY click_time DESC LIMIT ?' + (idx++) + ' OFFSET ?' + (idx++);
      var allParams = condParams.concat([limit, offset]);
      var result = null;
      if (allParams.length === 3) result = await env.DB.prepare(dataSql).bind(allParams[0], allParams[1], allParams[2]).all();
      else if (allParams.length === 4) result = await env.DB.prepare(dataSql).bind(allParams[0], allParams[1], allParams[2], allParams[3]).all();
      else if (allParams.length === 5) result = await env.DB.prepare(dataSql).bind(allParams[0], allParams[1], allParams[2], allParams[3], allParams[4]).all();
      else result = await env.DB.prepare(dataSql).bind(allParams[0], allParams[1], allParams[2], allParams[3], allParams[4], allParams[5]).all();
      if (result && result.results) rows = result.results;
    } catch (e) {}

    // 获取用户的站点列表（独立查询，不受 click_logs 表是否存在影响）
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

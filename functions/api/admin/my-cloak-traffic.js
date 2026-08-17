// GET /api/admin/my-cloak-traffic — 子账户斗篷流量访问列表（独立表 cloak_traffic）
// 参数：site / start / end / result(pass|fail) / limit / page

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
    var cloakEnabled = 0;
    try { var cr = await env.DB.prepare('SELECT cloak_enabled FROM accounts WHERE username = ?1').bind(user).first(); cloakEnabled = (cr && cr.cloak_enabled) ? 1 : 0; } catch (e) {}
    return { user, role, site: account.site || '', cloak_enabled: cloakEnabled };
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
    const result = url.searchParams.get('result') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const page = Math.max(parseInt(url.searchParams.get('page') || '1'), 1);
    const offset = (page - 1) * limit;

    // 动态 WHERE
    var where = 'username = ?1';
    var cond = [me.user];
    var idx = 2;
    if (filterSite) { where += ' AND site = ?' + (idx++); cond.push(filterSite); }
    if (dateStart) { where += ' AND created_at >= ?' + (idx++); cond.push(dateStart + 'T00:00:00.000Z'); }
    if (dateEnd) { where += ' AND created_at <= ?' + (idx++); cond.push(dateEnd + 'T23:59:59.999Z'); }
    if (result === 'pass' || result === '1') { where += ' AND passed = 1'; }
    else if (result === 'fail' || result === '0') { where += ' AND passed = 0'; }

    // 总数（表可能不存在，兜底 0）
    var total = 0;
    try {
      var cnt = null;
      var cs = 'SELECT COUNT(*) AS cnt FROM cloak_traffic WHERE ' + where;
      if (cond.length === 1) cnt = await env.DB.prepare(cs).bind(cond[0]).first();
      else if (cond.length === 2) cnt = await env.DB.prepare(cs).bind(cond[0], cond[1]).first();
      else if (cond.length === 3) cnt = await env.DB.prepare(cs).bind(cond[0], cond[1], cond[2]).first();
      else cnt = await env.DB.prepare(cs).bind(cond[0], cond[1], cond[2], cond[3]).first();
      total = cnt ? cnt.cnt : 0;
    } catch (e) {}

    // 分页查询
    var rows = [];
    try {
      var ds = 'SELECT site, ip, device, terminal, lang, timezone, is_vpn, is_proxy, passed, triggered_rules, created_at FROM cloak_traffic WHERE ' + where + ' ORDER BY created_at DESC LIMIT ?' + (idx++) + ' OFFSET ?' + (idx++);
      var all = cond.concat([limit, offset]);
      var res = null;
      if (all.length === 3) res = await env.DB.prepare(ds).bind(all[0], all[1], all[2]).all();
      else if (all.length === 4) res = await env.DB.prepare(ds).bind(all[0], all[1], all[2], all[3]).all();
      else if (all.length === 5) res = await env.DB.prepare(ds).bind(all[0], all[1], all[2], all[3], all[4]).all();
      else res = await env.DB.prepare(ds).bind(all[0], all[1], all[2], all[3], all[4], all[5]).all();
      if (res && res.results) rows = res.results.map(function (r) {
        var trig = [];
        try { trig = JSON.parse(r.triggered_rules || '[]'); } catch (e) {}
        return {
          site: r.site, ip: r.ip, device: r.device, terminal: r.terminal, lang: r.lang, timezone: r.timezone,
          is_vpn: r.is_vpn, is_proxy: r.is_proxy, passed: r.passed, triggered: trig, created_at: r.created_at
        };
      });
    } catch (e) {}

    return new Response(JSON.stringify({ total: total, page: page, pageSize: limit, rows: rows }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=15' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

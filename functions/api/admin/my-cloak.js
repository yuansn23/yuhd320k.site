// GET/POST /api/admin/my-cloak?site=xxx — 子账户斗篷设置（按落地页隔离，独立表 cloak_configs）
// 子账户只能配置/读取自己名下的落地页。

const DEFAULT_RULES = {
  crawler: { enabled: true, engines: ['google', 'facebook', 'tiktok'] },
  device: { enabled: false, mode: 'block', list: ['android', 'ios', 'pc', 'mac'] },
  language: { enabled: false, mode: 'block', list: [] },
  timezone: { enabled: false, mode: 'block', list: ['+8'] },
  block_ips: { enabled: false, list: [] },
  vpn: { enabled: false },
  proxy: { enabled: false },
  behavior: {
    scroll_depth: { enabled: false, threshold: 90 },
    mouse_curve: { enabled: false },
    touch_continuity: { enabled: false },
    visibility: { enabled: false },
    scroll_rhythm: { enabled: false }
  },
  extra: {}
};

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

async function getUserSites(env, me) {
  var sites = [];
  try {
    var sr = await env.DB.prepare('SELECT site FROM account_sites WHERE username = ?1').bind(me.user).all();
    if (sr && sr.results) sites = sr.results.map(function (r) { return r.site; });
  } catch (e) {}
  if (!sites.length && me.site) sites = [me.site];
  return sites;
}

function parseJson(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      }});
    }

    const me = await getMyUser(request, env);
    if (!me) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── GET ──
    if (request.method === 'GET') {
      var qSite = (new URL(request.url)).searchParams.get('site') || '';
      var sites = await getUserSites(env, me);

      // 无 site 参数 → 返回该子账户名下所有站点的斗篷配置（含未配置的默认态）
      if (!qSite) {
        var list = [];
        for (var i = 0; i < sites.length; i++) {
          var row0 = null;
          try { row0 = await env.DB.prepare('SELECT enabled, fallback_url, whitelist_ips, rules, updated_at FROM cloak_configs WHERE site = ?1').bind(sites[i]).first(); } catch (e) {}
          list.push({
            site: sites[i],
            enabled: row0 ? row0.enabled : 0,
            fallback_url: row0 ? (row0.fallback_url || 'https://www.google.com') : 'https://www.google.com',
            whitelist_ips: row0 ? parseJson(row0.whitelist_ips, []) : [],
            rules: row0 ? parseJson(row0.rules, DEFAULT_RULES) : DEFAULT_RULES,
            updated_at: row0 ? row0.updated_at : ''
          });
        }
        return new Response(JSON.stringify({ sites: sites, configs: list, cloak_enabled: me.cloak_enabled }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // 校验归属
      if (sites.indexOf(qSite) === -1) {
        return new Response(JSON.stringify({ error: '无权访问该站点' }), {
          status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      var row = null;
      try { row = await env.DB.prepare('SELECT enabled, fallback_url, whitelist_ips, rules, updated_at FROM cloak_configs WHERE site = ?1').bind(qSite).first(); } catch (e) {}
      return new Response(JSON.stringify({
        site: qSite,
        cloak_enabled: me.cloak_enabled,
        enabled: row ? row.enabled : 0,
        fallback_url: row ? (row.fallback_url || 'https://www.google.com') : 'https://www.google.com',
        whitelist_ips: row ? parseJson(row.whitelist_ips, []) : [],
        rules: row ? parseJson(row.rules, DEFAULT_RULES) : DEFAULT_RULES,
        updated_at: row ? row.updated_at : ''
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST ──
    if (request.method === 'POST') {
      const body = await request.json();

      // 斗篷权限校验：未开通权限的子账户不能保存/修改斗篷规则（只读查询不受限）
      if (me.role !== 'admin' && !me.cloak_enabled) {
        return new Response(JSON.stringify({ ok: false, error: '斗篷功能未开通，请联系管理员开通', code: 'CLOAK_DISABLED' }), {
          status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const site = (body.site || '').trim();
      if (!site) {
        return new Response(JSON.stringify({ ok: false, error: '缺少站点' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      var mySites = await getUserSites(env, me);
      if (mySites.indexOf(site) === -1) {
        return new Response(JSON.stringify({ ok: false, error: '无权配置该站点' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }

      var enabled = (body.enabled === true || body.enabled === 1) ? 1 : 0;
      var fallback = (body.fallback_url || '').trim() || 'https://www.google.com';
      var whitelist = Array.isArray(body.whitelist_ips) ? body.whitelist_ips.map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
      var rules = (body.rules && typeof body.rules === 'object') ? body.rules : DEFAULT_RULES;
      var now = new Date().toISOString();

      try {
        await env.DB.prepare('INSERT INTO cloak_configs (site, enabled, fallback_url, whitelist_ips, rules, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(site) DO UPDATE SET enabled = excluded.enabled, fallback_url = excluded.fallback_url, whitelist_ips = excluded.whitelist_ips, rules = excluded.rules, updated_at = excluded.updated_at')
          .bind(site, enabled, fallback, JSON.stringify(whitelist), JSON.stringify(rules), now).run();
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: '斗篷配置保存失败: ' + (e && e.message ? e.message : String(e)) }), {
          status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response(JSON.stringify({ ok: true, site: site }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// GET/POST /api/admin/my-dp — 子账户 DP配置 读写（独立表 dp_configs）
// 子账户只能配置/读取自己名下的落地页。
// 无账号级权限开关（每个子账户都可用），与 AB页(my-ab.js)完全独立。

const DEFAULT_RULES = {
  crawler: { enabled: true, engines: ['google', 'facebook', 'tiktok'] },
  device: { enabled: false, mode: 'block', list: ['android', 'ios', 'pc', 'mac'] },
  language: { enabled: false, mode: 'block', list: [] },
  timezone: { enabled: false, mode: 'block', list: ['+8'] },
  block_ips: { enabled: false, list: [] },
  privacy: { enabled: false },
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
    return { user, role, site: account.site || '' };
  } catch (e) { return null; }
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

    // ── GET — 返回名下所有 DP 配置 ──
    if (request.method === 'GET') {
      var list = [];
      try {
        var res = await env.DB.prepare('SELECT site, enabled, actual_url, fallback_url, whitelist_ips, rules, updated_at FROM dp_configs WHERE username = ?1 ORDER BY updated_at DESC').bind(me.user).all();
        if (res && res.results) {
          list = res.results.map(function (r) {
            return {
              site: r.site,
              enabled: r.enabled,
              actual_url: r.actual_url || '',
              fallback_url: r.fallback_url || '',
              whitelist_ips: parseJson(r.whitelist_ips, []),
              rules: parseJson(r.rules, DEFAULT_RULES),
              updated_at: r.updated_at || ''
            };
          });
        }
      } catch (e) {}
      return new Response(JSON.stringify({ configs: list }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST — 保存 DP 配置 ──
    if (request.method === 'POST') {
      const body = await request.json();

      const site = (body.site || '').trim();
      if (!site) {
        return new Response(JSON.stringify({ ok: false, error: '请填写落地页地址' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }

      var enabled = (body.enabled === true || body.enabled === 1) ? 1 : 0;
      var actualUrl = (body.actual_url || '').trim();
      var fallbackUrl = (body.fallback_url || '').trim();
      var whitelist = Array.isArray(body.whitelist_ips) ? body.whitelist_ips.map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
      var rules = (body.rules && typeof body.rules === 'object') ? body.rules : DEFAULT_RULES;
      var now = new Date().toISOString();

      try {
        await env.DB.prepare('INSERT INTO dp_configs (site, username, enabled, actual_url, fallback_url, whitelist_ips, rules, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(site) DO UPDATE SET username = excluded.username, enabled = excluded.enabled, actual_url = excluded.actual_url, fallback_url = excluded.fallback_url, whitelist_ips = excluded.whitelist_ips, rules = excluded.rules, updated_at = excluded.updated_at')
          .bind(site, me.user, enabled, actualUrl, fallbackUrl, JSON.stringify(whitelist), JSON.stringify(rules), now).run();
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'DP 配置保存失败: ' + (e && e.message ? e.message : String(e)) }), {
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

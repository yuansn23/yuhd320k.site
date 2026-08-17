// GET/POST /api/admin/my-ab — 子账户 AB页+斗篷 配置（独立表 ab_configs）
// 子账户只能配置/读取自己名下的 A 页（审核页）。
// 权限：ab_permissions 表，默认关闭，管理员开启后子账户才能保存。

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
    var abEnabled = 0;
    try { var ar = await env.DB.prepare('SELECT enabled FROM ab_permissions WHERE username = ?1').bind(user).first(); abEnabled = (ar && ar.enabled === 1) ? 1 : 0; } catch (e) {}
    return { user, role, site: account.site || '', ab_enabled: abEnabled };
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

    // ── GET — 返回名下所有 AB 配置 + 当前 AB 权限（只读，不受权限限制）──
    if (request.method === 'GET') {
      var list = [];
      try {
        var res = await env.DB.prepare('SELECT a_url, enabled, b_url, whitelist_ips, rules, updated_at FROM ab_configs WHERE username = ?1 ORDER BY updated_at DESC').bind(me.user).all();
        if (res && res.results) {
          list = res.results.map(function (r) {
            return {
              a_url: r.a_url,
              enabled: r.enabled,
              b_url: r.b_url || '',
              whitelist_ips: parseJson(r.whitelist_ips, []),
              rules: parseJson(r.rules, DEFAULT_RULES),
              updated_at: r.updated_at || ''
            };
          });
        }
      } catch (e) {}
      return new Response(JSON.stringify({ ab_enabled: me.ab_enabled, configs: list }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST — 保存 AB 配置 ──
    if (request.method === 'POST') {
      const body = await request.json();

      // AB 权限校验：未开通权限的子账户不能保存/修改 AB 配置（只读查询不受限）
      if (me.role !== 'admin' && !me.ab_enabled) {
        return new Response(JSON.stringify({ ok: false, error: 'AB页斗篷功能未开通，请联系管理员开通', code: 'AB_DISABLED' }), {
          status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const aUrl = (body.a_url || '').trim();
      if (!aUrl) {
        return new Response(JSON.stringify({ ok: false, error: '请填写 A 页地址' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }

      var enabled = (body.enabled === true || body.enabled === 1) ? 1 : 0;
      var bUrl = (body.b_url || '').trim();
      var whitelist = Array.isArray(body.whitelist_ips) ? body.whitelist_ips.map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
      var rules = (body.rules && typeof body.rules === 'object') ? body.rules : DEFAULT_RULES;
      var now = new Date().toISOString();

      try {
        await env.DB.prepare('INSERT INTO ab_configs (a_url, username, enabled, b_url, whitelist_ips, rules, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(a_url) DO UPDATE SET username = excluded.username, enabled = excluded.enabled, b_url = excluded.b_url, whitelist_ips = excluded.whitelist_ips, rules = excluded.rules, updated_at = excluded.updated_at')
          .bind(aUrl, me.user, enabled, bUrl, JSON.stringify(whitelist), JSON.stringify(rules), now).run();
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'AB 配置保存失败: ' + (e && e.message ? e.message : String(e)) }), {
          status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response(JSON.stringify({ ok: true, a_url: aUrl }), {
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

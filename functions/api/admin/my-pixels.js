// GET/POST /api/admin/my-pixels?site=xxx — 子账户像素管理（支持多落地页）
// v6: 按站点读写 account_sites 表
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
      var qSite = (new URL(request.url)).searchParams.get('site') || me.site || '';
      var ids = [];
      // 从 account_sites 读（站点存在就用它的，空就是空）
      var siteExists = false;
      if (qSite) {
        try {
          var row = await env.DB.prepare('SELECT pixel_ids FROM account_sites WHERE site = ?1 AND username = ?2').bind(qSite, me.user).first();
          if (row) { siteExists = true; ids = JSON.parse(row.pixel_ids || '[]'); }
        } catch (e) {}
      }
      // 站点不在 account_sites 才回退 accounts 表
      if (!siteExists) {
        try {
          var acc = await env.DB.prepare('SELECT pixel_ids FROM accounts WHERE username = ?1').bind(me.user).first();
          if (acc && acc.pixel_ids) ids = JSON.parse(acc.pixel_ids);
        } catch (e) {}
      }
      // KV 回退（仅站点不存在且 accounts 也无数据时）
      if (!ids.length && !siteExists) {
        try { var raw = await env.kvadmin.get(me.user + ':pixel_ids'); if (raw) ids = JSON.parse(raw); } catch (e) {}
      }
      return new Response(JSON.stringify({ ids: ids }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST ──
    if (request.method === 'POST') {
      const body = await request.json();
      const site = body.site || me.site || '';
      const ids = Array.isArray(body.ids) ? body.ids.filter(function(id){ return /^\d{10,20}$/.test(id); }) : [];
      var idsJson = JSON.stringify(ids);

      if (site) {
        // 写入 account_sites（按站点隔离，不污染 accounts 共享表）
        // 不用 ON CONFLICT 上插（表若无 (site,username) 唯一约束会报错被吞，导致新账户写不进去），改为显式「查→更/插」
        try {
          var existingRow = await env.DB.prepare('SELECT 1 AS found FROM account_sites WHERE site = ?1 AND username = ?2').bind(site, me.user).first();
          if (existingRow) {
            await env.DB.prepare('UPDATE account_sites SET pixel_ids = ?1, config_version = config_version + 1 WHERE site = ?2 AND username = ?3').bind(idsJson, site, me.user).run();
          } else {
            await env.DB.prepare('INSERT INTO account_sites (site, username, pixel_ids, apk_url, apk_history, config_version) VALUES (?1, ?2, ?3, ?4, ?5, 1)').bind(site, me.user, idsJson, '', '[]').run();
          }
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: '像素保存失败: ' + (e && e.message ? e.message : String(e)) }), {
            status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }

      return new Response(JSON.stringify({ ok: true, ids: ids, count: ids.length }), {
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

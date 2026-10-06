// GET/POST /api/admin/ab-perm — 管理员管理子账户的 AB页斗篷 权限
// 独立于 accounts.js，不改动任何既有接口。权限存独立表 ab_permissions（默认关闭）。

function getAuthUser(request) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    return { user: parts[0], role: parts[1] };
  } catch (e) { return null; }
}

async function checkAdmin(request, env) {
  const u = getAuthUser(request);
  if (!u || u.role !== 'admin') return false;
  const account = await env.DB.prepare('SELECT password FROM accounts WHERE username = ?1 AND role = ?2').bind(u.user, 'admin').first();
  if (!account) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth === 'Basic ' + btoa(u.user + ':admin:' + account.password);
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

    if (!(await checkAdmin(request, env))) {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), {
        status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── GET — 返回全部子账户 + 各自 AB 权限 ──
    if (request.method === 'GET') {
      var list = [];
      try {
        var users = await env.DB.prepare('SELECT username, site FROM accounts WHERE role = ?1 ORDER BY created DESC').bind('user').all();
        var permMap = {};
        try {
          var pr = await env.DB.prepare('SELECT username, enabled FROM ab_permissions').all();
          if (pr && pr.results) {
            for (var i = 0; i < pr.results.length; i++) permMap[pr.results[i].username] = pr.results[i].enabled === 1 ? 1 : 0;
          }
        } catch (e) {}
        if (users && users.results) {
          list = users.results.map(function (u) {
            return { username: u.username, site: u.site || '', ab_enabled: permMap[u.username] || 0 };
          });
        }
      } catch (e) {}
      return new Response(JSON.stringify(list), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST — 翻转 AB 权限 ──
    if (request.method === 'POST') {
      const body = await request.json();
      const username = (body.username || '').trim();
      const action = body.action;
      if (!username || action !== 'toggle') {
        return new Response(JSON.stringify({ error: '参数错误' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      var acc = null;
      try { acc = await env.DB.prepare('SELECT username FROM accounts WHERE username = ?1 AND role = ?2').bind(username, 'user').first(); } catch (e) {}
      if (!acc) {
        return new Response(JSON.stringify({ error: '子账户不存在' }), {
          status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      var cur = 0;
      try { var cr = await env.DB.prepare('SELECT enabled FROM ab_permissions WHERE username = ?1').bind(username).first(); cur = (cr && cr.enabled === 1) ? 1 : 0; } catch (e) {}
      var next = cur ? 0 : 1;
      await env.DB.prepare('INSERT INTO ab_permissions (username, enabled) VALUES (?1, ?2) ON CONFLICT(username) DO UPDATE SET enabled = excluded.enabled').bind(username, next).run();
      return new Response(JSON.stringify({ ok: true, username: username, ab_enabled: next, msg: next ? '已开启AB页斗篷权限' : '已关闭AB页斗篷权限' }), {
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

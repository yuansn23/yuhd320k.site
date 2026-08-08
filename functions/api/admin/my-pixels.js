// GET/POST /api/admin/my-pixels — 子账户管理自己的像素ID
// v3: 像素存储 D1 优先，KV 回退 + 自动迁移
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
    const prefix = me.user + ':';

    // ── GET ──
    if (request.method === 'GET') {
      var ids = [];
      // 1. D1 优先
      try {
        var row = await env.DB.prepare('SELECT pixel_ids FROM accounts WHERE username = ?1').bind(me.user).first();
        if (row && row.pixel_ids) {
          ids = JSON.parse(row.pixel_ids);
        }
      } catch (e) {}

      // 2. KV 回退
      if (!ids.length) {
        try {
          var raw = await env.kvadmin.get(prefix + 'pixel_ids');
          if (raw) {
            ids = JSON.parse(raw);
            // 自动迁移到 D1
            if (ids.length) {
              context.waitUntil(
                env.DB.prepare('UPDATE accounts SET pixel_ids = ?1 WHERE username = ?2').bind(raw, me.user).run().catch(function(){})
              );
            }
          }
        } catch (e) {}
      }

      return new Response(JSON.stringify({ ids: ids }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST ──
    if (request.method === 'POST') {
      const body = await request.json();
      const ids = Array.isArray(body.ids) ? body.ids.filter(function(id){ return /^\d{10,20}$/.test(id); }) : [];
      var idsJson = JSON.stringify(ids);

      // 写入：D1 优先，失败则走 KV（兼容未执行 ALTER TABLE 的情况）
      var d1Ok = false;
      try {
        await env.DB.prepare('UPDATE accounts SET pixel_ids = ?1 WHERE username = ?2').bind(idsJson, me.user).run();
        d1Ok = true;
      } catch (e) {}
      if (!d1Ok) {
        await env.kvadmin.put(prefix + 'pixel_ids', idsJson);
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

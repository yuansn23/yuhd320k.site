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

      // 写入 D1：先尝试完整写入（含版本号），列不存在时回退
      try {
        await env.DB.prepare('UPDATE accounts SET pixel_ids = ?1, config_version = config_version + 1 WHERE username = ?2').bind(idsJson, me.user).run();
      } catch (e1) {
        try {
          await env.DB.prepare('UPDATE accounts SET pixel_ids = ?1 WHERE username = ?2').bind(idsJson, me.user).run();
        } catch (e2) {
          await env.kvadmin.put(prefix + 'pixel_ids', idsJson);
        }
      }

      // 清 CDN 缓存，立即生效
      if (me.site && env.CF_API_TOKEN && env.CF_ZONE_ID) {
        var purgeUrl = new URL(request.url).origin + '/api/pixels?site=' + encodeURIComponent(me.site);
        context.waitUntil(purgeCDN(env, purgeUrl));
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

// Cloudflare CDN 缓存清除
async function purgeCDN(env, url) {
  try {
    await fetch('https://api.cloudflare.com/client/v4/zones/' + env.CF_ZONE_ID + '/purge_cache', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.CF_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files: [url] })
    });
  } catch (e) { /* 清缓存失败不影响主流程 */ }
}

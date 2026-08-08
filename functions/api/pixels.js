// GET /api/pixels?site=k924uu.site — 返回对应站点的像素ID
// v3: D1 优先（pixel_ids），KV 回退 + 自动迁移
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    var site = url.searchParams.get('site') || '';
    if (!site) {
      const referer = request.headers.get('Referer') || '';
      try { site = new URL(referer).hostname; } catch (e) {}
    }
    if (!site) site = request.headers.get('Host') || '';

    // 从 D1 查站点对应的用户名
    const siteRow = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
    const username = siteRow ? siteRow.username : '';

    var ids = [];

    // 1. D1 优先
    if (username) {
      try {
        var row = await env.DB.prepare('SELECT pixel_ids FROM accounts WHERE username = ?1').bind(username).first();
        if (row && row.pixel_ids) {
          ids = JSON.parse(row.pixel_ids);
        }
      } catch (e) {}
    }

    // 2. KV 回退
    if (!ids.length) {
      try {
        const prefix = username ? username + ':' : '';
        const raw = await env.kvadmin.get(prefix + 'pixel_ids');
        if (raw) {
          ids = JSON.parse(raw);
          // 自动迁移到 D1
          if (ids.length && username) {
            context.waitUntil(
              env.DB.prepare('UPDATE accounts SET pixel_ids = ?1 WHERE username = ?2').bind(raw, username).run().catch(function(){})
            );
          }
        }
      } catch (e) {}
    }

    return new Response(JSON.stringify({ ids: ids, _site: site, _user: username || '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ids: [] }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }
    });
  }
}

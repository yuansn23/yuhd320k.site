// GET /api/pixels?site=k924uu.site — 返回对应站点的像素ID
// v4: 返回版本号 + 长缓存，前端 localStorage 比对版本减少请求
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

    const siteRow = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
    const username = siteRow ? siteRow.username : '';

    var ids = [];
    var version = 0;

    if (username) {
      // D1 优先
      try {
        var row = await env.DB.prepare('SELECT pixel_ids, config_version FROM accounts WHERE username = ?1').bind(username).first();
        if (row) {
          version = row.config_version || 0;
          if (row.pixel_ids) ids = JSON.parse(row.pixel_ids);
        }
      } catch (e) {}
    }

    // KV 回退
    if (!ids.length) {
      try {
        const prefix = username ? username + ':' : '';
        const raw = await env.kvadmin.get(prefix + 'pixel_ids');
        if (raw) {
          ids = JSON.parse(raw);
          version = 1;
        }
      } catch (e) {}
    }

    return new Response(JSON.stringify({ ids: ids, version: version, _site: site }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ids: [], version: 0 }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }
    });
  }
}

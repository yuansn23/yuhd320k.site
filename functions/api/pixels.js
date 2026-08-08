// GET /api/pixels?site=k924uu.site — 返回对应站点的像素ID
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

    const username = (await env.kvadmin.get('site:' + site)) || '';
    const prefix = username ? username + ':' : '';
    const raw = (await env.kvadmin.get(prefix + 'pixel_ids')) || '[]';
    return new Response(JSON.stringify({ ids: JSON.parse(raw), _site: site, _user: username || '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ids: [] }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }
    });
  }
}

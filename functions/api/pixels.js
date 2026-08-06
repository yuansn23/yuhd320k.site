// GET /api/pixels — 根据站点返回对应像素ID
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const referer = request.headers.get('Referer') || '';
    const host = request.headers.get('Host') || '';
    var site = '';
    try { site = new URL(referer).hostname; } catch (e) {}
    if (!site) site = host;

    const username = (await env.kvadmin.get('site:' + site)) || '';
    const prefix = username ? username + ':' : '';
    const raw = (await env.kvadmin.get(prefix + 'pixel_ids')) || '[]';
    return new Response(JSON.stringify({ ids: JSON.parse(raw) }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ids: [] }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

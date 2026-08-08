// GET /api/pixels?site=k924uu.site — 返回对应站点的像素ID
// v3: 站点映射从 D1 读取，像素 ID 从 KV 读取
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

    // 像素 ID 继续从 KV 读取（配置数据，低频读写）
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

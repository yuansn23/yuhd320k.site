// GET /api/apk-url?site=k924uu.site — 返回对应站点的APK地址 + 计数
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    // 优先使用 ?site= 参数（跨域前端），否则用 Referer/Host
    var site = url.searchParams.get('site') || '';
    if (!site) {
      const referer = request.headers.get('Referer') || '';
      try { site = new URL(referer).hostname; } catch (e) {}
    }
    if (!site) site = request.headers.get('Host') || '';

    const username = (await env.kvadmin.get('site:' + site)) || '';
    const prefix = username ? username + ':' : '';
    const apkUrl = (await env.kvadmin.get(prefix + 'apk_url')) || '';

    // 计数+1
    try {
      const today = new Date().toISOString().slice(0, 10);
      for (const key of [prefix + 'download_count', prefix + 'download_' + today]) {
        const raw = (await env.kvadmin.get(key)) || '0';
        await env.kvadmin.put(key, String(parseInt(raw) + 1));
      }
    } catch (e) {}

    return new Response(JSON.stringify({ url: apkUrl }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ url: '' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

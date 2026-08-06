// GET /api/apk-url — 根据站点返回对应APK地址 + 计数
export async function onRequest(context) {
  const { request, env } = context;
  try {
    // 从 Host 或 Referer 识别站点
    const host = request.headers.get('Host') || '';
    const referer = request.headers.get('Referer') || '';
    var site = '';
    try { site = new URL(referer).hostname; } catch (e) {}
    if (!site) site = host;

    // 查找站点对应的账户
    const username = (await env.APK_STORE.get('site:' + site)) || '';
    const prefix = username ? username + ':' : '';

    const url = (await env.APK_STORE.get(prefix + 'apk_url')) || '';

    // 计数+1
    try {
      const today = new Date().toISOString().slice(0, 10);
      for (const key of [prefix + 'download_count', prefix + 'download_' + today]) {
        const raw = (await env.APK_STORE.get(key)) || '0';
        await env.APK_STORE.put(key, String(parseInt(raw) + 1));
      }
    } catch (e) {}

    return new Response(JSON.stringify({ url }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ url: '' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

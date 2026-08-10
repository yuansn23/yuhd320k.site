// GET /api/apk-url?site=k924uu.site — 返回对应站点的APK地址
// v5: 不缓存，D1 + KV 并行读取，每次取最新数据
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    var site = url.searchParams.get('site') || '';
    try { site = new URL(site).hostname; } catch (e) {}
    if (!site) {
      const referer = request.headers.get('Referer') || '';
      try { site = new URL(referer).hostname; } catch (e) {}
    }
    if (!site) site = request.headers.get('Host') || '';

    const siteRow = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
    const username = siteRow ? siteRow.username : '';

    var apkUrl = '';
    var version = 0;

    // 并行读 D1(account_sites → accounts) + KV
    var d1Result = null;
    var kvResult = null;

    if (username) {
      try {
        d1Result = await env.DB.prepare('SELECT apk_url FROM account_sites WHERE site = ?1 AND username = ?2').bind(site, username).first();
        if (!d1Result || !d1Result.apk_url) {
          d1Result = await env.DB.prepare('SELECT apk_url, config_version FROM accounts WHERE username = ?1').bind(username).first();
        }
      } catch (e) {}
      try {
        kvResult = await env.kvadmin.get(username + ':apk_url');
      } catch (e) {}
    }

    if (d1Result && d1Result.apk_url) {
      apkUrl = d1Result.apk_url;
      version = d1Result.config_version || 0;
    }
    // D1 没数据时用 KV
    if (!apkUrl && kvResult) {
      apkUrl = kvResult;
      version = 1;
    }

    // 计数器写入 D1（非阻塞，按站点区分）
    if (username) {
      const today = new Date().toISOString().slice(0, 10);
      context.waitUntil(
        env.DB.prepare(
          'INSERT INTO download_counts (username, date, site, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT (username, date, site) DO UPDATE SET count = count + 1'
        ).bind(username, today, site).run().catch(function(){})
      );
    }

    return new Response(JSON.stringify({ url: apkUrl, version: version, _site: site }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ url: '' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

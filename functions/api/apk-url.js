// GET /api/apk-url?site=k924uu.site — 返回对应站点的APK地址
// v3: 全部 D1 读写（apk_url 从 accounts 表，计数器到 download_counts）
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

    // APK URL：D1 优先，KV 回退
    var apkUrl = '';
    try {
      var row = await env.DB.prepare('SELECT apk_url FROM accounts WHERE username = ?1').bind(username || '').first();
      if (row && row.apk_url) apkUrl = row.apk_url;
    } catch (e) {}
    if (!apkUrl) {
      try {
        const prefix = username ? username + ':' : '';
        apkUrl = (await env.kvadmin.get(prefix + 'apk_url')) || '';
        // 自动迁移
        if (apkUrl && username) {
          context.waitUntil(
            env.DB.prepare('UPDATE accounts SET apk_url = ?1 WHERE username = ?2').bind(apkUrl, username).run().catch(function(){})
          );
        }
      } catch (e) {}
    }

    // 计数器写入 D1（非阻塞，无限额）
    if (username) {
      const today = new Date().toISOString().slice(0, 10);
      context.waitUntil(
        env.DB.prepare(
          'INSERT INTO download_counts (username, date, count) VALUES (?1, ?2, 1) ON CONFLICT (username, date) DO UPDATE SET count = count + 1'
        ).bind(username, today).run().catch(function(){})
      );
    }

    return new Response(JSON.stringify({ url: apkUrl, _site: site, _user: username || '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ url: '' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

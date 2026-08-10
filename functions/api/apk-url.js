// GET /api/apk-url?site=k924uu.site — 返回对应站点的APK地址
// v5: 不缓存，D1 + KV 并行读取，每次取最新数据
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    var rawSite = url.searchParams.get('site') || '';
    if (!rawSite) {
      const referer = request.headers.get('Referer') || '';
      try { rawSite = new URL(referer).hostname; } catch (e) {}
    }
    if (!rawSite) rawSite = request.headers.get('Host') || '';
    var site = rawSite;
    try { site = new URL(rawSite).hostname; } catch (e) {}

    var siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1 OR site = ?2').bind(site, rawSite).first();
    if (!siteRow) {
      var allMaps = await env.DB.prepare('SELECT site, username FROM site_mappings').all();
      if (allMaps && allMaps.results) {
        for (var mi = 0; mi < allMaps.results.length && !siteRow; mi++) {
          var mapped = allMaps.results[mi];
          try { if (new URL(mapped.site).hostname === site) siteRow = mapped; } catch(e) {}
        }
      }
    }
    const username = siteRow ? siteRow.username : '';
    var matchedSite = siteRow ? siteRow.site : site;

    var apkUrl = '';
    var version = 0;

    var d1Result = null;
    var kvResult = null;

    if (username) {
      try {
        // 标准化 matchedSite：site_mappings 可能存完整URL，account_sites 存纯域名，需要对齐
        var matchedHost = matchedSite;
        try { matchedHost = new URL(matchedSite).hostname; } catch (e) {}
        // 三轮尝试：matchedSite 原值 → matchedSite 的 hostname → rawSite 原值
        d1Result = await env.DB.prepare('SELECT apk_url FROM account_sites WHERE site = ?1 AND username = ?2').bind(matchedSite, username).first();
        if ((!d1Result || !d1Result.apk_url) && matchedHost !== matchedSite) {
          d1Result = await env.DB.prepare('SELECT apk_url FROM account_sites WHERE site = ?1 AND username = ?2').bind(matchedHost, username).first();
        }
        if ((!d1Result || !d1Result.apk_url) && rawSite !== matchedSite && rawSite !== matchedHost) {
          d1Result = await env.DB.prepare('SELECT apk_url FROM account_sites WHERE site = ?1 AND username = ?2').bind(rawSite, username).first();
        }
        // rawSite 也尝试提取 hostname
        var rawHost = rawSite;
        try { rawHost = new URL(rawSite).hostname; } catch (e) {}
        if ((!d1Result || !d1Result.apk_url) && rawHost !== rawSite && rawHost !== matchedSite && rawHost !== matchedHost) {
          d1Result = await env.DB.prepare('SELECT apk_url FROM account_sites WHERE site = ?1 AND username = ?2').bind(rawHost, username).first();
        }
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
    if (username && matchedSite) {
      const today = new Date().toISOString().slice(0, 10);
      context.waitUntil(
        env.DB.prepare(
          'INSERT INTO download_counts (username, date, site, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT (username, date, site) DO UPDATE SET count = count + 1'
        ).bind(username, today, matchedSite).run().catch(function(){})
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

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

    // 精确匹配优先：先查 rawSite，再尝试加 .html（兼容 clean URL），再查域名
    var siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(rawSite).first();
    if (!siteRow && rawSite.indexOf('.') > 0 && rawSite.indexOf('/') > 0 && rawSite.indexOf('.html') === -1) {
      siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(rawSite + '.html').first();
    }
    if (!siteRow) {
      siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(site).first();
    }
    if (!siteRow) {
      var allMaps = await env.DB.prepare('SELECT site, username FROM site_mappings').all();
      if (allMaps && allMaps.results) {
        // 第一轮：精确匹配 rawSite、rawSite+.html、site
        for (var mi = 0; mi < allMaps.results.length && !siteRow; mi++) {
          var mapped = allMaps.results[mi];
          if (mapped.site === rawSite || mapped.site === rawSite + '.html' || mapped.site === site) { siteRow = mapped; break; }
        }
        // 第二轮：hostname 匹配（仅当精确匹配都没命中）
        if (!siteRow) {
          for (var mi = 0; mi < allMaps.results.length && !siteRow; mi++) {
            var mapped = allMaps.results[mi];
            try { if (new URL(mapped.site).hostname === site) { siteRow = mapped; break; } } catch(e) {}
            try { if (new URL('https://' + mapped.site).hostname === site) { siteRow = mapped; break; } } catch(e) {}
          }
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
      // 标准化 matchedSite：site_mappings 可能存完整URL，account_sites 存纯域名，需要对齐
      var matchedHost = matchedSite;
      try { matchedHost = new URL(matchedSite).hostname; } catch (e) {}
      var rawHost = rawSite;
      try { rawHost = new URL(rawSite).hostname; } catch (e) {}

      // 多轮尝试 account_sites（每轮独立 try，不因缺列互相影响）
      // 优先级：实际请求URL → 域名 → site_mappings（越具体越优先，避免串数据）
      var d1Row = null;
      var candidates = [rawSite];
      if (rawHost !== rawSite) candidates.push(rawHost);
      if (matchedSite !== rawSite && matchedSite !== rawHost) candidates.push(matchedSite);
      if (matchedHost !== matchedSite && matchedHost !== rawSite && matchedHost !== rawHost) candidates.push(matchedHost);
      for (var ci = 0; ci < candidates.length && (!d1Row || !d1Row.apk_url); ci++) {
        try { d1Row = await env.DB.prepare('SELECT apk_url FROM account_sites WHERE site = ?1 AND username = ?2').bind(candidates[ci], username).first(); } catch (e) {}
      }

      // 回退 accounts 表
      if (!d1Row || !d1Row.apk_url) {
        try { d1Row = await env.DB.prepare('SELECT apk_url, config_version FROM accounts WHERE username = ?1').bind(username).first(); } catch (e) {}
      }

      try { kvResult = await env.kvadmin.get(username + ':apk_url'); } catch (e) {}

      d1Result = d1Row;
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

    return new Response(JSON.stringify({ url: apkUrl, version: version, _site: site, _dbg: { rawSite: rawSite, site: site, foundMapping: !!siteRow, username: username, matchedSite: matchedSite, matchedHost: typeof matchedHost !== 'undefined' ? matchedHost : '', fromD1: !!d1Result, fromKV: !!kvResult } }), {
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

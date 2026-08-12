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

    // 精确匹配优先：rawSite → 斜杠变体 → .html → 域名（兼容新旧数据格式）
    var siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(rawSite).first();
    // 末尾斜杠变体：配置 /path 也能匹配 /path/（反之亦然）
    var rawSiteAlt = '';
    if (!siteRow) {
      if (rawSite.charAt(rawSite.length - 1) === '/') {
        rawSiteAlt = rawSite.slice(0, -1);
      } else if (rawSite.indexOf('/') > 0) {
        rawSiteAlt = rawSite + '/';
      }
      if (rawSiteAlt) siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(rawSiteAlt).first();
    }
    if (!siteRow && rawSite.indexOf('.') > 0 && rawSite.indexOf('/') > 0 && rawSite.indexOf('.html') === -1) {
      siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(rawSite + '.html').first();
    }
    if (!siteRow) {
      siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(site).first();
    }
    if (!siteRow) {
      var allMaps = await env.DB.prepare('SELECT site, username FROM site_mappings').all();
      if (allMaps && allMaps.results) {
        // 第一轮：精确匹配
        for (var mi = 0; mi < allMaps.results.length && !siteRow; mi++) {
          var mapped = allMaps.results[mi];
          if (mapped.site === rawSite || mapped.site === rawSiteAlt || mapped.site === rawSite + '.html' || mapped.site === site) { siteRow = mapped; break; }
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
      // 优先级：实际请求URL → 斜杠变体 → 域名 → site_mappings
      var d1Row = null;
      var candidates = [rawSite];
      // 末尾斜杠变体：配置 /path 也能匹配 /path/（反之亦然）
      if (rawSite.charAt(rawSite.length - 1) === '/') {
        candidates.push(rawSite.slice(0, -1));
      } else if (rawSite.indexOf('/') > 0) {
        candidates.push(rawSite + '/');
      }
      if (rawHost !== rawSite && rawHost !== candidates[candidates.length-1]) candidates.push(rawHost);
      if (matchedSite !== rawSite && matchedSite !== rawHost && matchedSite !== candidates[candidates.length-1]) candidates.push(matchedSite);
      if (matchedHost !== matchedSite && matchedHost !== rawSite && matchedHost !== rawHost && matchedHost !== candidates[candidates.length-1]) candidates.push(matchedHost);
      // 遍历候选（找到有数据的就停，但记录是否匹配到过任何行）
      var foundAnySite = false;
      for (var ci = 0; ci < candidates.length && (!d1Row || !d1Row.apk_url); ci++) {
        try {
          var row = await env.DB.prepare('SELECT apk_url FROM account_sites WHERE site = ?1 AND username = ?2').bind(candidates[ci], username).first();
          if (row) { d1Row = row; foundAnySite = true; }
        } catch (e) {}
      }

      // 回退 accounts 表 — 仅当 account_sites 完全没记录时才回退（有记录但为空 = 该站点未配置，不回退）
      if (!foundAnySite) {
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

    // 附加追踪参数：APK 文件直传 dl.js，外链走 /api/rd 中转计数后跳转
    if (apkUrl && username) {
      var isDl = apkUrl.indexOf('/api/dl') !== -1;
      if (isDl) {
        apkUrl += '&_u=' + encodeURIComponent(username) + '&_s=' + encodeURIComponent(matchedSite);
      } else {
        var apiHost = new URL(request.url).hostname;
        apkUrl = 'https://' + apiHost + '/api/rd?_u=' + encodeURIComponent(username) + '&_s=' + encodeURIComponent(matchedSite) + '&_t=' + encodeURIComponent(apkUrl);
      }
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

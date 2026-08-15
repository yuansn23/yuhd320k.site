// GET /api/pixels?site=k924uu.site — 返回对应站点的像素ID
// v5: 不缓存，只读 account_sites 按站点隔离的像素（无跨站/共享回退）
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    var rawSite = url.searchParams.get('site') || '';
    if (!rawSite) { rawSite = request.headers.get('Host') || ''; }
    // 标准化为域名
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
    var matchedSite = siteRow ? siteRow.site : site; // 用匹配到的站点点值

    var ids = [];
    var version = 0;

    // 只读 account_sites（按站点隔离）
    var d1Result = null;

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
      for (var ci = 0; ci < candidates.length && (!d1Row || !d1Row.pixel_ids || d1Row.pixel_ids === '[]'); ci++) {
        try {
          var row = await env.DB.prepare('SELECT pixel_ids, config_version FROM account_sites WHERE site = ?1 AND username = ?2').bind(candidates[ci], username).first();
          if (row) { d1Row = row; foundAnySite = true; }
        } catch (e) {}
      }

      // 像素按站点隔离：只认 account_sites 里该站点自己的配置。
      // 该站点没配置像素（无记录或为空）就返回空，绝不回退到 accounts/KV 的共享数据，
      // 避免「A 站点没配像素时，误用 B 站点或其他共享像素」。
      d1Result = d1Row;
    }

    // 合并：只认 account_sites 里该站点的数据（按站点隔离，不做跨站回退）
    var d1Ids = [];
    if (d1Result && d1Result.pixel_ids) {
      try { d1Ids = JSON.parse(d1Result.pixel_ids); } catch (e) {}
      version = d1Result.config_version || 1;
    }
    ids = d1Ids;
    // 该站点没配置像素 → ids = []

    // 记录访问日志（非阻塞）
    if (username && matchedSite) {
      var ip = request.headers.get('CF-Connecting-IP') || '';
      var ua = request.headers.get('User-Agent') || '';
      var device = (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) ? '手机' : '电脑';
      context.waitUntil(
        env.DB.prepare('INSERT INTO visit_logs (username, site, visit_time, ip, device, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
          .bind(username, matchedSite, new Date().toISOString(), ip, device, ua.substring(0, 500)).run().catch(function(){})
      );
    }

    return new Response(JSON.stringify({ ids: ids, version: version, _site: site, _dbg: { rawSite: rawSite, site: site, foundMapping: !!siteRow, username: username, matchedSite: matchedSite, matchedHost: typeof matchedHost !== 'undefined' ? matchedHost : '', fromD1: !!d1Result } }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ids: [], version: 0 }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
    });
  }
}

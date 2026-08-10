// GET /api/pixels?site=k924uu.site — 返回对应站点的像素ID
// v5: 不缓存，D1 + KV 并行读取，优先返回数据更多的一方
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    var rawSite = url.searchParams.get('site') || '';
    if (!rawSite) { rawSite = request.headers.get('Host') || ''; }
    // 标准化为域名
    var site = rawSite;
    try { site = new URL(rawSite).hostname; } catch (e) {}

    var siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1 OR site = ?2').bind(site, rawSite).first();
    if (!siteRow) {
      var allMaps = await env.DB.prepare('SELECT site, username FROM site_mappings').all();
      if (allMaps && allMaps.results) {
        for (var mi = 0; mi < allMaps.results.length && !siteRow; mi++) {
          var mapped = allMaps.results[mi];
          // 直接相等 OR 互为 hostname（处理纯域名 vs 完整URL 的差异）
          if (mapped.site === site || mapped.site === rawSite) { siteRow = mapped; break; }
          try { if (new URL(mapped.site).hostname === site) { siteRow = mapped; break; } } catch(e) {}
          try { if (new URL('https://' + mapped.site).hostname === site) { siteRow = mapped; break; } } catch(e) {}
        }
      }
    }
    const username = siteRow ? siteRow.username : '';
    var matchedSite = siteRow ? siteRow.site : site; // 用匹配到的站点点值

    var ids = [];
    var version = 0;

    // 并行读 D1(account_sites → accounts) + KV
    var d1Result = null;
    var kvResult = null;

    if (username) {
      // 标准化 matchedSite：site_mappings 可能存完整URL，account_sites 存纯域名，需要对齐
      var matchedHost = matchedSite;
      try { matchedHost = new URL(matchedSite).hostname; } catch (e) {}
      var rawHost = rawSite;
      try { rawHost = new URL(rawSite).hostname; } catch (e) {}

      // 多轮尝试 account_sites（每轮独立 try，不因缺列互相影响）
      var d1Row = null;
      var candidates = [matchedSite];
      if (matchedHost !== matchedSite) candidates.push(matchedHost);
      if (rawSite !== matchedSite && rawSite !== matchedHost) candidates.push(rawSite);
      if (rawHost !== rawSite && rawHost !== matchedSite && rawHost !== matchedHost) candidates.push(rawHost);
      for (var ci = 0; ci < candidates.length && (!d1Row || !d1Row.pixel_ids || d1Row.pixel_ids === '[]'); ci++) {
        try { d1Row = await env.DB.prepare('SELECT pixel_ids FROM account_sites WHERE site = ?1 AND username = ?2').bind(candidates[ci], username).first(); } catch (e) {}
      }

      // 回退 accounts 表
      if (!d1Row || !d1Row.pixel_ids || d1Row.pixel_ids === '[]') {
        try { d1Row = await env.DB.prepare('SELECT pixel_ids, config_version FROM accounts WHERE username = ?1').bind(username).first(); } catch (e) {}
      }

      try { kvResult = await env.kvadmin.get(username + ':pixel_ids'); } catch (e) {}

      d1Result = d1Row;
    }

    // 合并：D1 优先（按站点隔离的最新数据），KV 仅做回退
    var d1Ids = [];
    var kvIds = [];
    if (d1Result && d1Result.pixel_ids) {
      try { d1Ids = JSON.parse(d1Result.pixel_ids); } catch (e) {}
      version = d1Result.config_version || 1;
    }
    if (kvResult) {
      try { kvIds = JSON.parse(kvResult); } catch (e) {}
    }

    if (d1Ids.length > 0) {
      ids = d1Ids;                // D1 有数据，永远用它（按站点隔离，最新）
    } else if (kvIds.length > 0) {
      ids = kvIds;                // D1 无数据，回退 KV
      version = Math.max(version, 1);
    }
    // 两边都没数据 → ids = []，version = 0

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

    return new Response(JSON.stringify({ ids: ids, version: version, _site: site, _dbg: { rawSite: rawSite, site: site, foundMapping: !!siteRow, username: username, matchedSite: matchedSite, matchedHost: typeof matchedHost !== 'undefined' ? matchedHost : '', fromD1: !!d1Result, fromKV: !!kvResult } }), {
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

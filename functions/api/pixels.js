// GET /api/pixels?site=k924uu.site — 返回对应站点的像素ID
// v5: 不缓存，D1 + KV 并行读取，优先返回数据更多的一方
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
    // 统一提取为域名
    var site = rawSite;
    try { site = new URL(rawSite).hostname; } catch (e) {}

    // 查 site_mappings（兼容存完整URL和存域名两种情况）
    var siteRow = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
    if (!siteRow) { siteRow = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(rawSite).first(); }
    if (!siteRow && rawSite !== site) { siteRow = await env.DB.prepare('SELECT username FROM site_mappings WHERE site LIKE ?1').bind('%' + site + '%').first(); }
    const username = siteRow ? siteRow.username : '';

    var ids = [];
    var version = 0;

    // 并行读 D1(account_sites → accounts) + KV
    var d1Result = null;
    var kvResult = null;

    if (username) {
      try {
        // 优先从 account_sites 按站点读
        d1Result = await env.DB.prepare('SELECT pixel_ids FROM account_sites WHERE site = ?1 AND username = ?2').bind(site, username).first();
        if ((!d1Result || !d1Result.pixel_ids || d1Result.pixel_ids === '[]') && rawSite !== site) {
          d1Result = await env.DB.prepare('SELECT pixel_ids FROM account_sites WHERE site = ?1 AND username = ?2').bind(rawSite, username).first();
        }
        if (!d1Result || !d1Result.pixel_ids || d1Result.pixel_ids === '[]') {
          // 回退 accounts 表
          d1Result = await env.DB.prepare('SELECT pixel_ids, config_version FROM accounts WHERE username = ?1').bind(username).first();
        }
      } catch (e) {}
      try {
        kvResult = await env.kvadmin.get(username + ':pixel_ids');
      } catch (e) {}
    }

    // 合并：取数据更多的一方
    var d1Ids = [];
    var kvIds = [];
    if (d1Result && d1Result.pixel_ids) {
      try { d1Ids = JSON.parse(d1Result.pixel_ids); } catch (e) {}
      version = d1Result.config_version || 0;
    }
    if (kvResult) {
      try { kvIds = JSON.parse(kvResult); } catch (e) {}
    }

    if (d1Ids.length >= kvIds.length) {
      ids = d1Ids;
    } else {
      ids = kvIds;
      version = Math.max(version, 1);
    }

    // 记录访问日志（非阻塞）
    if (username && site) {
      var ip = request.headers.get('CF-Connecting-IP') || '';
      var ua = request.headers.get('User-Agent') || '';
      var device = (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) ? '手机' : '电脑';
      context.waitUntil(
        env.DB.prepare('INSERT INTO visit_logs (username, site, visit_time, ip, device, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
          .bind(username, site, new Date().toISOString(), ip, device, ua.substring(0, 500)).run().catch(function(){})
      );
    }

    return new Response(JSON.stringify({ ids: ids, version: version, _site: site }), {
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

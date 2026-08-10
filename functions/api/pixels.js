// GET /api/pixels?site=k924uu.site — 返回对应站点的像素ID
// v5: 不缓存，D1 + KV 并行读取，优先返回数据更多的一方
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

    var ids = [];
    var version = 0;

    // 并行读 D1(account_sites → accounts) + KV
    var d1Result = null;
    var kvResult = null;

    if (username) {
      try {
        // 优先从 account_sites 按站点读
        d1Result = await env.DB.prepare('SELECT pixel_ids FROM account_sites WHERE site = ?1 AND username = ?2').bind(site, username).first();
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
      // 终端类型 + 型号解析
      var terminal = ''; var phoneModel = '';
      if (/iPhone/i.test(ua)) { terminal = 'iOS'; phoneModel = 'iPhone'; }
      else if (/iPad/i.test(ua)) { terminal = 'iOS'; phoneModel = 'iPad'; }
      else if (/iPod/i.test(ua)) { terminal = 'iOS'; phoneModel = 'iPod'; }
      else if (/Android/i.test(ua)) {
        terminal = '安卓';
        // 标准格式: Android VERSION; MODEL Build/
        var stdModel = ua.match(/Android\s+\d+[^;]*;\s*([A-Za-z][\w-]{2,20})\s+Build/);
        if (stdModel && !/^\d+$/.test(stdModel[1])) phoneModel = stdModel[1];
        // Instagram 内嵌格式: Android (dpi; wxh; maker; MODEL; ...)
        if (!phoneModel) {
          var igMatch = ua.match(/Android\s*\([^)]+\)/);
          if (igMatch) {
            var igParts = igMatch[0].split(/[;)]/);
            for (var pi = 0; pi < igParts.length; pi++) {
              var part = igParts[pi].trim();
              // 型号特征：3-20位，含字母，非纯数字，非已知关键词
              if (part.length >= 3 && part.length <= 20 && /[A-Za-z]/.test(part) && !/^\d+$/.test(part)
                  && !/^(Android|SHARP|Samsung|qcom|Orga|IABMV|dpi|wv|NV|\d+x\d+)$/i.test(part)) {
                phoneModel = part;
                break;
              }
            }
          }
        }
        // 最后兜底：; MODEL )
        if (!phoneModel) {
          var fb = ua.match(/;\s*([A-Za-z][\w-]{3,20})\s*\)/);
          if (fb && !/^\d+$/.test(fb[1])) phoneModel = fb[1];
        }
      }
      else if (/Windows/i.test(ua)) { terminal = '电脑'; }
      else if (/Macintosh/i.test(ua)) { terminal = '电脑'; phoneModel = 'Mac'; }
      else if (/Linux/i.test(ua)) { terminal = '电脑'; }
      else { terminal = '其他'; }
      var device = (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) ? '手机' : '电脑';
      // 语言：优先 Accept-Language，为空时从 UA 解析
      var lang = (request.headers.get('Accept-Language') || '').split(',')[0] || '';
      if (!lang) {
        var lm = ua.match(/[a-z]{2}_[A-Z]{2}/);
        if (lm) { var lp = lm[0].split('_'); lang = lp[0].toLowerCase() + '-' + lp[1].toUpperCase(); }
      }
      // 流量媒体来源
      var media = '';
      if (/FB_IAB|FB4A|FBAV|Facebook/i.test(ua)) media = 'Facebook';
      else if (/Instagram/i.test(ua)) media = 'Instagram';
      else if (/TikTok/i.test(ua)) media = 'TikTok';
      else if (/Twitter|Twitterrific/i.test(ua)) media = 'Twitter';
      else if (/Snapchat/i.test(ua)) media = 'Snapchat';
      else if (/Telegram/i.test(ua)) media = 'Telegram';
      else if (/WhatsApp/i.test(ua)) media = 'WhatsApp';
      else if (/Line/i.test(ua)) media = 'Line';
      context.waitUntil((async function(){
        try {
          await env.DB.prepare('INSERT INTO visit_logs (username, site, visit_time, ip, device, user_agent, lang, media, terminal_type, phone_model) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
            .bind(username, site, new Date().toISOString(), ip, device, ua.substring(0, 500), lang.substring(0, 50), media, terminal, phoneModel).run();
        } catch(e) {
          try {
            await env.DB.prepare('INSERT INTO visit_logs (username, site, visit_time, ip, device, user_agent, lang, media) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
              .bind(username, site, new Date().toISOString(), ip, device, ua.substring(0, 500), lang.substring(0, 50), media).run();
          } catch(e2) {
            await env.DB.prepare('INSERT INTO visit_logs (username, site, visit_time, ip, device, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
              .bind(username, site, new Date().toISOString(), ip, device, ua.substring(0, 500)).run().catch(function(){});
          }
        }
      })());
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

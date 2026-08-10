// GET /api/admin/my-visit-logs — 子账户查看自己落地页的访问流量
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    var account = await env.DB.prepare('SELECT password FROM accounts WHERE username = ?1').bind(user).first();
    if (!account) { var kvRaw = await env.kvadmin.get('account:' + user); if (kvRaw) { account = JSON.parse(kvRaw); account.password = account.pw; } }
    if (!account) return null;
    if (auth !== 'Basic ' + btoa(user + ':' + role + ':' + (account.password || account.pw))) return null;
    return { user, role };
  } catch (e) { return null; }
}

// 从 UA 解析：终端类型、型号、语言、媒体来源
function parseUA(ua) {
  var terminal = '', phoneModel = '', lang = '', media = '';
  if (/iPhone/i.test(ua)) { terminal = 'iOS'; phoneModel = 'iPhone'; }
  else if (/iPad/i.test(ua)) { terminal = 'iOS'; phoneModel = 'iPad'; }
  else if (/iPod/i.test(ua)) { terminal = 'iOS'; phoneModel = 'iPod'; }
  else if (/Android/i.test(ua)) {
    terminal = '安卓';
    var stdModel = ua.match(/Android\s+\d+[^;]*;\s*([A-Za-z][\w-]{2,20})\s+Build/);
    if (!stdModel) stdModel = ua.match(/Android\s+\d+[^;]*;\s*([A-Za-z][\w-]{2,20})/);
    if (stdModel && !/^\d+$/.test(stdModel[1]) && !/^(wv|Mobile|Chrome|Safari|AppleWebKit|KHTML|Gecko|Version)$/i.test(stdModel[1])) phoneModel = stdModel[1];
    if (!phoneModel) {
      var igMatch = ua.match(/Android\s*\([^)]+\)/);
      if (igMatch) {
        var igParts = igMatch[0].split(/[;)]/);
        for (var pi = 0; pi < igParts.length; pi++) {
          var part = igParts[pi].trim();
          if (part.length >= 3 && part.length <= 20 && /[A-Za-z]/.test(part) && !/^\d+$/.test(part)
              && !/^(Android|SHARP|Samsung|qcom|Orga|IABMV|dpi|wv|NV|\d+x\d+)$/i.test(part)) { phoneModel = part; break; }
        }
      }
    }
    if (!phoneModel) { var fb = ua.match(/;\s*([A-Za-z][\w-]{3,20})\s*\)/); if (fb && !/^\d+$/.test(fb[1])) phoneModel = fb[1]; }
  }
  else if (/Windows/i.test(ua)) { terminal = '电脑'; }
  else if (/Macintosh/i.test(ua)) { terminal = '电脑'; phoneModel = 'Mac'; }
  else if (/Linux/i.test(ua)) { terminal = '电脑'; }
  else { terminal = '其他'; }

  // 语言
  var lm = ua.match(/[a-z]{2}_[A-Z]{2}/);
  if (lm) { var lp = lm[0].split('_'); lang = lp[0].toLowerCase() + '-' + lp[1].toUpperCase(); }

  // 媒体
  if (/FB_IAB|FB4A|FBAV|Facebook/i.test(ua)) media = 'Facebook';
  else if (/Instagram/i.test(ua)) media = 'Instagram';
  else if (/TikTok/i.test(ua)) media = 'TikTok';
  else if (/Twitter/i.test(ua)) media = 'Twitter';
  else if (/Snapchat/i.test(ua)) media = 'Snapchat';
  else if (/Telegram/i.test(ua)) media = 'Telegram';
  else if (/WhatsApp/i.test(ua)) media = 'WhatsApp';
  else if (/Line/i.test(ua)) media = 'Line';

  return { terminal_type: terminal, phone_model: phoneModel, lang: lang, media: media };
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const me = await getMyUser(request, env);
    if (!me) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const url = new URL(request.url);
    const filterSite = url.searchParams.get('site') || '';
    const dateStart = url.searchParams.get('start') || '';
    const dateEnd = url.searchParams.get('end') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500);

    // 构建查询
    var fields = 'site, visit_time, ip, device, user_agent';
    var result;
    if (filterSite && dateStart && dateEnd) {
      result = await env.DB.prepare('SELECT ' + fields + ' FROM visit_logs WHERE username = ?1 AND site = ?2 AND visit_time >= ?3 AND visit_time <= ?4 ORDER BY visit_time DESC LIMIT ?5')
        .bind(me.user, filterSite, dateStart + 'T00:00:00.000Z', dateEnd + 'T23:59:59.999Z', limit).all();
    } else if (filterSite && dateStart) {
      result = await env.DB.prepare('SELECT ' + fields + ' FROM visit_logs WHERE username = ?1 AND site = ?2 AND visit_time >= ?3 ORDER BY visit_time DESC LIMIT ?4')
        .bind(me.user, filterSite, dateStart + 'T00:00:00.000Z', limit).all();
    } else if (dateStart && dateEnd) {
      result = await env.DB.prepare('SELECT ' + fields + ' FROM visit_logs WHERE username = ?1 AND visit_time >= ?2 AND visit_time <= ?3 ORDER BY visit_time DESC LIMIT ?4')
        .bind(me.user, dateStart + 'T00:00:00.000Z', dateEnd + 'T23:59:59.999Z', limit).all();
    } else if (dateStart) {
      result = await env.DB.prepare('SELECT ' + fields + ' FROM visit_logs WHERE username = ?1 AND visit_time >= ?2 ORDER BY visit_time DESC LIMIT ?3')
        .bind(me.user, dateStart + 'T00:00:00.000Z', limit).all();
    } else if (filterSite) {
      result = await env.DB.prepare('SELECT ' + fields + ' FROM visit_logs WHERE username = ?1 AND site = ?2 ORDER BY visit_time DESC LIMIT ?3')
        .bind(me.user, filterSite, limit).all();
    } else {
      result = await env.DB.prepare('SELECT ' + fields + ' FROM visit_logs WHERE username = ?1 ORDER BY visit_time DESC LIMIT ?2')
        .bind(me.user, limit).all();
    }

    var logs = [];
    if (result && result.results) {
      logs = result.results.map(function(r){
        var parsed = parseUA(r.user_agent || '');
        return {
          site: r.site, visit_time: r.visit_time, ip: r.ip, device: r.device,
          terminal_type: parsed.terminal_type || r.device,
          phone_model: parsed.phone_model,
          lang: parsed.lang,
          media: parsed.media
        };
      });
    }

    return new Response(JSON.stringify({ logs: logs, total: logs.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

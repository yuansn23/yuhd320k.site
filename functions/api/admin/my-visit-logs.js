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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const page = Math.max(parseInt(url.searchParams.get('page') || '1'), 1);
    const offset = (page - 1) * limit;

    // 构建查询条件
    var whereBase = 'username = ?1';
    var condParams = [me.user];
    var idx = 2;
    if (filterSite) { whereBase += ' AND site = ?' + (idx++); condParams.push(filterSite); }
    if (dateStart) { whereBase += ' AND visit_time >= ?' + (idx++); condParams.push(dateStart + 'T00:00:00.000Z'); }
    if (dateEnd) { whereBase += ' AND visit_time <= ?' + (idx++); condParams.push(dateEnd + 'T23:59:59.999Z'); }

    var fields = 'site, visit_time, ip, device, user_agent';
    var orderBy = ' ORDER BY visit_time DESC';

    // 查总数（无筛选时读预聚合表 stats_daily，避免 COUNT(*) 全表扫；有筛选时走索引 COUNT）
    var totalCount = 0;
    if (!filterSite && !dateStart && !dateEnd) {
      try {
        var ag = await env.DB.prepare("SELECT COALESCE(SUM(visits),0) AS cnt FROM stats_daily WHERE username = ?1 AND date >= date('now','-5 days')").bind(me.user).first();
        totalCount = ag ? ag.cnt : 0;
      } catch (e) {
        var cntFb = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM visit_logs WHERE username = ?1').bind(me.user).first();
        totalCount = cntFb ? cntFb.cnt : 0;
      }
    } else {
      var countSql = 'SELECT COUNT(*) AS cnt FROM visit_logs WHERE ' + whereBase;
      var countResult = null;
      if (condParams.length === 1) countResult = await env.DB.prepare(countSql).bind(condParams[0]).first();
      else if (condParams.length === 2) countResult = await env.DB.prepare(countSql).bind(condParams[0], condParams[1]).first();
      else if (condParams.length === 3) countResult = await env.DB.prepare(countSql).bind(condParams[0], condParams[1], condParams[2]).first();
      else countResult = await env.DB.prepare(countSql).bind(condParams[0], condParams[1], condParams[2], condParams[3]).first();
      totalCount = countResult ? countResult.cnt : 0;
    }

    // 查数据
    var dataSql = 'SELECT ' + fields + ' FROM visit_logs WHERE ' + whereBase + orderBy + ' LIMIT ?' + (idx++) + ' OFFSET ?' + (idx);
    var allParams = condParams.concat([limit, offset]);
    var result = null;
    if (allParams.length === 3) result = await env.DB.prepare(dataSql).bind(allParams[0], allParams[1], allParams[2]).all();
    else if (allParams.length === 4) result = await env.DB.prepare(dataSql).bind(allParams[0], allParams[1], allParams[2], allParams[3]).all();
    else if (allParams.length === 5) result = await env.DB.prepare(dataSql).bind(allParams[0], allParams[1], allParams[2], allParams[3], allParams[4]).all();
    else result = await env.DB.prepare(dataSql).bind(allParams[0], allParams[1], allParams[2], allParams[3], allParams[4], allParams[5]).all();

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

    return new Response(JSON.stringify({ logs: logs, total: totalCount, page: page, limit: limit }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

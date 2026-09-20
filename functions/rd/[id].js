// GET /rd/[id] — 超强分流链接（短链 302 跳转，公开无鉴权）
// 用户访问 https://{a域名}/rd/{8位id} 时，服务端按 随机/权重 选择一个目标 b链接，
// 记录 rd_logs（跳转时间/IP/跳转前a链接/跳转后b链接/设备），返回 302 Location。
// 新增短链防护（rd_protection）：开启后先判定，白名单放行；爬虫/设备/语言/时区/IP/VPN代理机房 命中规则则拦截
// （跳 fallback_url，空则返回 404），全部通过才真正 302 到目标链接。

const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

function parseJson(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
function on(t) { return !!(t && t.enabled); }

function detectDevice(ua) {
  var u = ua || '';
  if (/Android/i.test(u)) return 'android';
  if (/iPhone|iPod|iPad/i.test(u)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(u)) return 'mac';
  if (/Windows|Linux|CrOS/i.test(u)) return 'pc';
  return 'other';
}

function detectCrawler(ua) {
  var u = (ua || '').toLowerCase();
  if (!u) return null;
  if (u.indexOf('googlebot') !== -1 || u.indexOf('mediapartners-google') !== -1 || u.indexOf('adsbot-google') !== -1 || u.indexOf('apis-google') !== -1 || u.indexOf('google-inspectiontool') !== -1 || u.indexOf('googleother') !== -1 || u.indexOf('google-extended') !== -1 || u.indexOf('google-read-aloud') !== -1 || u.indexOf('storebot-google') !== -1) return 'google';
  if (u.indexOf('facebookexternalhit') !== -1 || u.indexOf('facebookcatalog') !== -1 || u.indexOf('facebookbot') !== -1 || u.indexOf('facebot') !== -1 || u.indexOf('meta-externalagent') !== -1 || u.indexOf('meta-externalfetcher') !== -1) return 'facebook';
  if (u.indexOf('bytespider') !== -1 || u.indexOf('bytedance') !== -1 || u.indexOf('tiktok') !== -1 || u.indexOf('toutiaospider') !== -1) return 'tiktok';
  return null;
}

function normLang(lang) {
  var l = (lang || '').toLowerCase();
  var primary = l.split('-')[0].split('_')[0];
  if (primary === 'zh') {
    if (l.indexOf('hk') !== -1 || l.indexOf('mo') !== -1) return 'zh-hk';
    if (l.indexOf('tw') !== -1 || l.indexOf('hant') !== -1) return 'zh-tw';
    return 'zh-cn';
  }
  var map = { en: 'en', ja: 'ja', de: 'de', fr: 'fr', es: 'es', it: 'it', ar: 'ar', pl: 'pl', ko: 'ko', nl: 'nl' };
  return map[primary] || 'other';
}

// 时区匹配：列表项支持 "+8" / "-5" / "utc+8" / "Asia/Tokyo" / "Japan" / "中国" 等
function tzMatch(list, offsetEast, iana) {
  if (offsetEast === null && !iana) return false;
  var li = (list || []).map(function (x) { return String(x).trim().toLowerCase(); }).filter(Boolean);
  var iL = (iana || '').toLowerCase();
  for (var i = 0; i < li.length; i++) {
    var t = li[i];
    if (/^[+-]?\d+(\.\d+)?$/.test(t)) { if (offsetEast !== null && Math.abs(offsetEast - parseFloat(t)) < 0.01) return true; continue; }
    var m = t.match(/^utc([+-]\d+(\.\d+)?)$/);
    if (m && offsetEast !== null && Math.abs(offsetEast - parseFloat(m[1])) < 0.01) return true;
    if (iL && (iL === t || iL.indexOf(t) !== -1 || t.indexOf(iL) !== -1)) return true;
    if (t === 'china' || t === '中国' || t === '北京') { if (offsetEast !== null && Math.abs(offsetEast - 8) < 0.01) return true; }
    else if (t === 'japan' || t === '日本' || t === '東京' || t === 'tokyo') { if (iL.indexOf('tokyo') !== -1 || (offsetEast !== null && Math.abs(offsetEast - 9) < 0.01)) return true; }
    else if (t === 'usa' || t === '美国' || t === 'america') { if (iL.indexOf('new_york') !== -1 || iL.indexOf('los_angeles') !== -1 || iL.indexOf('chicago') !== -1) return true; }
  }
  return false;
}

// 时区 → 数字偏移（小时，东正）。ipinfo 返回 IANA 名称（如 Asia/Shanghai），统一换算成数字 ±N 比较。
function ianaOffset(iana) {
  var t = String(iana || '').toLowerCase();
  if (!t) return null;
  var map = {
    'utc': 0, 'gmt': 0, 'etc/utc': 0, 'etc/gmt': 0, 'zulu': 0,
    'asia/shanghai': 8, 'asia/chongqing': 8, 'asia/harbin': 8, 'asia/kashgar': 8, 'asia/urumqi': 8, 'prc': 8,
    'asia/hong_kong': 8, 'asia/macau': 8, 'asia/taipei': 8, 'asia/singapore': 8, 'asia/kuala_lumpur': 8, 'asia/manila': 8, 'asia/brunei': 8,
    'asia/tokyo': 9, 'asia/seoul': 9, 'asia/pyongyang': 9,
    'asia/jakarta': 7, 'asia/pontianak': 7, 'asia/bangkok': 7, 'asia/ho_chi_minh': 7, 'asia/hanoi': 7, 'asia/saigon': 7,
    'asia/dubai': 4, 'asia/muscat': 4, 'asia/riyadh': 3, 'asia/qatar': 3, 'asia/kuwait': 3, 'asia/bahrain': 3, 'asia/baghdad': 3, 'asia/tehran': 3.5,
    'asia/kolkata': 5.5, 'asia/calcutta': 5.5, 'asia/colombo': 5.5, 'asia/kathmandu': 5.75,
    'asia/dhaka': 6, 'asia/karachi': 5, 'asia/kabul': 4.5, 'asia/almaty': 6, 'asia/tashkent': 5,
    'europe/london': 0, 'europe/dublin': 0, 'europe/lisbon': 0, 'europe/reykjavik': 0,
    'europe/madrid': 1, 'europe/paris': 1, 'europe/berlin': 1, 'europe/amsterdam': 1, 'europe/brussels': 1, 'europe/rome': 1, 'europe/zurich': 1, 'europe/vienna': 1, 'europe/prague': 1, 'europe/warsaw': 1, 'europe/stockholm': 1, 'europe/copenhagen': 1, 'europe/oslo': 1, 'europe/budapest': 1,
    'europe/athens': 2, 'europe/helsinki': 2, 'europe/riga': 2, 'europe/tallinn': 2, 'europe/vilnius': 2, 'europe/sofia': 2, 'europe/bucharest': 2, 'europe/kiev': 2, 'europe/kyiv': 2,
    'europe/istanbul': 3, 'europe/moscow': 3, 'europe/minsk': 3,
    'america/new_york': -5, 'america/toronto': -5, 'america/detroit': -5, 'america/bogota': -5, 'america/lima': -5, 'america/panama': -5, 'america/quito': -5, 'america/jamaica': -5,
    'america/chicago': -6, 'america/mexico_city': -6, 'america/winnipeg': -6, 'america/guatemala': -6,
    'america/denver': -7, 'america/phoenix': -7, 'america/edmonton': -7,
    'america/los_angeles': -8, 'america/vancouver': -8, 'america/tijuana': -8,
    'america/anchorage': -9,
    'america/sao_paulo': -3, 'america/argentina/buenos_aires': -3, 'america/santiago': -4, 'america/caracas': -4, 'america/halifax': -4, 'america/la_paz': -4, 'america/puerto_rico': -4, 'america/santo_domingo': -4,
    'america/honolulu': -10, 'pacific/honolulu': -10,
    'australia/sydney': 10, 'australia/melbourne': 10, 'australia/brisbane': 10, 'australia/canberra': 10, 'australia/hobart': 10,
    'australia/perth': 8, 'australia/adelaide': 9.5, 'australia/darwin': 9.5,
    'pacific/auckland': 12, 'pacific/fiji': 12, 'pacific/guam': 10, 'pacific/port_moresby': 10,
    'africa/cairo': 2, 'africa/johannesburg': 2, 'africa/nairobi': 3, 'africa/lagos': 1, 'africa/casablanca': 1, 'africa/algiers': 1, 'africa/accra': 0
  };
  return (map[t] !== undefined) ? map[t] : null;
}

// 短链防护规则评估（服务端信号：UA / Accept-Language / IP / IP情报，无浏览器时区与 WebRTC）
function evaluateProtection(rules, ctx) {
  var r = rules || {};
  var triggered = [];
  if (on(r.crawler)) {
    var engines = (r.crawler.engines && r.crawler.engines.length) ? r.crawler.engines : ['google', 'facebook', 'tiktok'];
    var hit = detectCrawler(ctx.ua);
    if (hit && engines.indexOf(hit) !== -1) triggered.push('crawler');
  }
  if (on(r.device)) {
    var mode = r.device.mode || 'block';
    var list = r.device.list || [];
    var inList = list.indexOf(ctx.device) !== -1;
    if (mode === 'allow' ? !inList : inList) triggered.push('device');
  }
  if (on(r.language)) {
    var lmode = r.language.mode || 'block';
    var llist = (r.language.list || []).map(normLang);
    var lin = llist.indexOf(normLang(ctx.lang)) !== -1;
    if (lmode === 'allow' ? !lin : lin) triggered.push('language');
  }
  if (on(r.timezone)) {
    var tmode = r.timezone.mode || 'block';
    var tin = tzMatch(r.timezone.list || [], ctx.tzOffset, ctx.tzIANA);
    if (tmode === 'allow' ? !tin : tin) triggered.push('timezone');
  }
  if (on(r.block_ips)) {
    var ips = r.block_ips.list || [];
    if (ctx.ip && ips.indexOf(ctx.ip) !== -1) triggered.push('block_ips');
  }
  if (on(r.privacy) || on(r.vpn) || on(r.proxy)) {
    var intelBad = !!(ctx.ipIntel && (ctx.ipIntel.is_datacenter || ctx.ipIntel.is_vpn || ctx.ipIntel.is_proxy || ctx.ipIntel.is_tor));
    if (intelBad) triggered.push('privacy');
  }
  return triggered;
}

async function getIpInfo(env, ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  var cacheKey = 'rd:ipinfo:v2:' + ip;
  try { var cached = await env.kvadmin.get(cacheKey); if (cached) return JSON.parse(cached); } catch (e) {}
  var token = env.IPINFO_TOKEN || '';
  var url = 'https://ipinfo.io/' + encodeURIComponent(ip) + '/json' + (token ? '?token=' + token : '');
  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 500);
    var res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    var data = await res.json();
    var out = { timezone: data.timezone || '', country: data.country || '', region: data.region || '' };
    try { await env.kvadmin.put(cacheKey, JSON.stringify(out), { expirationTtl: 600 }); } catch (e) {}
    return out;
  } catch (e) { return null; }
}

// IP 情报（机房/VPN/代理/Tor）——api.ipapi.is 查询（key 来自 env.IPAPI_KEY）
async function getIpIntel(env, ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  var cacheKey = 'rd:ipintel:v2:' + ip;
  try { var cached = await env.kvadmin.get(cacheKey); if (cached) return JSON.parse(cached); } catch (e) {}
  try {
    var key = env.IPAPI_KEY || '';
    var url = 'https://api.ipapi.is?q=' + encodeURIComponent(ip) + (key ? '&key=' + encodeURIComponent(key) : '');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 800);
    var res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    var d = await res.json();
    var out = { is_datacenter: !!d.is_datacenter, is_vpn: !!d.is_vpn, is_proxy: !!d.is_proxy, is_tor: !!d.is_tor };
    try { await env.kvadmin.put(cacheKey, JSON.stringify(out), { expirationTtl: 3600 }); } catch (e) {}
    return out;
  } catch (e) { return null; }
}

// 按模式挑选目标：weighted 按权重比例，random 均匀随机；权重全 0 时兜底均匀随机
function pickTarget(targets, mode) {
  if (!targets || !targets.length) return null;
  if (targets.length === 1) return targets[0];
  if (mode === 'weighted') {
    var weights = targets.map(function (t) { return Math.max(0, parseInt(t.weight, 10) || 0); });
    var total = 0;
    for (var i = 0; i < weights.length; i++) total += weights[i];
    if (total > 0) {
      var r = Math.random() * total;
      var acc = 0;
      for (var j = 0; j < targets.length; j++) {
        acc += weights[j];
        if (r < acc) return targets[j];
      }
      return targets[targets.length - 1];
    }
  }
  return targets[Math.floor(Math.random() * targets.length)];
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = String((params && params.id) || '').toLowerCase();
  try {
    if (!/^[a-z0-9]{8}$/.test(id)) {
      return new Response(JSON.stringify({ error: '短链不存在' }), { status: 404, headers: jsonHeaders });
    }

    var link;
    try {
      link = await env.DB.prepare('SELECT id, username, domain, mode, enabled FROM rd_links WHERE id = ?1').bind(id).first();
    } catch (e) { link = null; }
    if (!link || link.enabled !== 1) {
      return new Response(JSON.stringify({ error: '短链不存在或已禁用' }), { status: 404, headers: jsonHeaders });
    }

    var ip = request.headers.get('CF-Connecting-IP') || '';
    var ua = request.headers.get('User-Agent') || '';
    var acceptLang = request.headers.get('Accept-Language') || '';

    // ── 短链防护（rd_protection）：开启后先判定，命中规则则拦截 ──
    var protection = null;
    try {
      var pRow = await env.DB.prepare('SELECT enabled, whitelist_ips, rules, fallback_url FROM rd_protection WHERE link_id = ?1').bind(id).first();
      if (pRow) protection = { enabled: pRow.enabled, whitelist_ips: parseJson(pRow.whitelist_ips, []), rules: parseJson(pRow.rules, {}), fallback_url: pRow.fallback_url || '' };
    } catch (e) {}

    if (protection && protection.enabled === 1) {
      var whitelist = protection.whitelist_ips || [];
      var whitelisted = Array.isArray(whitelist) && ip && whitelist.indexOf(ip) !== -1;
      var triggered = [];
      if (!whitelisted) {
        var device = detectDevice(ua);
        var rules = protection.rules || {};
        var needTz = on(rules.timezone);
        var needIntel = on(rules.privacy) || on(rules.vpn) || on(rules.proxy);
        var ipTz = '';
        var ipIntel = null;
        if (needTz) { var ipInfo = await getIpInfo(env, ip); if (ipInfo) ipTz = ipInfo.timezone || ''; }
        if (needIntel) { ipIntel = await getIpIntel(env, ip); }
        triggered = evaluateProtection(rules, { ip: ip, ua: ua, device: device, lang: acceptLang, tzOffset: ianaOffset(ipTz), tzIANA: ipTz, ipIntel: ipIntel });
      }
      if (triggered.length) {
        var fb = protection.fallback_url || '';
        if (fb) {
          return new Response(null, { status: 302, headers: { 'Location': fb, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
        }
        return new Response(JSON.stringify({ error: '短链不存在或已禁用' }), { status: 404, headers: jsonHeaders });
      }
    }

    var tr;
    try {
      tr = await env.DB.prepare('SELECT type, url, weight FROM rd_targets WHERE link_id = ?1 ORDER BY sort ASC, id ASC').bind(id).all();
    } catch (e) { tr = null; }
    var targets = (tr && tr.results) ? tr.results : [];
    if (!targets.length) {
      return new Response(JSON.stringify({ error: '短链未配置目标链接' }), { status: 404, headers: jsonHeaders });
    }

    var chosen = pickTarget(targets, link.mode);
    if (!chosen || !chosen.url) {
      return new Response(JSON.stringify({ error: '短链目标链接无效' }), { status: 404, headers: jsonHeaders });
    }

    var device = detectDevice(ua);
    var fromUrl = (link.domain || '') + '/' + id;

    // 记录跳转统计（不阻塞 302，失败静默）
    try {
      await env.DB.prepare('INSERT INTO rd_logs (link_id, username, domain, from_url, to_url, ip, device, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
        .bind(id, link.username || '', link.domain || '', fromUrl, chosen.url, ip, device, new Date().toISOString()).run();
    } catch (e) {}

    return new Response(null, {
      status: 302,
      headers: { 'Location': chosen.url, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '服务异常' }), { status: 500, headers: jsonHeaders });
  }
}

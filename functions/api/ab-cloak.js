// POST /api/ab-cloak — AB页斗篷判定（公开，无鉴权）
// A页守卫脚本（根目录 ab-ck.js）在页面加载时调用此接口，
// 服务端综合：白名单 → 爬虫UA → 设备 → 语言 → 时区 → IP黑名单 → VPN/代理(ipinfo)，
// 返回 { redirect }：真实用户跳 b_url，爬虫/被屏蔽（命中规则）留在 A 页（redirect=null），无配置/未开通则 redirect=null。
// 与既有斗篷(functions/api/cloak.js)完全独立，不复用其接口。

const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

function parseJson(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
function on(t) { return !!(t && t.enabled); }

function detectCrawler(ua) {
  var u = (ua || '').toLowerCase();
  if (!u) return null;
  if (u.indexOf('googlebot') !== -1 || u.indexOf('adsbot-google') !== -1 || u.indexOf('google-inspectiontool') !== -1) return 'google';
  if (u.indexOf('facebookexternalhit') !== -1 || u.indexOf('facebookcatalog') !== -1 || u.indexOf('facebookbot') !== -1) return 'facebook';
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
    if (l.indexOf('tw') !== -1 || l.indexOf('hk') !== -1 || l.indexOf('mo') !== -1 || l.indexOf('hant') !== -1) return 'zh-tw';
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
  if (on(r.vpn) && ctx.isVpn === true) triggered.push('vpn');
  if (on(r.proxy) && ctx.isProxy === true) triggered.push('proxy');

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
  var cacheKey = 'ab:ipinfo:' + ip;
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
    var out = { vpn: !!(data.privacy && data.privacy.vpn), proxy: !!(data.privacy && data.proxy) };
    try { await env.kvadmin.put(cacheKey, JSON.stringify(out), { expirationTtl: 600 }); } catch (e) {}
    return out;
  } catch (e) { return null; }
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
    var device = detectDevice(ua);
    var whitelist = config.whitelist_ips || [];
    var whitelisted = Array.isArray(whitelist) && ip && whitelist.indexOf(ip) !== -1;

    var triggered = [];
    var isVpn = false, isProxy = false;
    if (!whitelisted) {
      var rules = config.rules || {};
      var needIp = on(rules.vpn) || on(rules.proxy);
      if (needIp) {
        var ipInfo = await getIpInfo(env, ip);
        if (ipInfo) { isVpn = ipInfo.vpn; isProxy = ipInfo.proxy; }
      }
      triggered = evaluateRules(rules, { ip: ip, ua: ua, device: device, lang: clientLang, tzOffset: tzOffset, tzIANA: tzIANA, isVpn: isVpn, isProxy: isProxy });
    }

    var passed = triggered.length === 0;
    // 真实用户 → B 页；爬虫/被屏蔽（命中规则）→ 留在 A 页（不跳转）
    var redirect = passed ? (config.b_url || null) : null;

    return new Response(JSON.stringify({ redirect: redirect, passed: passed, triggered: triggered, whitelisted: whitelisted, _dbg: { a_url: config.a_url, username: config.username, device: device, ip: ip } }), { headers: jsonHeaders });
  } catch (e) {
    // 兜底不跳转，避免落地页因服务端异常被整体带走
    return new Response(JSON.stringify({ redirect: null, passed: true, error: e.message }), { headers: jsonHeaders });
  }
}

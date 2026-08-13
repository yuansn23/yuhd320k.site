// POST /api/cloak — 斗篷防护判定（公开，无鉴权）
// 落地页守卫脚本（根目录 cloak.js）在用户点击按钮时调用此接口，
// 服务端综合：白名单 → 爬虫UA → 设备 → 语言 → 时区 → IP黑名单 → VPN/代理(ipinfo) → 行为阈值，
// 返回 { passed, redirect, triggered, whitelisted }，并记录 cloak_traffic。
// 未配置/开关关闭/表不存在 → 一律放行（fail-open，避免误伤落地页正常流量）。

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
  var map = { en: 'en', ja: 'ja', de: 'de', fr: 'fr', es: 'es', it: 'it', ar: 'ar', pl: 'pl' };
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
  var cacheKey = 'cloak:ipinfo:' + ip;
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

async function resolveSite(env, rawSite) {
  var username = '';
  var matchedSite = rawSite;

  // —— username 反解：复用 pixels.js 的 site_mappings 多级匹配（精确 → 斜杠变体 → .html → 域名）——
  async function findMapping(target) {
    try {
      var m = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(target).first();
      if (m) return m;
    } catch (e) {}
    var alt = '';
    if (target.charAt(target.length - 1) === '/') alt = target.slice(0, -1);
    else if (target.indexOf('/') > 0) alt = target + '/';
    if (alt) {
      try { var m2 = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(alt).first(); if (m2) return m2; } catch (e) {}
    }
    if (target.indexOf('.') > 0 && target.indexOf('/') > 0 && target.indexOf('.html') === -1) {
      try { var m3 = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(target + '.html').first(); if (m3) return m3; } catch (e) {}
    }
    var host = target;
    try { host = new URL(target).hostname; } catch (e) {}
    if (host !== target) {
      try { var m4 = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(host).first(); if (m4) return m4; } catch (e) {}
    }
    return null;
  }
  var mapping = await findMapping(rawSite);
  if (mapping) { username = mapping.username; matchedSite = mapping.site; }

  // —— cloak_configs 解析：site 为主键，按多候选精确匹配，保证每个落地页命中各自配置 ——
  var config = null;
  var host = rawSite;
  try { host = new URL(rawSite).hostname; } catch (e) {}
  var candidates = [rawSite];
  if (rawSite.charAt(rawSite.length - 1) === '/') candidates.push(rawSite.slice(0, -1));
  else if (rawSite.indexOf('/') > 0) candidates.push(rawSite + '/');
  if (rawSite.indexOf('.') > 0 && rawSite.indexOf('/') > 0 && rawSite.indexOf('.html') === -1) candidates.push(rawSite + '.html');
  if (host !== rawSite) candidates.push(host);
  var seen = {};
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (seen[c]) continue; seen[c] = 1;
    try {
      var row = await env.DB.prepare('SELECT site, enabled, fallback_url, whitelist_ips, rules FROM cloak_configs WHERE site = ?1').bind(c).first();
      if (row) {
        config = { site: row.site, enabled: row.enabled, fallback_url: row.fallback_url, whitelist_ips: parseJson(row.whitelist_ips, []), rules: parseJson(row.rules, {}) };
        matchedSite = row.site;
        break;
      }
    } catch (e) {}
  }
  return { site: matchedSite || rawSite, username: username, config: config };
}

async function logTraffic(env, t) {
  try {
    await env.DB.prepare('INSERT INTO cloak_traffic (site, username, ip, device, terminal, lang, timezone, is_vpn, is_proxy, passed, triggered_rules, ua, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)')
      .bind(t.site || '', t.username || '', t.ip || '', t.device || '', t.terminal || t.device || '', t.lang || '', t.timezone || '', t.isVpn ? 1 : 0, t.isProxy ? 1 : 0, t.passed ? 1 : 0, JSON.stringify(t.triggered || []), (t.ua || '').substring(0, 500), new Date().toISOString()).run();
  } catch (e) {}
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      }});
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders });
    }

    const body = await request.json();
    const preflight = !!(body.preflight);
    const rawSite = (body.site || '').trim();
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ua = request.headers.get('User-Agent') || '';
    const acceptLang = request.headers.get('Accept-Language') || '';

    const resolved = await resolveSite(env, rawSite);
    const config = resolved.config;
    const whitelist = config ? config.whitelist_ips : [];
    const whitelisted = Array.isArray(whitelist) && ip && whitelist.indexOf(ip) !== -1;

    if (preflight) {
      // 预热 ipinfo 缓存（不记录流量、不返回判定）
      if (!whitelisted) context.waitUntil(getIpInfo(env, ip));
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    var client = body.client || {};
    var behavior = body.behavior || {};
    var tzOffset = (typeof client.timezoneOffset === 'number') ? client.timezoneOffset : null;
    var tzIANA = client.timezoneIANA || '';
    var clientLang = client.lang || acceptLang;
    var device = detectDevice(ua);
    var timezoneStr = tzIANA || (tzOffset !== null ? String(tzOffset) : '');

    // 未配置或总开关关闭 → 放行
    if (!config || (config.enabled !== 1 && config.enabled !== true)) {
      await logTraffic(env, { site: resolved.site, username: resolved.username, ip: ip, device: device, lang: clientLang, timezone: timezoneStr, isVpn: false, isProxy: false, passed: true, triggered: [], ua: ua });
      return new Response(JSON.stringify({ passed: true, disabled: !config }), { headers: jsonHeaders });
    }

    var triggered = [];
    var isVpn = false, isProxy = false;
    if (!whitelisted) {
      var rules = config.rules || {};
      var needIp = on(rules.vpn) || on(rules.proxy);
      if (needIp) {
        var ipInfo = await getIpInfo(env, ip);
        if (ipInfo) { isVpn = ipInfo.vpn; isProxy = ipInfo.proxy; }
      }
      triggered = evaluateRules(rules, { ip: ip, ua: ua, device: device, lang: clientLang, tzOffset: tzOffset, tzIANA: tzIANA, isVpn: isVpn, isProxy: isProxy, behavior: behavior });
    }

    var passed = triggered.length === 0;
    var redirect = config.fallback_url || 'https://www.google.com';
    await logTraffic(env, { site: resolved.site, username: resolved.username, ip: ip, device: device, lang: clientLang, timezone: timezoneStr, isVpn: isVpn, isProxy: isProxy, passed: passed, triggered: triggered, ua: ua });

    return new Response(JSON.stringify({ passed: passed, redirect: redirect, triggered: triggered, whitelisted: whitelisted }), { headers: jsonHeaders });
  } catch (e) {
    // 兜底放行，避免落地页因服务端异常被整体拦截
    return new Response(JSON.stringify({ passed: true, error: e.message }), { headers: jsonHeaders });
  }
}

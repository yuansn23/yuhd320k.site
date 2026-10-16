// POST /api/fb-capi — 服务端回传 Facebook 转化事件（Conversions API）
// 前端 SDK 在「后端 token」通道下调用；本端点只读站点的 pixel_ids + fb_events + fb_capi_token，
// 把已选事件逐个 POST 到 Facebook Graph API。fb_capi_token 只在本服务端使用，绝不返回浏览器。
//
// 请求体（前端 SDK 发送）：
//   { site, event_source_url, fbp, fbc }
// 响应：{ ok, sent, results }（sent = 实际成功回传的事件数）

const GRAPH_VERSION = 'v21.0';   // 按 Events Manager 当前支持的版本修改

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { ...CORS, 'Cache-Control': 'no-store' } });
}

// 解析站点字符串为 [hostname, pathname]（与 pixels.js / apk-url.js 一致）
function hostPath(s) {
  var host = '';
  var path = '';
  try {
    var u = new URL(s);
    host = u.hostname;
    path = u.pathname;
  } catch (e) {
    var i = s.indexOf('/');
    if (i === -1) { host = s; path = ''; }
    else { host = s.slice(0, i); path = s.slice(i); }
  }
  if (path === '/') { path = ''; }
  else if (path.length > 1 && path.charAt(path.length - 1) === '/') { path = path.slice(0, -1); }
  return [host, path];
}

// 站点解析：site_mappings → username → account_sites（复用 pixels.js 的匹配逻辑）
// 返回 { pixel_ids, fb_events, fb_capi_token } 或 null
async function resolveAccountSite(env, rawSite) {
  if (!rawSite) return null;
  var site = rawSite;
  try { site = new URL(rawSite).hostname; } catch (e) {}

  // 1) site_mappings 解析 username（精确 → 斜杠变体 → .html → 域名 → 全表 hostPath 匹配）
  var siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(rawSite).first();
  var rawSiteAlt = '';
  if (!siteRow) {
    if (rawSite.charAt(rawSite.length - 1) === '/') rawSiteAlt = rawSite.slice(0, -1);
    else if (rawSite.indexOf('/') > 0) rawSiteAlt = rawSite + '/';
    if (rawSiteAlt) siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(rawSiteAlt).first();
  }
  if (!siteRow && rawSite.indexOf('.') > 0 && rawSite.indexOf('/') > 0 && rawSite.indexOf('.html') === -1) {
    siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(rawSite + '.html').first();
  }
  if (!siteRow) siteRow = await env.DB.prepare('SELECT site, username FROM site_mappings WHERE site = ?1').bind(site).first();
  if (!siteRow) {
    var allMaps = await env.DB.prepare('SELECT site, username FROM site_mappings').all();
    if (allMaps && allMaps.results) {
      for (var mi = 0; mi < allMaps.results.length && !siteRow; mi++) {
        var mapped = allMaps.results[mi];
        if (mapped.site === rawSite || mapped.site === rawSiteAlt || mapped.site === rawSite + '.html' || mapped.site === site) { siteRow = mapped; break; }
      }
      if (!siteRow) {
        var reqHP = hostPath(rawSite);
        for (var mi = 0; mi < allMaps.results.length && !siteRow; mi++) {
          var mapped = allMaps.results[mi];
          var mHP = hostPath(mapped.site);
          if (mHP[0] === reqHP[0] && mHP[1] === reqHP[1]) { siteRow = mapped; break; }
        }
      }
    }
  }
  const username = siteRow ? siteRow.username : '';
  if (!username) return null;
  var matchedSite = siteRow ? siteRow.site : site;

  // 2) account_sites 按站点隔离（多候选匹配，逐级退化为缺列兜底）
  var matchedHost = matchedSite;
  try { matchedHost = new URL(matchedSite).hostname; } catch (e) {}
  var rawHost = rawSite;
  try { rawHost = new URL(rawSite).hostname; } catch (e) {}

  var candidates = [rawSite];
  if (rawSite.charAt(rawSite.length - 1) === '/') candidates.push(rawSite.slice(0, -1));
  else if (rawSite.indexOf('/') > 0) candidates.push(rawSite + '/');
  if (rawHost !== rawSite && rawHost !== candidates[candidates.length - 1]) candidates.push(rawHost);
  if (matchedSite !== rawSite && matchedSite !== rawHost && matchedSite !== candidates[candidates.length - 1]) candidates.push(matchedSite);
  if (matchedHost !== matchedSite && matchedHost !== rawSite && matchedHost !== rawHost && matchedHost !== candidates[candidates.length - 1]) candidates.push(matchedHost);

  var d1Row = null;
  for (var ci = 0; ci < candidates.length && (!d1Row || !d1Row.pixel_ids || d1Row.pixel_ids === '[]'); ci++) {
    try {
      var row = await env.DB.prepare('SELECT pixel_ids, fb_events, fb_capi_token FROM account_sites WHERE site = ?1 AND username = ?2').bind(candidates[ci], username).first();
      if (row) d1Row = row;
    } catch (e) {
      try {
        var row2 = await env.DB.prepare('SELECT pixel_ids, fb_events FROM account_sites WHERE site = ?1 AND username = ?2').bind(candidates[ci], username).first();
        if (row2) d1Row = row2;
      } catch (e2) {
        try {
          var row3 = await env.DB.prepare('SELECT pixel_ids FROM account_sites WHERE site = ?1 AND username = ?2').bind(candidates[ci], username).first();
          if (row3) d1Row = row3;
        } catch (e3) {}
      }
    }
  }
  if (!d1Row) return null;

  var pixel_ids = [];
  try { pixel_ids = JSON.parse(d1Row.pixel_ids || '[]'); } catch (e) {}
  var fb_events = null;
  if (typeof d1Row.fb_events !== 'undefined' && d1Row.fb_events !== null) {
    try { fb_events = JSON.parse(d1Row.fb_events); } catch (e) {}
  }
  if (!Array.isArray(fb_events)) fb_events = ['AddToCart', 'Contact', 'Lead', 'CompleteRegistration', 'Purchase', 'Download', 'Subscribe', 'InitiateCheckout'];
  var fb_capi_token = (typeof d1Row.fb_capi_token === 'string') ? d1Row.fb_capi_token : '';

  return { pixel_ids, fb_events, fb_capi_token };
}

function genEventId(pid, i) {
  try { return crypto.randomUUID(); }
  catch (e) { return String(Date.now()) + '-' + pid + '-' + i + '-' + Math.random().toString(36).slice(2, 10); }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed', sent: 0 }, 405);
  }

  try {
    const body = await request.json();
    const rawSite = body.site || url.searchParams.get('site') || '';
    const eventSourceUrl = (body.event_source_url || rawSite || '').slice(0, 2000);
    const fbp = (body.fbp || '').slice(0, 200);
    const fbc = (body.fbc || '').slice(0, 200);

    const resolved = await resolveAccountSite(env, rawSite);
    if (!resolved) return json({ ok: false, error: 'site not found', sent: 0 });

    const token = resolved.fb_capi_token || '';
    if (!token) return json({ ok: false, error: '未配置 API token', sent: 0 });

    const pixelIds = resolved.pixel_ids.filter(function(id) { return /^\d{10,20}$/.test(id); });
    const events = resolved.fb_events;
    if (!pixelIds.length || !events.length) return json({ ok: false, error: '未配置像素或事件', sent: 0 });

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ua = request.headers.get('User-Agent') || '';
    const now = Math.floor(Date.now() / 1000);

    // 逐像素转发：一个像素一条 Graph API 请求，事件合并到 data 数组
    let sent = 0;
    const results = await Promise.all(pixelIds.map(async function(pid) {
      const data = events.map(function(ev, i) {
        var ud = {
          client_ip_address: ip,
          client_user_agent: ua
        };
        if (fbp) ud.fbp = fbp;
        if (fbc) ud.fbc = fbc;
        return {
          event_name: ev,
          event_time: now,
          event_id: genEventId(pid, i),
          event_source_url: eventSourceUrl,
          action_source: 'website',
          user_data: ud
        };
      });
      try {
        const r = await fetch('https://graph.facebook.com/' + GRAPH_VERSION + '/' + pid + '/events?access_token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: data })
        });
        const txt = await r.text();
        var resp; try { resp = JSON.parse(txt); } catch (e) { resp = { raw: txt.slice(0, 200) }; }
        if (r.ok) sent += data.length;
        return { pixel: pid, ok: r.ok, status: r.status, resp: resp };
      } catch (e) {
        return { pixel: pid, ok: false, error: e.message };
      }
    }));

    return json({ ok: true, sent: sent, results: results });
  } catch (e) {
    return json({ ok: false, error: e.message, sent: 0 }, 500);
  }
}

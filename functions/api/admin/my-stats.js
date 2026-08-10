// GET /api/admin/my-stats — 子账户下载统计 + 上传历史
// v3: 计数器 D1 优先，KV 回退 + 自动迁移
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    // D1 优先
    var account = await env.DB.prepare('SELECT password, site FROM accounts WHERE username = ?1').bind(user).first();
    // KV 回退
    if (!account) {
      var kvRaw = await env.kvadmin.get('account:' + user);
      if (kvRaw) { account = JSON.parse(kvRaw); account.password = account.pw; }
    }
    if (!account) return null;
    if (auth !== 'Basic ' + btoa(user + ':' + role + ':' + (account.password || account.pw))) return null;
    return { user, role, site: account.site || '' };
  } catch (e) { return null; }
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

    var total = 0;
    var daily = [];
    var dailyBySite = {};

    // 1. D1 每日数据 + KV 旧每日数据
    const past30 = new Date();
    past30.setDate(past30.getDate() - 30);
    const dateFrom = past30.toISOString().slice(0, 10);

    var now = new Date();
    var dayKV = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKV.push({ key: me.user + ':download_' + d.toISOString().slice(0, 10), date: d.toISOString().slice(0, 10) });
    }

    const d1Result = await env.DB.prepare('SELECT date, site, count FROM download_counts WHERE username = ?1 AND date >= ?2 ORDER BY date DESC').bind(me.user, dateFrom).all();

    // 2. 按站点汇总
    var d1Map = {};
    if (d1Result && d1Result.results) {
      for (var r = 0; r < d1Result.results.length; r++) {
        var row = d1Result.results[r];
        d1Map[row.date] = (d1Map[row.date] || 0) + row.count;
        total += row.count;
        // 按站点分组
        var s = row.site || '';
        if (!dailyBySite[s]) dailyBySite[s] = {};
        dailyBySite[s][row.date] = (dailyBySite[s][row.date] || 0) + row.count;
      }
    }

    // 3. 输出合并后的每日数据
    var dates = Object.keys(d1Map).sort().reverse();
    for (var k = 0; k < dates.length; k++) {
      daily.push({ date: dates[k], count: d1Map[dates[k]] });
    }
    // 按站点输出
    var dailyBySiteArr = {};
    Object.keys(dailyBySite).forEach(function(site){
      dailyBySiteArr[site] = [];
      var sd = Object.keys(dailyBySite[site]).sort().reverse();
      for (var si = 0; si < sd.length; si++) {
        dailyBySiteArr[site].push({ date: sd[si], count: dailyBySite[site][sd[si]] });
      }
    });

    // 并行读取配置（按站点隔离：有 site 参数读 account_sites，无则读 accounts）
    var qSite = (new URL(request.url)).searchParams.get('site') || '';
    var apkUrl = '';
    var history = [];
    var fromAccountSites = false;
    if (qSite) {
      try {
        var siteCfg = await env.DB.prepare('SELECT apk_url, apk_history FROM account_sites WHERE site = ?1 AND username = ?2').bind(qSite, me.user).first();
        if (siteCfg) {
          fromAccountSites = true;
          apkUrl = siteCfg.apk_url || '';
          if (siteCfg.apk_history) { try { history = JSON.parse(siteCfg.apk_history); } catch (e) {} }
        }
      } catch (e) {}
    }
    // 回退 accounts 表（无 site 参数，或 account_sites 中没有该站点）
    if (!fromAccountSites) {
      try {
        var cfg = await env.DB.prepare('SELECT apk_url, apk_history FROM accounts WHERE username = ?1').bind(me.user).first();
        if (cfg) {
          apkUrl = apkUrl || cfg.apk_url || '';
          if (!history.length && cfg.apk_history) { try { history = JSON.parse(cfg.apk_history); } catch (e) {} }
        }
      } catch (e) {}
    }
    // KV 回退
    if (!apkUrl && !history.length) {
      try {
        var [kvUrl, kvHist] = await Promise.all([
          env.kvadmin.get(me.user + ':apk_url'),
          env.kvadmin.get(me.user + ':apk_history')
        ]);
        if (kvUrl) apkUrl = kvUrl;
        if (kvHist) history = JSON.parse(kvHist);
      } catch (e) {}
    }

    // 获取所有站点列表（account_sites 优先，老数据从 accounts 兜底）
    var sites = [];
    try {
      var sr = await env.DB.prepare('SELECT site, pixel_ids, apk_url FROM account_sites WHERE username = ?1').bind(me.user).all();
      if (sr && sr.results && sr.results.length) {
        sites = sr.results.map(function(r){
          var pids = JSON.parse(r.pixel_ids || '[]');
          return { site: r.site, pixelCount: pids.length, apkUrl: r.apk_url || '' };
        });
      }
    } catch (e) {}
    // 老数据兜底：account_sites 为空但 accounts.site 有值
    if (!sites.length && me.site) {
      try {
        var acctRow = await env.DB.prepare('SELECT pixel_ids, apk_url FROM accounts WHERE username = ?1').bind(me.user).first();
        var pids = (acctRow && acctRow.pixel_ids) ? JSON.parse(acctRow.pixel_ids) : [];
        var apk = (acctRow && acctRow.apk_url) ? acctRow.apk_url : '';
        sites = [{ site: me.site, pixelCount: pids.length, apkUrl: apk }];
      } catch (e) {}
    }

    // 流量统计
    var visitTotal = 0, visitToday = 0;
    try {
      var vt = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM visit_logs WHERE username = ?1').bind(me.user).first();
      visitTotal = vt ? vt.cnt : 0;
      var vtd = new Date().toISOString().slice(0,10);
      var vtr = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM visit_logs WHERE username = ?1 AND visit_time >= ?2').bind(me.user, vtd).first();
      visitToday = vtr ? vtr.cnt : 0;
    } catch(e) {}

    return new Response(JSON.stringify({ total, apkUrl: apkUrl, history: history, daily, dailyBySite: dailyBySiteArr, site: me.site, sites: sites, visitTotal: visitTotal, visitToday: visitToday }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=15' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

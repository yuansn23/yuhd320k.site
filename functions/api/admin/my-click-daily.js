// GET /api/admin/my-click-daily — 子账户点击按天统计报表
// 与 my-click-logs 的明细列表不同：这里按 date + site 聚合，返回每日总数 + 各站点每日分布。
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    var account = await env.DB.prepare('SELECT password, site FROM accounts WHERE username = ?1').bind(user).first();
    if (!account) { var kvRaw = await env.kvadmin.get('account:' + user); if (kvRaw) { account = JSON.parse(kvRaw); account.password = account.pw; } }
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

    const url = new URL(request.url);
    const filterSite = url.searchParams.get('site') || '';
    const dateStart = url.searchParams.get('start') || '';
    const dateEnd = url.searchParams.get('end') || '';

    // 构建查询条件（click_logs.click_time 为 ISO UTC 字符串）
    var whereBase = 'username = ?1';
    var condParams = [me.user];
    var idx = 2;
    if (filterSite) { whereBase += ' AND site = ?' + (idx++); condParams.push(filterSite); }
    if (dateStart) { whereBase += ' AND click_time >= ?' + (idx++); condParams.push(dateStart + 'T00:00:00.000Z'); }
    if (dateEnd) { whereBase += ' AND click_time <= ?' + (idx++); condParams.push(dateEnd + 'T23:59:59.999Z'); }

    // 按 date + site 聚合（仅保留最近 5 天数据，表规模有界）
    var sql = 'SELECT substr(click_time, 1, 10) AS date, site, COUNT(*) AS cnt FROM click_logs WHERE ' + whereBase + ' GROUP BY substr(click_time, 1, 10), site ORDER BY date DESC';

    var result = null;
    if (condParams.length === 1) result = await env.DB.prepare(sql).bind(condParams[0]).all();
    else if (condParams.length === 2) result = await env.DB.prepare(sql).bind(condParams[0], condParams[1]).all();
    else if (condParams.length === 3) result = await env.DB.prepare(sql).bind(condParams[0], condParams[1], condParams[2]).all();
    else result = await env.DB.prepare(sql).bind(condParams[0], condParams[1], condParams[2], condParams[3]).all();

    // 汇总成：每日总数 + 各站点每日分布
    var dailyMap = {};      // date -> total
    var bySite = {};        // site -> { date -> count }
    var siteSet = {};
    var total = 0;
    if (result && result.results) {
      result.results.forEach(function(r){
        var cnt = r.cnt || 0;
        var d = r.date;
        var s = r.site || '默认站点';
        dailyMap[d] = (dailyMap[d] || 0) + cnt;
        if (!bySite[s]) bySite[s] = {};
        bySite[s][d] = (bySite[s][d] || 0) + cnt;
        siteSet[s] = true;
        total += cnt;
      });
    }

    var daily = Object.keys(dailyMap).sort().reverse().map(function(d){ return { date: d, count: dailyMap[d] }; });
    var dailyBySite = {};
    Object.keys(bySite).sort().forEach(function(s){
      dailyBySite[s] = Object.keys(bySite[s]).sort().reverse().map(function(d){ return { date: d, count: bySite[s][d] }; });
    });

    return new Response(JSON.stringify({ total: total, daily: daily, dailyBySite: dailyBySite, sites: Object.keys(siteSet).sort() }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=15' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

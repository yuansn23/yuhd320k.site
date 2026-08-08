// GET /api/admin/download-count — 返回下载统计（总计 + 按日期）
// v2: 从合并后的 username:stats 读取，adapter 直接使用旧 key（全局计数器）
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const user = env.ADMIN_USER || '';
    const pass = env.ADMIN_PASS || '';
    const auth = request.headers.get('Authorization') || '';
    if (auth !== 'Basic ' + btoa(user + ':' + pass)) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 尝试从合并后的 stats key 读取（无用户名前缀的全局 key 或 'admin:stats'）
    const statsRaw = (await env.kvadmin.get('stats')) || (await env.kvadmin.get('admin:stats')) || '';
    if (statsRaw) {
      const stats = JSON.parse(statsRaw);
      var daily = [];
      var now = new Date();
      for (var i = 29; i >= 0; i--) {
        var d = new Date(now);
        d.setDate(d.getDate() - i);
        var ds = d.toISOString().slice(0, 10);
        var count = stats.days[ds] || 0;
        if (count > 0) daily.push({ date: ds, count: count });
      }
      return new Response(JSON.stringify({ total: stats.total || 0, daily: daily }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 回退：从旧格式并行读取最近30天
    var totalLegacy = parseInt((await env.kvadmin.get('download_count')) || '0');
    var dailyLegacy = [];
    var nowLegacy = new Date();
    var legacyKeys = [];
    for (var j = 29; j >= 0; j--) {
      var dd = new Date(nowLegacy);
      dd.setDate(dd.getDate() - j);
      legacyKeys.push({ key: 'download_' + dd.toISOString().slice(0, 10), date: dd.toISOString().slice(0, 10) });
    }
    var legacyResults = await Promise.all(legacyKeys.map(function(dk){ return env.kvadmin.get(dk.key); }));
    for (var k = 0; k < legacyResults.length; k++) {
      var count = parseInt(legacyResults[k] || '0');
      if (count > 0) dailyLegacy.push({ date: legacyKeys[k].date, count: count });
    }

    return new Response(JSON.stringify({ total: totalLegacy, daily: dailyLegacy }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ total: 0, daily: [], error: e.message }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// GET /api/admin/my-stats — 子账户下载统计 + 上传历史
// v2: 从合并后的 username:stats 读取计数器，大幅减少 KV 读取次数
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    const raw = await env.kvadmin.get('account:' + user);
    if (!raw) return null;
    const account = JSON.parse(raw);
    if (auth !== 'Basic ' + btoa(user + ':' + role + ':' + account.pw)) return null;
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
    const prefix = me.user + ':';

    // 并行读取：合并后的统计数据 + APK URL + 上传历史（仅 3 次 KV read）
    const [statsRaw, apkUrl, historyRaw] = await Promise.all([
      env.kvadmin.get(prefix + 'stats'),
      env.kvadmin.get(prefix + 'apk_url'),
      env.kvadmin.get(prefix + 'apk_history')
    ]);

    const history = JSON.parse(historyRaw || '[]');

    // 解析合并后的统计数据
    var total = 0;
    var daily = [];
    var now = new Date();

    if (statsRaw) {
      // v2 格式：{ total, days: {"YYYY-MM-DD": N} }
      const stats = JSON.parse(statsRaw);
      total = stats.total || 0;
      // 构建最近 30 天的每日数据
      for (var i = 29; i >= 0; i--) {
        var d = new Date(now);
        d.setDate(d.getDate() - i);
        var dateStr = d.toISOString().slice(0, 10);
        var count = stats.days[dateStr] || 0;
        if (count > 0) daily.push({ date: dateStr, count: count });
      }
    } else {
      // 向后兼容：从旧格式 key 读取（v1 → v2 迁移期）
      var totalRaw = await env.kvadmin.get(prefix + 'download_count');
      total = parseInt(totalRaw || '0');
      // 并行读取最近 30 天的每日 key 作为回退
      var dayKeysLegacy = [];
      for (var j = 29; j >= 0; j--) {
        var dd = new Date(now);
        dd.setDate(dd.getDate() - j);
        dayKeysLegacy.push({ key: prefix + 'download_' + dd.toISOString().slice(0, 10), date: dd.toISOString().slice(0, 10) });
      }
      var dayResultsLegacy = await Promise.all(dayKeysLegacy.map(function(dk){ return env.kvadmin.get(dk.key); }));
      for (var k = 0; k < dayResultsLegacy.length; k++) {
        var c = parseInt(dayResultsLegacy[k] || '0');
        if (c > 0) daily.push({ date: dayKeysLegacy[k].date, count: c });
      }
    }

    return new Response(JSON.stringify({ total, apkUrl: apkUrl || '', history, daily, site: me.site }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=15' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

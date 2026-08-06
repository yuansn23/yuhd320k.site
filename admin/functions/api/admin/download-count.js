// GET /api/admin/download-count — 返回下载统计（总计 + 按日期）
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

    const total = parseInt((await env.APK_STORE.get('download_count')) || '0');

    // 列出所有 download_YYYY-MM-DD 的 key（KV 不支持 list，用已知日期推算最近30天）
    var daily = [];
    var now = new Date();
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(d.getDate() - i);
      var key = 'download_' + d.toISOString().slice(0, 10);
      var count = parseInt((await env.APK_STORE.get(key)) || '0');
      if (count > 0) daily.push({ date: key.replace('download_', ''), count: count });
    }

    return new Response(JSON.stringify({ total: total, daily: daily }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ total: 0, daily: [], error: e.message }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

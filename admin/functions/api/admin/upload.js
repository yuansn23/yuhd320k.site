// POST /api/admin/upload — 上传APK + 记录历史
export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      }});
    }

    const user = env.ADMIN_USER || '';
    const pass = env.ADMIN_PASS || '';
    const auth = request.headers.get('Authorization') || '';
    if (auth !== 'Basic ' + btoa(user + ':' + pass)) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic realm="Admin"', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const formData = await request.formData();
    const file = formData.get('apk');
    if (!file || !file.name) {
      return new Response(JSON.stringify({ error: '请选择文件' }), {
        status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const ext = file.name.split('.').pop() || 'apk';
    const key = 'apk/app-' + Date.now() + '.' + ext;

    await env.APK_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: 'application/vnd.android.package-archive' }
    });

    const publicUrl = 'https://www.many625k.site/' + key;
    const now = new Date().toISOString();
    const record = { url: publicUrl, key: key, filename: file.name, time: now };

    // KV 写入（如果 KV 未绑定则跳过，R2 上传已成功）
    var kvOk = true;
    try {
      await env.kvadmin.put('latest_apk_url', publicUrl);
      const raw = (await env.kvadmin.get('upload_history')) || '[]';
      const history = JSON.parse(raw);
      history.unshift(record);
      if (history.length > 50) history.length = 50;
      await env.kvadmin.put('upload_history', JSON.stringify(history));
    } catch (kvErr) {
      kvOk = false;
    }

    return new Response(JSON.stringify({ ok: true, url: record.url, key: record.key, filename: record.filename, time: record.time, kvOk: kvOk }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

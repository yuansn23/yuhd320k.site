// GET/POST /api/admin/my-apk — 子账户管理自己的APK（手动URL或上传）
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
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      }});
    }

    const me = await getMyUser(request, env);
    if (!me) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    const prefix = me.user + ':';

    // GET — 返回当前APK URL
    if (request.method === 'GET') {
      const url = (await env.kvadmin.get(prefix + 'apk_url')) || '';
      return new Response(JSON.stringify({ url }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // POST — 手动设置URL 或 上传文件
    if (request.method === 'POST') {
      const ct = request.headers.get('Content-Type') || '';
      var apkUrl = '';

      if (ct.includes('multipart/form-data')) {
        // 文件上传
        const fd = await request.formData();
        const file = fd.get('apk');
        if (file && file.name) {
          const ext = file.name.split('.').pop() || 'apk';
          const key = 'apk/' + me.user + '-' + Date.now() + '.' + ext;
          await env.APK_BUCKET.put(key, file.stream(), {
            httpMetadata: { contentType: 'application/vnd.android.package-archive' }
          });
          apkUrl = 'https://www.many625k.site/' + key;
          // 记录历史
          const raw = (await env.kvadmin.get(prefix + 'apk_history')) || '[]';
          const history = JSON.parse(raw);
          history.unshift({ url: apkUrl, filename: file.name, time: new Date().toISOString() });
          if (history.length > 50) history.length = 50;
          await env.kvadmin.put(prefix + 'apk_history', JSON.stringify(history));
        }
      } else {
        // 手动输入URL
        const body = await request.json();
        apkUrl = (body.url || '').trim();
        if (apkUrl) {
          const raw = (await env.kvadmin.get(prefix + 'apk_history')) || '[]';
          const history = JSON.parse(raw);
          history.unshift({ url: apkUrl, filename: '(手动输入)', time: new Date().toISOString() });
          if (history.length > 50) history.length = 50;
          await env.kvadmin.put(prefix + 'apk_history', JSON.stringify(history));
        }
      }

      if (apkUrl) {
        await env.kvadmin.put(prefix + 'apk_url', apkUrl);
        return new Response(JSON.stringify({ ok: true, url: apkUrl }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response(JSON.stringify({ error: '请提供URL或上传文件' }), {
        status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

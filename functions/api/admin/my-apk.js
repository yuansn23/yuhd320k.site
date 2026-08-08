// GET/POST /api/admin/my-apk — 子账户管理自己的APK（手动URL或上传）
// v3: APK 配置存储 D1 优先，KV 回退 + 自动迁移
async function getMyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    const user = parts[0], role = parts[1];
    var account = await env.DB.prepare('SELECT password, site FROM accounts WHERE username = ?1').bind(user).first();
    if (!account) {
      var kvRaw = await env.kvadmin.get('account:' + user);
      if (kvRaw) { account = JSON.parse(kvRaw); account.password = account.pw; }
    }
    if (!account) return null;
    if (auth !== 'Basic ' + btoa(user + ':' + role + ':' + (account.password || account.pw))) return null;
    return { user, role, site: account.site || '' };
  } catch (e) { return null; }
}

// 读 apk_url + apk_history（D1 优先，KV 回退）
async function loadConfig(env, user) {
  var config = { apkUrl: '', history: [] };
  try {
    var row = await env.DB.prepare('SELECT apk_url, apk_history FROM accounts WHERE username = ?1').bind(user).first();
    if (row) {
      config.apkUrl = row.apk_url || '';
      if (row.apk_history) {
        try { config.history = JSON.parse(row.apk_history); } catch (e) {}
      }
    }
  } catch (e) {}

  // KV 回退
  if (!config.apkUrl && !config.history.length) {
    try {
      var kvUrl = await env.kvadmin.get(user + ':apk_url');
      var kvHist = await env.kvadmin.get(user + ':apk_history');
      if (kvUrl) config.apkUrl = kvUrl;
      if (kvHist) config.history = JSON.parse(kvHist);
      // 自动迁移
      if (kvUrl || kvHist) {
        env.DB.prepare('UPDATE accounts SET apk_url = ?1, apk_history = ?2 WHERE username = ?3')
          .bind(kvUrl || '', kvHist || '[]', user).run().catch(function(){});
      }
    } catch (e) {}
  }
  return config;
}

// 保存配置：D1 优先，失败则写 KV（兼容未执行 ALTER TABLE 的情况）
async function saveConfig(env, user, apkUrl, history) {
  var d1Ok = false;
  try {
    await env.DB.prepare('UPDATE accounts SET apk_url = ?1, apk_history = ?2 WHERE username = ?3')
      .bind(apkUrl, JSON.stringify(history), user).run();
    d1Ok = true;
  } catch (e) { /* D1 列不存在时回退 KV */ }

  // D1 失败时走 KV 写入
  if (!d1Ok) {
    await env.kvadmin.put(user + ':apk_url', apkUrl);
    await env.kvadmin.put(user + ':apk_history', JSON.stringify(history));
  }
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

    // ── GET ──
    if (request.method === 'GET') {
      var config = await loadConfig(env, me.user);
      return new Response(JSON.stringify({ url: config.apkUrl }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST ──
    if (request.method === 'POST') {
      const ct = request.headers.get('Content-Type') || '';
      var apkUrl = '';
      var config = await loadConfig(env, me.user);
      var history = config.history;

      if (ct.includes('multipart/form-data')) {
        // 文件上传 → R2
        const fd = await request.formData();
        const file = fd.get('apk');
        if (file && file.name) {
          const ext = file.name.split('.').pop() || 'apk';
          const key = 'apk/app-' + Date.now() + '.' + ext;
          await env.r2admin.put(key, file.stream(), {
            httpMetadata: { contentType: 'application/vnd.android.package-archive' }
          });
          apkUrl = 'https://' + (new URL(request.url).hostname) + '/api/dl?key=' + encodeURIComponent(key);
          history.unshift({ url: apkUrl, filename: file.name, time: new Date().toISOString() });
          if (history.length > 50) history.length = 50;
        }
      } else {
        const body = await request.json();
        if (body.history) {
          // 仅更新历史（删除记录等场景）
          await saveConfig(env, me.user, config.apkUrl, body.history);
          return new Response(JSON.stringify({ ok: true, msg: '历史已更新' }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        apkUrl = (body.url || '').trim();
        if (apkUrl) {
          history.unshift({ url: apkUrl, filename: '(手动输入)', time: new Date().toISOString() });
          if (history.length > 50) history.length = 50;
        }
      }

      if (apkUrl) {
        await saveConfig(env, me.user, apkUrl, history);
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

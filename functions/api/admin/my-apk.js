// GET/POST /api/admin/my-apk?site=xxx — 子账户APK管理（支持多落地页）
// v6: 按站点读写 account_sites 表
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

    var qSite = '';

    // ── GET ──
    if (request.method === 'GET') {
      qSite = (new URL(request.url)).searchParams.get('site') || me.site || '';
      var apkUrl = '';
      if (qSite) {
        try {
          var row = await env.DB.prepare('SELECT apk_url, apk_history FROM account_sites WHERE site = ?1 AND username = ?2').bind(qSite, me.user).first();
          if (row && row.apk_url) apkUrl = row.apk_url;
        } catch (e) {}
      }
      if (!apkUrl) {
        try { var acc = await env.DB.prepare('SELECT apk_url FROM accounts WHERE username = ?1').bind(me.user).first(); if (acc && acc.apk_url) apkUrl = acc.apk_url; } catch (e) {}
      }
      if (!apkUrl) {
        try { apkUrl = (await env.kvadmin.get(me.user + ':apk_url')) || ''; } catch (e) {}
      }
      return new Response(JSON.stringify({ url: apkUrl }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST ──
    if (request.method === 'POST') {
      const ct = request.headers.get('Content-Type') || '';
      var apkUrl = '';

      // 按站点读历史
      if (ct.includes('application/json')) {
        var bodyText = await request.text();
        var body = JSON.parse(bodyText);
        qSite = body.site || me.site || '';
        // 先读该站点的历史
        var history = [];
        try {
          var hs = await env.DB.prepare('SELECT apk_history FROM account_sites WHERE site = ?1 AND username = ?2').bind(qSite, me.user).first();
          if (hs && hs.apk_history) history = JSON.parse(hs.apk_history);
        } catch (e) {}
        if (!history.length) {
          try { var ah = await env.DB.prepare('SELECT apk_history FROM accounts WHERE username = ?1').bind(me.user).first(); if (ah && ah.apk_history) history = JSON.parse(ah.apk_history); } catch (e) {}
        }

        if (body.history) {
          // 仅更新历史
          try {
            await env.DB.prepare('INSERT INTO account_sites (site, username, pixel_ids, apk_url, apk_history) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(site) DO UPDATE SET apk_history = ?5')
              .bind(qSite, me.user, '[]', '', JSON.stringify(body.history)).run();
          } catch (e) {
            try { await env.DB.prepare('UPDATE account_sites SET apk_history = ?1 WHERE site = ?2 AND username = ?3').bind(JSON.stringify(body.history), qSite, me.user).run(); } catch (e2) {}
          }
          return new Response(JSON.stringify({ ok: true, msg: '历史已更新' }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        apkUrl = (body.url || '').trim();
        if (apkUrl) {
          history.unshift({ url: apkUrl, filename: '(手动输入)', time: new Date().toISOString() });
          if (history.length > 50) history.length = 50;
        }
      } else if (ct.includes('multipart/form-data')) {
        var fd = await request.formData();
        var file = fd.get('apk');
        qSite = (fd.get('site') || me.site || '').toString();
        if (file && file.name) {
          var ext = file.name.split('.').pop() || 'apk';
          var key = 'apk/app-' + Date.now() + '.' + ext;
          await env.r2admin.put(key, file.stream(), {
            httpMetadata: { contentType: 'application/vnd.android.package-archive' }
          });
          apkUrl = 'https://' + (new URL(request.url).hostname) + '/api/dl?key=' + encodeURIComponent(key);
          // 读历史
          var hist = [];
          try {
            var hs2 = await env.DB.prepare('SELECT apk_history FROM account_sites WHERE site = ?1 AND username = ?2').bind(qSite, me.user).first();
            if (hs2 && hs2.apk_history) hist = JSON.parse(hs2.apk_history);
          } catch (e) {}
          hist.unshift({ url: apkUrl, filename: file.name, time: new Date().toISOString() });
          if (hist.length > 50) hist.length = 50;
        }
      }

      if (apkUrl && qSite) {
        var histJson = JSON.stringify(history || []);
        try {
          await env.DB.prepare('INSERT INTO account_sites (site, username, pixel_ids, apk_url, apk_history) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(site) DO UPDATE SET apk_url = ?4, apk_history = ?5')
            .bind(qSite, me.user, '[]', apkUrl, histJson).run();
        } catch (e) {
          try { await env.DB.prepare('UPDATE account_sites SET apk_url = ?1, apk_history = ?2 WHERE site = ?3 AND username = ?4').bind(apkUrl, histJson, qSite, me.user).run(); } catch (e2) {}
        }
        // 只写 account_sites，不污染其他站点
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

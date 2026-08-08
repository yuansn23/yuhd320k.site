// GET/POST/DELETE /api/admin/accounts — 管理员管理子账户
// v3: 账户数据从 D1 读写，告别 KV 写入限制

// 从 Authorization header 解析用户身份
function getAuthUser(request) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    return { user: parts[0], role: parts[1] };
  } catch (e) { return null; }
}

// 验证管理员权限（D1 查询）
async function checkAdmin(request, env) {
  const u = getAuthUser(request);
  if (!u || u.role !== 'admin') return false;
  const account = await env.DB.prepare('SELECT password FROM accounts WHERE username = ?1 AND role = ?2').bind(u.user, 'admin').first();
  if (!account) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth === 'Basic ' + btoa(u.user + ':admin:' + account.password);
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      }});
    }

    if (!(await checkAdmin(request, env))) {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), {
        status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── GET — 列出所有子账户 ──
    if (request.method === 'GET') {
      // 并行：D1 统计 + D1 账户列表
      const [acctsResult, statsResult] = await Promise.all([
        env.DB.prepare('SELECT username, password, role, site, created FROM accounts WHERE role = ?1 ORDER BY created DESC').bind('user').all(),
        env.DB.prepare('SELECT username, COALESCE(SUM(count), 0) AS total FROM download_counts GROUP BY username').all()
      ]);

      // 构建下载量映射
      var downloadMap = {};
      if (statsResult && statsResult.results) {
        for (var si = 0; si < statsResult.results.length; si++) {
          var row = statsResult.results[si];
          downloadMap[row.username] = row.total;
        }
      }

      // 并行读取每个子账户的 KV 配置（APK URL + 像素 ID）
      var accounts = [];
      var kvTasks = [];
      var accts = acctsResult && acctsResult.results ? acctsResult.results : [];

      for (var ai = 0; ai < accts.length; ai++) {
        (function(a){
          kvTasks.push((async function(){
            var apkUrl = await env.kvadmin.get(a.username + ':apk_url');
            var pixelsRaw = await env.kvadmin.get(a.username + ':pixel_ids');
            accounts.push({
              username: a.username,
              pw: a.password || '',
              site: a.site || '',
              created: a.created,
              stats: {
                downloads: downloadMap[a.username] || 0,
                apkUrl: apkUrl || '',
                pixels: JSON.parse(pixelsRaw || '[]')
              }
            });
          })());
        })(accts[ai]);
      }
      await Promise.all(kvTasks);

      return new Response(JSON.stringify(accounts), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST — 创建/修改子账户 ──
    if (request.method === 'POST') {
      const body = await request.json();
      const { username, password, site, action } = body;
      if (!username) {
        return new Response(JSON.stringify({ error: '用户名不能为空' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      if (username === 'admin') {
        return new Response(JSON.stringify({ error: '不能使用admin作为子账户名' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // -- 修改模式 --
      if (action === 'edit') {
        const existing = await env.DB.prepare('SELECT * FROM accounts WHERE username = ?1').bind(username).first();
        if (!existing) {
          return new Response(JSON.stringify({ error: '账户不存在' }), {
            status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        var newPass = password || existing.password;
        var newSite = site || existing.site;

        // 检查站点冲突
        if (site && site !== existing.site) {
          const conflict = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1 AND username != ?2').bind(site, username).first();
          if (conflict) {
            return new Response(JSON.stringify({ error: '站点域名 ' + site + ' 已被账户 ' + conflict.username + ' 绑定' }), {
              status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }
          // 更新站点映射
          await env.DB.prepare('DELETE FROM site_mappings WHERE username = ?1').bind(username).run();
          await env.DB.prepare('INSERT INTO site_mappings (site, username) VALUES (?1, ?2)').bind(site, username).run();
        }

        await env.DB.prepare('UPDATE accounts SET password = ?1, site = ?2 WHERE username = ?3').bind(newPass, newSite, username).run();

        return new Response(JSON.stringify({ ok: true, username, site: newSite, msg: '已修改' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // -- 创建模式 --
      if (!password || !site) {
        return new Response(JSON.stringify({ error: '账号、密码、站点域名不能为空' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // 检查站点冲突
      const conflict = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
      if (conflict) {
        return new Response(JSON.stringify({ error: '站点域名 ' + site + ' 已被账户 ' + conflict.username + ' 绑定' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // 写入 D1
      await env.DB.batch([
        env.DB.prepare('INSERT INTO accounts (username, password, role, site, created) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(username, password, 'user', site, new Date().toISOString()),
        env.DB.prepare('INSERT INTO site_mappings (site, username) VALUES (?1, ?2)')
          .bind(site, username)
      ]);

      return new Response(JSON.stringify({ ok: true, username, site }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── DELETE — 删除子账户 ──
    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const username = url.searchParams.get('username');
      if (!username) {
        return new Response(JSON.stringify({ error: '缺少用户名参数' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      await env.DB.batch([
        env.DB.prepare('DELETE FROM accounts WHERE username = ?1').bind(username),
        env.DB.prepare('DELETE FROM site_mappings WHERE username = ?1').bind(username)
      ]);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
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

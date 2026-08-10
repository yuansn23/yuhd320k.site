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
      // 1. D1 账户列表 + 统计数据（尝试读新字段，列不存在则回退）
      var acctsResult = null;
      var useD1Columns = true;
      try {
        acctsResult = await env.DB.prepare('SELECT username, password, role, site, created, pixel_ids, apk_url, status FROM accounts WHERE role = ?1 ORDER BY created DESC').bind('user').all();
      } catch (e) {
        // 新列（pixel_ids, apk_url）还没建，回退
        useD1Columns = false;
        acctsResult = await env.DB.prepare('SELECT username, password, role, site, created, status FROM accounts WHERE role = ?1 ORDER BY created DESC').bind('user').all();
      }
      const statsResult = await env.DB.prepare('SELECT username, COALESCE(SUM(count), 0) AS total FROM download_counts GROUP BY username').all();

      // 构建下载量映射（D1 优先）
      var downloadMap = {};
      if (statsResult && statsResult.results) {
        for (var si = 0; si < statsResult.results.length; si++) {
          var row = statsResult.results[si];
          downloadMap[row.username] = row.total;
        }
      }

      // D1 中已有的用户名集合
      var d1Users = {};
      var accts = acctsResult && acctsResult.results ? acctsResult.results : [];
      for (var ai = 0; ai < accts.length; ai++) {
        d1Users[accts[ai].username] = true;
        // 下载量 KV 回退：D1 显示 0 但从 KV 可能有数据
        if (!downloadMap[accts[ai].username]) {
          try {
            var kvDl = parseInt((await env.kvadmin.get(accts[ai].username + ':download_count')) || '0');
            if (kvDl > 0) downloadMap[accts[ai].username] = kvDl;
          } catch (e) {}
        }
      }

      // 2. KV 回退：查找尚未迁移的旧账户
      var kvAccounts = [];
      try {
        const kvListRaw = await env.kvadmin.get('account_list');
        if (kvListRaw) {
          var kvList = JSON.parse(kvListRaw);
          for (var ki = 0; ki < kvList.length; ki++) {
            var uname = kvList[ki];
            if (!d1Users[uname]) {
              var kvRaw = await env.kvadmin.get('account:' + uname);
              if (kvRaw) {
                var ka = JSON.parse(kvRaw);
                if (ka.role === 'user') {
                  kvAccounts.push({
                    username: uname,
                    pw: ka.pw || '',
                    site: ka.site || '',
                    created: ka.created || '',
                    role: ka.role || 'user'
                  });
                  // 自动迁移到 D1
                  try {
                    await env.DB.prepare('INSERT OR IGNORE INTO accounts (username, password, role, site, created) VALUES (?1, ?2, ?3, ?4, ?5)')
                      .bind(uname, ka.pw || '', ka.role || 'user', ka.site || '', ka.created || new Date().toISOString()).run();
                    if (ka.site) {
                      await env.DB.prepare('INSERT OR IGNORE INTO site_mappings (site, username) VALUES (?1, ?2)')
                        .bind(ka.site, uname).run();
                    }
                  } catch (migErr) { /* 迁移失败不阻塞列表 */ }
                }
              }
            }
          }
        }
      } catch (kvErr) { /* KV 不可用时跳过 */ }

      // 合并 D1 + KV 账户
      var allAccts = accts.concat(kvAccounts);

      // 3. 并行读取每个账户的配置（D1 优先，KV 回退）
      var accounts = [];
      var kvTasks = [];
      for (var q = 0; q < allAccts.length; q++) {
        (function(a){
          kvTasks.push((async function(){
            var apkUrl = '';
            var pixels = [];
            // D1 新列可用则直接用
            if (useD1Columns) {
              apkUrl = a.apk_url || '';
              try { pixels = JSON.parse(a.pixel_ids || '[]'); } catch (e) {}
            }
            // KV 回退
            if (!apkUrl && !pixels.length) {
              try {
                var kvUrl = await env.kvadmin.get(a.username + ':apk_url');
                var kvPixels = await env.kvadmin.get(a.username + ':pixel_ids');
                if (kvUrl) apkUrl = kvUrl;
                if (kvPixels) pixels = JSON.parse(kvPixels);
                // 自动迁移到 D1
                if ((kvUrl || kvPixels) && useD1Columns) {
                  try {
                    await env.DB.prepare('UPDATE accounts SET apk_url = ?1, pixel_ids = ?2 WHERE username = ?3')
                      .bind(kvUrl || '', kvPixels || '[]', a.username).run();
                  } catch (e) {}
                }
              } catch (e) {}
            }
            accounts.push({
              username: a.username,
              pw: a.password || a.pw || '',
              site: a.site || '',
              created: a.created || '',
              status: a.status || 'active',
              stats: {
                downloads: downloadMap[a.username] || 0,
                apkUrl: apkUrl,
                pixels: pixels,
                sites: []
              }
            });
          })());
        })(allAccts[q]);
      }
      await Promise.all(kvTasks);

      // 4. 查询所有站点的 account_sites 数据
      try {
        var allSites = await env.DB.prepare('SELECT site, username, pixel_ids, apk_url FROM account_sites').all();
        if (allSites && allSites.results) {
          for (var si2 = 0; si2 < accounts.length; si2++) {
            var un = accounts[si2].username;
            accounts[si2].stats.sites = allSites.results
              .filter(function(s){ return s.username === un; })
              .map(function(s){ return { site: s.site, pixelCount: JSON.parse(s.pixel_ids||'[]').length, apkUrl: s.apk_url || '' }; });
            // 兜底：account_sites 为空时用主站点
            if (!accounts[si2].stats.sites.length && accounts[si2].site) {
              accounts[si2].stats.sites = [{ site: accounts[si2].site, pixelCount: accounts[si2].stats.pixels.length, apkUrl: accounts[si2].stats.apkUrl }];
            }
          }
        }
      } catch (e) {}

      return new Response(JSON.stringify(accounts), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST — 创建/修改子账户 ──
    if (request.method === 'POST') {
      const body = await request.json();
      const { username, newUsername, password, site, action } = body;

      // -- 启用/禁用 --
      if (action === 'toggle-status') {
        const acc = await env.DB.prepare('SELECT status FROM accounts WHERE username = ?1').bind(username).first();
        if (!acc) {
          return new Response(JSON.stringify({ error: '账户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        }
        var newStatus = (acc.status === 'disabled') ? 'active' : 'disabled';
        await env.DB.prepare('UPDATE accounts SET status = ?1 WHERE username = ?2').bind(newStatus, username).run();
        return new Response(JSON.stringify({ ok: true, status: newStatus, msg: newStatus === 'disabled' ? '已禁用' : '已启用' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
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

        var finalUsername = username;
        var newPass = password || existing.password;
        var newSite = site || existing.site;

        // 修改用户名：D1 不支持直接 UPDATE 主键，需删旧插新 + 更新关联表
        if (newUsername && newUsername !== username) {
          if (newUsername === 'admin') {
            return new Response(JSON.stringify({ error: '不能使用admin作为子账户名' }), {
              status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }
          const dup = await env.DB.prepare('SELECT username FROM accounts WHERE username = ?1').bind(newUsername).first();
          if (dup) {
            return new Response(JSON.stringify({ error: '用户名 ' + newUsername + ' 已存在' }), {
              status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }
          // 插入新行
          await env.DB.prepare('INSERT INTO accounts (username, password, role, site, created, pixel_ids, apk_url, apk_history, config_version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
            .bind(newUsername, existing.password, existing.role, existing.site, existing.created, existing.pixel_ids || '[]', existing.apk_url || '', existing.apk_history || '[]', existing.config_version || 0).run();
          // 更新关联表
          await env.DB.prepare('UPDATE site_mappings SET username = ?1 WHERE username = ?2').bind(newUsername, username).run();
          await env.DB.prepare('UPDATE download_counts SET username = ?1 WHERE username = ?2').bind(newUsername, username).run();
          await env.DB.prepare('UPDATE account_sites SET username = ?1 WHERE username = ?2').bind(newUsername, username).run();
          await env.DB.prepare('UPDATE login_logs SET username = ?1 WHERE username = ?2').bind(newUsername, username).run();
          // 删除旧行
          await env.DB.prepare('DELETE FROM accounts WHERE username = ?1').bind(username).run();
          finalUsername = newUsername;
        }

        // 检查站点冲突
        if (site && site !== existing.site) {
          const conflict = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1 AND username != ?2').bind(site, finalUsername).first();
          if (conflict) {
            return new Response(JSON.stringify({ error: '站点域名 ' + site + ' 已被账户 ' + conflict.username + ' 绑定' }), {
              status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }
          await env.DB.prepare('DELETE FROM site_mappings WHERE username = ?1').bind(finalUsername).run();
          await env.DB.prepare('INSERT INTO site_mappings (site, username) VALUES (?1, ?2)').bind(site, finalUsername).run();
        }

        await env.DB.prepare('UPDATE accounts SET password = ?1, site = ?2 WHERE username = ?3').bind(newPass, newSite, finalUsername).run();

        // 同步多站点（sites 数组）— 只增删，不动已有数据
        if (body.sites && Array.isArray(body.sites)) {
          var newSites = body.sites.filter(function(s){ return s && s.trim(); }).map(function(s){ return s.trim(); });
          // 保护：sites 为空则不操作，防止误清空
          if (!newSites.length) { /* skip */ } else {
          // 获取现有站点
          var oldSites = [];
          try {
            var osr = await env.DB.prepare('SELECT site FROM account_sites WHERE username = ?1').bind(finalUsername).all();
            if (osr && osr.results) oldSites = osr.results.map(function(r){ return r.site; });
          } catch (e) {}
          // 删除不在新列表中的站点
          for (var di = 0; di < oldSites.length; di++) {
            if (newSites.indexOf(oldSites[di]) === -1) {
              await env.DB.prepare('DELETE FROM account_sites WHERE site = ?1 AND username = ?2').bind(oldSites[di], finalUsername).run();
              await env.DB.prepare('DELETE FROM site_mappings WHERE site = ?1').bind(oldSites[di]).run();
            }
          }
          // 添加新站点（已有站点不动，保留已配置的数据）
          for (var ai = 0; ai < newSites.length; ai++) {
            var ns = newSites[ai];
            if (oldSites.indexOf(ns) === -1) {
              try {
                await env.DB.prepare('INSERT OR IGNORE INTO account_sites (site, username, pixel_ids, apk_url, apk_history) VALUES (?1, ?2, ?3, ?4, ?5)').bind(ns, finalUsername, '[]', '', '[]').run();
                await env.DB.prepare('INSERT OR IGNORE INTO site_mappings (site, username) VALUES (?1, ?2)').bind(ns, finalUsername).run();
              } catch (e) {}
            }
          }
          } // end if newSites.length
        }

        // 统计实际站点数
        var finalCount = 0;
        try { var fc = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM account_sites WHERE username = ?1').bind(finalUsername).first(); finalCount = fc ? fc.cnt : 0; } catch(e) {}
        return new Response(JSON.stringify({ ok: true, username: finalUsername, site: newSite, msg: '已修改，共'+finalCount+'个站点' }), {
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

      // 多站点
      if (body.sites && Array.isArray(body.sites)) {
        var cSites = body.sites.filter(function(s){ return s && s.trim(); }).map(function(s){ return s.trim(); });
        for (var ci = 0; ci < cSites.length; ci++) {
          try {
            if (cSites[ci] !== site) {
              await env.DB.prepare('INSERT OR IGNORE INTO site_mappings (site, username) VALUES (?1, ?2)').bind(cSites[ci], username).run();
            }
            await env.DB.prepare('INSERT OR IGNORE INTO account_sites (site, username, pixel_ids, apk_url, apk_history) VALUES (?1, ?2, ?3, ?4, ?5)').bind(cSites[ci], username, '[]', '', '[]').run();
          } catch (e) {}
        }
      }

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
        env.DB.prepare('DELETE FROM site_mappings WHERE username = ?1').bind(username),
        env.DB.prepare('DELETE FROM account_sites WHERE username = ?1').bind(username),
        env.DB.prepare('DELETE FROM login_logs WHERE username = ?1').bind(username)
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

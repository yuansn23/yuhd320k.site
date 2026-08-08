// GET /api/admin/migrate-accounts — 一键将 KV 中的账户+站点映射迁移到 D1
// 部署后访问一次即可，幂等操作（重复执行不重复插入）
export async function onRequest(context) {
  const { request, env } = context;
  try {
    // 管理员验证
    const auth = request.headers.get('Authorization') || '';
    const user = env.ADMIN_USER || 'htes';
    const pass = env.ADMIN_PASS || 'D2378ac';
    if (auth !== 'Basic ' + btoa(user + ':' + pass)) {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), {
        status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    var result = { accounts: [], sites: [], errors: [] };

    // 1. 读取 KV 中的账户列表
    const listRaw = (await env.kvadmin.get('account_list')) || '[]';
    const list = JSON.parse(listRaw);

    // 2. 逐个迁移
    for (var i = 0; i < list.length; i++) {
      var username = list[i];
      try {
        var raw = await env.kvadmin.get('account:' + username);
        if (!raw) continue;
        var a = JSON.parse(raw);

        // 写入 D1（INSERT OR IGNORE 防止重复）
        await env.DB.prepare(
          'INSERT OR IGNORE INTO accounts (username, password, role, site, created) VALUES (?1, ?2, ?3, ?4, ?5)'
        ).bind(username, a.pw || '', a.role || 'user', a.site || '', a.created || new Date().toISOString()).run();

        // 迁移站点映射
        if (a.site) {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO site_mappings (site, username) VALUES (?1, ?2)'
          ).bind(a.site, username).run();
        }

        result.accounts.push({ username: username, role: a.role, site: a.site, migrated: true });
      } catch (e) {
        result.errors.push({ username: username, error: e.message });
      }
    }

    // 3. 也迁移管理员账户（如果 KV 中有的话）
    try {
      var adminRaw = await env.kvadmin.get('account:' + user);
      if (adminRaw) {
        var adminAccount = JSON.parse(adminRaw);
        await env.DB.prepare(
          'INSERT OR IGNORE INTO accounts (username, password, role, site, created) VALUES (?1, ?2, ?3, ?4, ?5)'
        ).bind(user, adminAccount.pw || pass, 'admin', '', adminAccount.created || new Date().toISOString()).run();
        result.accounts.push({ username: user, role: 'admin', migrated: true });
      }
    } catch (e) {
      result.errors.push({ username: user, error: e.message });
    }

    // 4. 汇总
    result.total = result.accounts.length;
    result.done = result.errors.length === 0;

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

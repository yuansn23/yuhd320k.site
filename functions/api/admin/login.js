// POST /api/admin/login — 管理员+子账户统一登录
// v3: 账户数据从 D1 读取，env 变量作为管理员回退
export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }});
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const { user, pass } = await request.json();
    if (!user || !pass) {
      return new Response(JSON.stringify({ error: '请输入账号密码' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 1. 从 D1 查找账户
    var account = await env.DB.prepare('SELECT * FROM accounts WHERE username = ?1').bind(user).first();

    // 2. D1 中没有 → 如果是管理员，用环境变量验证并自动写入 D1
    if (!account) {
      const adminUser = env.ADMIN_USER || 'htes';
      const adminPass = env.ADMIN_PASS || 'D2378ac';
      if (user === adminUser && pass === adminPass) {
        // 管理员首次登录，写入 D1
        await env.DB.prepare('INSERT OR IGNORE INTO accounts (username, password, role, site, created) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(user, pass, 'admin', '', new Date().toISOString()).run();
        const token = btoa(user + ':admin:' + pass);
        return new Response(JSON.stringify({ ok: true, token, role: 'admin', user, site: '' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 3. D1 中找到 → 验证密码
    if (pass !== account.password) {
      return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const token = btoa(user + ':' + account.role + ':' + account.password);
    return new Response(JSON.stringify({ ok: true, token, role: account.role, user, site: account.site || '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// POST /api/admin/login — 管理员+子账户统一登录
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

    // 1. 先从 KV 查找已创建的账户
    const raw = (await env.kvadmin.get('account:' + user)) || '';
    if (raw) {
      const account = JSON.parse(raw);
      if (pass === account.pw) {
        const token = btoa(user + ':' + account.role + ':' + account.pw);
        return new Response(JSON.stringify({ ok: true, token, role: account.role, user, site: account.site || '' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 2. 检查是否是初始管理员（环境变量）
    const adminUser = env.ADMIN_USER || 'htes';
    const adminPass = env.ADMIN_PASS || 'D2378ac';
    if (user === adminUser && pass === adminPass) {
      const account = { role: 'admin', pw: adminPass, created: new Date().toISOString() };
      await env.kvadmin.put('account:' + user, JSON.stringify(account));
      const token = btoa(user + ':admin:' + adminPass);
      return new Response(JSON.stringify({ ok: true, token, role: 'admin', user, site: '' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
      status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

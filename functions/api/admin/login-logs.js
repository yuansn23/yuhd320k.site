// GET /api/admin/login-logs — 管理员查看子账户登录日志
export async function onRequest(context) {
  const { request, env } = context;
  try {
    // 管理员验证（与 accounts.js 一致）
    var auth = request.headers.get('Authorization') || '';
    var isAdmin = false;
    try {
      var decoded = atob(auth.replace('Basic ', ''));
      var parts = decoded.split(':');
      var authUser = parts[0], authRole = parts[1];
      if (authRole === 'admin') {
        var adminAccount = await env.DB.prepare('SELECT password FROM accounts WHERE username = ?1 AND role = ?2').bind(authUser, 'admin').first();
        if (adminAccount && auth === 'Basic ' + btoa(authUser + ':admin:' + adminAccount.password)) {
          isAdmin = true;
        }
      }
    } catch (e) {}
    if (!isAdmin) {
      var adminUser = env.ADMIN_USER || 'htes';
      var adminPass = env.ADMIN_PASS || 'D2378ac';
      if (auth === 'Basic ' + btoa(adminUser + ':' + adminPass)) isAdmin = true;
    }
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), {
        status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const url = new URL(request.url);
    const filterUser = url.searchParams.get('user') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

    var result;
    if (filterUser) {
      result = await env.DB.prepare('SELECT username, login_time, ip, device FROM login_logs WHERE username = ?1 ORDER BY login_time DESC LIMIT ?2').bind(filterUser, limit).all();
    } else {
      result = await env.DB.prepare('SELECT username, login_time, ip, device FROM login_logs ORDER BY login_time DESC LIMIT ?1').bind(limit).all();
    }

    var logs = result && result.results ? result.results : [];

    return new Response(JSON.stringify({ logs: logs, total: logs.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

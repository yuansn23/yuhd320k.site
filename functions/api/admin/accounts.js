// GET/POST/DELETE /api/admin/accounts — 管理员管理子账户
function getAuthUser(request) {
  const auth = request.headers.get('Authorization') || '';
  try {
    const decoded = atob(auth.replace('Basic ', ''));
    const parts = decoded.split(':');
    return { user: parts[0], role: parts[1] };
  } catch (e) { return null; }
}

async function checkAdmin(request, env) {
  const u = getAuthUser(request);
  if (!u || u.role !== 'admin') return false;
  const raw = await env.kvadmin.get('account:' + u.user);
  if (!raw) return false;
  const account = JSON.parse(raw);
  const auth = request.headers.get('Authorization') || '';
  return auth === 'Basic ' + btoa(u.user + ':admin:' + account.pw);
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

    // GET — 列出所有子账户
    if (request.method === 'GET') {
      const listRaw = (await env.kvadmin.get('account_list')) || '[]';
      const list = JSON.parse(listRaw);
      const accounts = [];
      for (const username of list) {
        const raw = await env.kvadmin.get('account:' + username);
        if (raw) {
          const a = JSON.parse(raw);
          if (a.role === 'user') {
            const stats = {
              downloads: parseInt((await env.kvadmin.get(username + ':download_count')) || '0'),
              apkUrl: (await env.kvadmin.get(username + ':apk_url')) || '',
              pixels: JSON.parse((await env.kvadmin.get(username + ':pixel_ids')) || '[]')
            };
            accounts.push({ username, site: a.site || '', created: a.created, stats });
          }
        }
      }
      return new Response(JSON.stringify(accounts), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // POST — 创建/修改子账户
    if (request.method === 'POST') {
      const body = await request.json();
      const { username, password, site } = body;
      if (!username || !password || !site) {
        return new Response(JSON.stringify({ error: '账号、密码、站点域名不能为空' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      if (username === 'admin') {
        return new Response(JSON.stringify({ error: '不能使用admin作为子账户名' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // 检查站点域名是否已被其他账户绑定
      const listRaw = (await env.kvadmin.get('account_list')) || '[]';
      const list = JSON.parse(listRaw);
      for (const u of list) {
        if (u !== username) {
          const raw = await env.kvadmin.get('account:' + u);
          if (raw) {
            const a = JSON.parse(raw);
            if (a.site === site) {
              return new Response(JSON.stringify({ error: '站点域名 ' + site + ' 已被账户 ' + u + ' 绑定' }), {
                status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
              });
            }
          }
        }
      }

      const account = { role: 'user', pw: password, site, created: new Date().toISOString() };
      await env.kvadmin.put('account:' + username, JSON.stringify(account));

      // 维护站点→账户映射
      await env.kvadmin.put('site:' + site, username);

      if (list.indexOf(username) === -1) {
        list.push(username);
        await env.kvadmin.put('account_list', JSON.stringify(list));
      }

      return new Response(JSON.stringify({ ok: true, username, site }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // DELETE — 删除子账户
    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const username = url.searchParams.get('username');
      if (!username) {
        return new Response(JSON.stringify({ error: '缺少用户名参数' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const raw = await env.kvadmin.get('account:' + username);
      if (raw) {
        const a = JSON.parse(raw);
        await env.kvadmin.delete('site:' + a.site);
      }
      await env.kvadmin.delete('account:' + username);
      const listRaw = (await env.kvadmin.get('account_list')) || '[]';
      const list = JSON.parse(listRaw).filter(function(u) { return u !== username; });
      await env.kvadmin.put('account_list', JSON.stringify(list));
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

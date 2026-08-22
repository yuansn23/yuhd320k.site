// GET/POST/DELETE /api/admin/my-sites — 子账户管理自己的落地页（新增/删除站点）
// 子账户可自行新增一个全新的落地页（写入 account_sites + site_mappings），
// 并保证一个站点只能归属一个账户（site_mappings.site 主键冲突校验）。
// 与既有业务完全独立，不改动 accounts.js / my-stats.js 等其它接口。

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

function normalizeSite(s) { return (s || '').trim(); }

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      }});
    }

    const me = await getMyUser(request, env);
    if (!me) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── GET — 列出自己名下的落地页 ──
    if (request.method === 'GET') {
      var sites = [];
      try {
        var sr = await env.DB.prepare('SELECT site, pixel_ids, apk_url FROM account_sites WHERE username = ?1').bind(me.user).all();
        if (sr && sr.results) {
          sites = sr.results.map(function(r){ return { site: r.site, pixelCount: JSON.parse(r.pixel_ids || '[]').length, apkUrl: r.apk_url || '' }; });
        }
      } catch (e) {}
      if (!sites.length && me.site) sites = [{ site: me.site, pixelCount: 0, apkUrl: '' }];
      // 备注说明：读 site_remarks 合并到站点列表
      try {
        var rmRes = await env.DB.prepare('SELECT site, remark FROM site_remarks WHERE username = ?1').bind(me.user).all();
        var rmMap = {};
        if (rmRes && rmRes.results) { rmRes.results.forEach(function(x){ rmMap[x.site] = x.remark || ''; }); }
        sites.forEach(function(s){ s.remark = rmMap[s.site] || ''; });
      } catch (e) {}
      return new Response(JSON.stringify({ sites: sites }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST — 新增落地页 ──
    if (request.method === 'POST') {
      const body = await request.json();
      const site = normalizeSite(body.site);
      if (!site) {
        return new Response(JSON.stringify({ error: '请输入落地页域名' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      if (site.indexOf('.') === -1) {
        return new Response(JSON.stringify({ error: '落地页域名格式不正确，需包含 "."' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      // 冲突校验：一个站点只能归属一个账户
      try {
        var conflict = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
        if (conflict) {
          if (conflict.username === me.user) {
            return new Response(JSON.stringify({ error: '该落地页已在你名下' }), {
              status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }
          return new Response(JSON.stringify({ error: '该落地页已被其他账户绑定' }), {
            status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      } catch (e) {}
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO account_sites (site, username, pixel_ids, apk_url, apk_history) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(site, me.user, '[]', '', '[]').run();
        await env.DB.prepare('INSERT OR IGNORE INTO site_mappings (site, username) VALUES (?1, ?2)')
          .bind(site, me.user).run();
      } catch (e) {
        return new Response(JSON.stringify({ error: '新增失败: ' + (e && e.message ? e.message : String(e)) }), {
          status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response(JSON.stringify({ ok: true, site: site }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── DELETE — 删除自己名下的落地页 ──
    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const site = normalizeSite(url.searchParams.get('site'));
      if (!site) {
        return new Response(JSON.stringify({ error: '缺少站点参数' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      var owns = false;
      try {
        var om = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
        if (om && om.username === me.user) owns = true;
      } catch (e) {}
      if (!owns) {
        return new Response(JSON.stringify({ error: '无权删除该落地页' }), {
          status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      try {
        await env.DB.prepare('DELETE FROM account_sites WHERE site = ?1 AND username = ?2').bind(site, me.user).run();
        await env.DB.prepare('DELETE FROM site_mappings WHERE site = ?1 AND username = ?2').bind(site, me.user).run();
      } catch (e) {}
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUT — 保存落地页备注 ──
    if (request.method === 'PUT') {
      const body = await request.json();
      const site = normalizeSite(body.site);
      const remark = (body.remark == null ? '' : String(body.remark));
      if (!site) {
        return new Response(JSON.stringify({ error: '缺少站点参数' }), {
          status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      var owns = false;
      try {
        var om = await env.DB.prepare('SELECT username FROM site_mappings WHERE site = ?1').bind(site).first();
        if (om && om.username === me.user) owns = true;
      } catch (e) {}
      if (!owns) {
        return new Response(JSON.stringify({ error: '无权修改该落地页' }), {
          status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      try {
        await env.DB.prepare('INSERT INTO site_remarks (site, username, remark, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(site, username) DO UPDATE SET remark = excluded.remark, updated_at = excluded.updated_at')
          .bind(site, me.user, remark, new Date().toISOString()).run();
      } catch (e) {
        return new Response(JSON.stringify({ error: '保存失败: ' + (e && e.message ? e.message : String(e)) }), {
          status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
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

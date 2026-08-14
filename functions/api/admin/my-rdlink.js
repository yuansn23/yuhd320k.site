// 超强分流链接 — 子账户/管理员管理自己的短链（跳转域名 / 短链 / 目标链接 / 跳转统计）
// 与既有业务（斗篷/像素/跳转/下载）完全独立，全新表 rd_*、全新接口。
// GET  ?action=domains|links|logs
// POST body.action = link_add | link_edit | link_del | link_toggle

// ============ 全局跳转域名配置（管理员维护）============
// 在此添加/修改跳转域名前缀，保存后重新部署即可生效，对所有子账户生效（下拉选择）。
// 格式：完整跳转前缀（含协议与路径，不含末尾 8 位短链ID）。
//   例如 https://km37acd.top/t  →  短链地址为 https://km37acd.top/t/{短链ID}
const RD_DOMAINS = [
  'https://km37acd.top/t',
  // 在此追加更多域名，例如：
  // 'https://your-second-domain.com/x',
];

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

// 跳转前缀归一化：补齐协议、去掉末尾斜杠，保留完整路径（如 https://km37acd.top/t/index.html）
function normalizeDomain(d) {
  var s = String(d || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/\/+$/, '');
  return s;
}

function cleanNumber(n) { return String(n || '').replace(/\D/g, ''); }

function genId() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var out = '';
  var arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (var i = 0; i < 8; i++) out += chars[arr[i] % chars.length];
  return out;
}

async function uniqueId(env) {
  for (var i = 0; i < 10; i++) {
    var id = genId();
    try {
      var exist = await env.DB.prepare('SELECT id FROM rd_links WHERE id = ?1').bind(id).first();
      if (!exist) return id;
    } catch (e) { return id; }
  }
  return genId();
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
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
    if (!me) return json({ error: '未授权' }, 401);

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    // ── GET 查询类 ──
    if (request.method === 'GET') {
      if (action === 'domains') {
        // 全局跳转域名（见文件顶部 RD_DOMAINS 配置，对所有子账户生效）
        var doms = (RD_DOMAINS || []).map(function(d){ return { domain: normalizeDomain(d), created_at: '' }; });
        return json({ domains: doms });
      }
      if (action === 'links') {
        var lr = await env.DB.prepare('SELECT id, domain, mode, enabled, created_at, updated_at FROM rd_links WHERE username = ?1 ORDER BY created_at DESC').bind(me.user).all();
        var links = (lr && lr.results) || [];
        for (var i = 0; i < links.length; i++) {
          try {
            var tr = await env.DB.prepare('SELECT type, url, weight, sort FROM rd_targets WHERE link_id = ?1 ORDER BY sort ASC, id ASC').bind(links[i].id).all();
            links[i].targets = (tr && tr.results) || [];
          } catch (e) { links[i].targets = []; }
        }
        return json({ links: links });
      }
      if (action === 'logs') {
        var linkId = (url.searchParams.get('link_id') || '').trim();
        var page = parseInt(url.searchParams.get('page') || '1', 10) || 1;
        var limit = parseInt(url.searchParams.get('limit') || '20', 10) || 20;
        if (page < 1) page = 1;
        if (limit < 1 || limit > 200) limit = 20;
        var offset = (page - 1) * limit;
        var where = 'username = ?1';
        var binds = [me.user];
        if (linkId) { where += ' AND link_id = ?2'; binds.push(linkId); }
        var countRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM rd_logs WHERE ' + where).bind(...binds).first();
        var lg = await env.DB.prepare('SELECT link_id, domain, from_url, to_url, ip, device, created_at FROM rd_logs WHERE ' + where + ' ORDER BY id DESC LIMIT ?' + (binds.length + 1) + ' OFFSET ?' + (binds.length + 2))
          .bind(...binds, limit, offset).all();
        return json({ logs: (lg && lg.results) || [], total: (countRow && countRow.c) ? countRow.c : 0 });
      }
      return json({ error: '未知 action' }, 400);
    }

    // ── POST 写操作 ──
    if (request.method === 'POST') {
      var body = {};
      try { body = await request.json(); } catch (e) { body = {}; }
      const act = body.action || '';

      if (act === 'link_add' || act === 'link_edit') {
        var isEdit = (act === 'link_edit');
        var linkId = isEdit ? String(body.id || '').toLowerCase().trim() : '';
        var d = normalizeDomain(body.domain);
        var mode = body.mode === 'weighted' ? 'weighted' : 'random';
        var rawTargets = Array.isArray(body.targets) ? body.targets : [];
        if (!d) return json({ error: '请选择跳转域名' }, 400);

        // 展开目标：whatsapp 多号码（一行一个）→ 每个号码一个 b链接
        var targets = [];
        for (var t = 0; t < rawTargets.length; t++) {
          var rt = rawTargets[t] || {};
          var type = rt.type === 'whatsapp' ? 'whatsapp' : 'url';
          var weight = Math.min(9, Math.max(1, parseInt(rt.weight, 10) || 1));
          if (type === 'whatsapp') {
            var numbers = String(rt.numbers || rt.url || '').split(/\r?\n/);
            var msg = String(rt.text || '').trim();
            for (var n = 0; n < numbers.length; n++) {
              var num = cleanNumber(numbers[n]);
              if (num) targets.push({ type: 'whatsapp', url: 'https://wa.me/' + num + (msg ? '?text=' + encodeURIComponent(msg) : ''), weight: weight });
            }
          } else {
            var u = String(rt.url || '').trim();
            if (u) targets.push({ type: 'url', url: u, weight: weight });
          }
        }
        if (!targets.length) return json({ error: '请至少添加一个有效的目标链接（B链接）' }, 400);

        if (isEdit) {
          if (!/^[a-z0-9]{8}$/.test(linkId)) return json({ error: '短链ID格式错误' }, 400);
          var own = await env.DB.prepare('SELECT id FROM rd_links WHERE id = ?1 AND username = ?2').bind(linkId, me.user).first();
          if (!own) return json({ error: '无权修改该短链' }, 403);
          await env.DB.prepare('UPDATE rd_links SET domain = ?1, mode = ?2, updated_at = ?3 WHERE id = ?4').bind(d, mode, new Date().toISOString(), linkId).run();
          await env.DB.prepare('DELETE FROM rd_targets WHERE link_id = ?1').bind(linkId).run();
        } else {
          linkId = await uniqueId(env);
          await env.DB.prepare('INSERT INTO rd_links (id, username, domain, mode, enabled, created_at, updated_at) VALUES (?1,?2,?3,?4,1,?5,?5)').bind(linkId, me.user, d, mode, new Date().toISOString()).run();
        }
        for (var k = 0; k < targets.length; k++) {
          await env.DB.prepare('INSERT INTO rd_targets (link_id, type, url, weight, sort, created_at) VALUES (?1,?2,?3,?4,?5,?6)').bind(linkId, targets[k].type, targets[k].url, targets[k].weight, k, new Date().toISOString()).run();
        }
        return json({ ok: true, id: linkId, url: d + '/' + linkId });
      }

      if (act === 'link_del') {
        var delId = String(body.id || '').toLowerCase().trim();
        await env.DB.prepare('DELETE FROM rd_links WHERE id = ?1 AND username = ?2').bind(delId, me.user).run();
        await env.DB.prepare('DELETE FROM rd_targets WHERE link_id = ?1').bind(delId).run();
        return json({ ok: true });
      }

      if (act === 'link_toggle') {
        var tgId = String(body.id || '').toLowerCase().trim();
        var en = body.enabled ? 1 : 0;
        await env.DB.prepare('UPDATE rd_links SET enabled = ?1, updated_at = ?2 WHERE id = ?3 AND username = ?4').bind(en, new Date().toISOString(), tgId, me.user).run();
        return json({ ok: true });
      }

      return json({ error: '未知 action' }, 400);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: (e && e.message) ? e.message : String(e) }, 500);
  }
}

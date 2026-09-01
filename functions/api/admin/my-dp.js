// GET/POST /api/admin/my-dp — 子账户 DP配置 读写（独立表 dp_configs）
// 子账户只能配置/读取自己名下的落地页。
// 无账号级权限开关（每个子账户都可用），与 AB页(my-ab.js)完全独立。

const DEFAULT_RULES = {
  crawler: { enabled: true, engines: ['google', 'facebook', 'tiktok'] },
  device: { enabled: false, mode: 'block', list: ['android', 'ios', 'pc', 'mac'] },
  language: { enabled: false, mode: 'block', list: [] },
  timezone: { enabled: false, mode: 'block', list: ['+8'] },
  block_ips: { enabled: false, list: [] },
  privacy: { enabled: false },
  extra: {}
};

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

function parseJson(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
// 补齐缺失的规则键（老数据 / 空 rules 时，保证 device 等各模块结构完整，避免前端勾选状态丢失）
function fillRuleDefaults(parsed) {
  var out = JSON.parse(JSON.stringify(DEFAULT_RULES));
  var p = (parsed && typeof parsed === 'object') ? parsed : {};
  Object.keys(out).forEach(function (k) {
    if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) {
      out[k] = Object.assign({}, out[k], p[k]);
    }
  });
  return out;
}

// ============ DP 落地页无限域名（短链式唯一地址生成） ============
// 生成 {域名前缀}/{8位随机码} 作为落地页地址；
// 随机码对 dp_configs 全表按落地页地址查重，保证不与任何已配置的落地页重复。
// 域名前缀由 wrangler.toml [vars] 的 DP_LANDING_PREFIX 配置（多个域名用英文逗号分隔，带默认值兜底）。

// 解析可用落地页域名前缀列表（逗号分隔、去空白；未配置则回退默认单域名）
function dpPrefixes(env) {
  var raw = env.DP_LANDING_PREFIX || 'https://snk622ma.site/abwx';
  var list = String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!list.length) list = ['https://snk622ma.site/abwx'];
  return list;
}

function genDpId() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var out = '';
  var arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (var i = 0; i < 8; i++) out += chars[arr[i] % chars.length];
  return out;
}

async function uniqueDpId(env, prefix) {
  var base = prefix || dpPrefixes(env)[0];
  for (var i = 0; i < 10; i++) {
    var id = genDpId();
    var full = base + '/' + id;
    try {
      var exist = await env.DB.prepare('SELECT site FROM dp_configs WHERE site = ?1').bind(full).first();
      if (!exist) return id;
    } catch (e) { return id; }
  }
  return genDpId();
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

    const me = await getMyUser(request, env);
    if (!me) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── GET — 返回名下所有 DP 配置 ──
    if (request.method === 'GET') {
      var list = [];
      try {
        var res = await env.DB.prepare('SELECT site, enabled, actual_url, fallback_url, whitelist_ips, rules, remark, seq, updated_at FROM dp_configs WHERE username = ?1 ORDER BY seq ASC, updated_at DESC').bind(me.user).all();
        if (res && res.results) {
          list = res.results.map(function (r) {
            return {
              site: r.site,
              enabled: r.enabled,
              actual_url: r.actual_url || '',
              fallback_url: r.fallback_url || '',
              whitelist_ips: parseJson(r.whitelist_ips, []),
              rules: fillRuleDefaults(parseJson(r.rules, null)),
              remark: r.remark || '',
              seq: (r.seq != null) ? r.seq : null,
              updated_at: r.updated_at || ''
            };
          });
        }
      } catch (e) {}
      return new Response(JSON.stringify({ prefixes: dpPrefixes(env), configs: list }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST — 保存 DP 配置 ──
    if (request.method === 'POST') {
      const body = await request.json();

      // 落地页无限域名：用指定域名前缀生成一个全局唯一的落地页地址并返回
      if (body.action === 'gen') {
        var prefixes = dpPrefixes(env);
        var pfx = String(body.prefix || '').trim();
        if (pfx && prefixes.indexOf(pfx) === -1) pfx = ''; // 非法/未选中前缀 → 用默认第一个
        var usePfx = pfx || prefixes[0];
        var gid = await uniqueDpId(env, usePfx);
        return new Response(JSON.stringify({ ok: true, id: gid, url: usePfx + '/' + gid, prefix: usePfx }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // 备注快捷修改：只更新 remark 一列（配置查询页内联编辑）
      if (body.action === 'remark') {
        var rSite = (body.site || '').trim();
        if (!rSite) {
          return new Response(JSON.stringify({ ok: false, error: '缺少站点参数' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        }
        var rRemark = (body.remark == null ? '' : String(body.remark)).trim();
        try {
          await env.DB.prepare('UPDATE dp_configs SET remark = ?1, updated_at = ?2 WHERE site = ?3 AND username = ?4').bind(rRemark, new Date().toISOString(), rSite, me.user).run();
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: '备注保存失败: ' + (e && e.message ? e.message : String(e)) }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        }
        return new Response(JSON.stringify({ ok: true, site: rSite, remark: rRemark }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }

      const site = (body.site || '').trim();
      if (!site) {
        return new Response(JSON.stringify({ ok: false, error: '请填写落地页地址' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }

      var enabled = (body.enabled === true || body.enabled === 1) ? 1 : 0;
      var actualUrl = (body.actual_url || '').trim();
      var fallbackUrl = (body.fallback_url || '').trim();
      var remark = (body.remark == null ? '' : String(body.remark)).trim();
      var whitelist = Array.isArray(body.whitelist_ips) ? body.whitelist_ips.map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
      var rules = (body.rules && typeof body.rules === 'object') ? body.rules : DEFAULT_RULES;
      var now = new Date().toISOString();

      try {
        // 序号：新落地页按该子账户内 max+1 自然增长；已存在则沿用原序号
        var seq = null;
        var ex = await env.DB.prepare('SELECT seq FROM dp_configs WHERE site = ?1').bind(site).first();
        if (ex && ex.seq != null) { seq = ex.seq; }
        else {
          var mx = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM dp_configs WHERE username = ?1').bind(me.user).first();
          seq = (mx ? (mx.m || 0) : 0) + 1;
        }
        await env.DB.prepare('INSERT INTO dp_configs (site, username, enabled, actual_url, fallback_url, whitelist_ips, rules, remark, seq, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT(site) DO UPDATE SET username = excluded.username, enabled = excluded.enabled, actual_url = excluded.actual_url, fallback_url = excluded.fallback_url, whitelist_ips = excluded.whitelist_ips, rules = excluded.rules, remark = excluded.remark, seq = excluded.seq, updated_at = excluded.updated_at')
          .bind(site, me.user, enabled, actualUrl, fallbackUrl, JSON.stringify(whitelist), JSON.stringify(rules), remark, seq, now).run();
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'DP 配置保存失败: ' + (e && e.message ? e.message : String(e)) }), {
          status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      return new Response(JSON.stringify({ ok: true, site: site }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── DELETE — 删除自己名下某个落地页的 DP 配置 ──
    if (request.method === 'DELETE') {
      const url = new URL(request.url);
      const site = (url.searchParams.get('site') || '').trim();
      if (!site) {
        return new Response(JSON.stringify({ ok: false, error: '缺少站点参数' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      try {
        await env.DB.prepare('DELETE FROM dp_configs WHERE site = ?1 AND username = ?2').bind(site, me.user).run();
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: '删除失败: ' + (e && e.message ? e.message : String(e)) }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      return new Response(JSON.stringify({ ok: true, site: site }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
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

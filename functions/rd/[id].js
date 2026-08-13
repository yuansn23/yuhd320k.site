// GET /rd/[id] — 超强分流链接（短链 302 跳转，公开无鉴权）
// 用户访问 https://{a域名}/rd/{8位id} 时，服务端按 随机/权重 选择一个目标 b链接，
// 记录 rd_logs（跳转时间/IP/跳转前a链接/跳转后b链接/设备），返回 302 Location。
// 与既有业务（斗篷/像素/跳转）完全独立，全新表 rd_*、全新路径 /rd/。

const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

function detectDevice(ua) {
  var u = ua || '';
  if (/Android/i.test(u)) return 'android';
  if (/iPhone|iPod|iPad/i.test(u)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(u)) return 'mac';
  if (/Windows|Linux|CrOS/i.test(u)) return 'pc';
  return 'other';
}

// 按模式挑选目标：weighted 按权重比例，random 均匀随机；权重全 0 时兜底均匀随机
function pickTarget(targets, mode) {
  if (!targets || !targets.length) return null;
  if (targets.length === 1) return targets[0];
  if (mode === 'weighted') {
    var weights = targets.map(function (t) { return Math.max(0, parseInt(t.weight, 10) || 0); });
    var total = 0;
    for (var i = 0; i < weights.length; i++) total += weights[i];
    if (total > 0) {
      var r = Math.random() * total;
      var acc = 0;
      for (var j = 0; j < targets.length; j++) {
        acc += weights[j];
        if (r < acc) return targets[j];
      }
      return targets[targets.length - 1];
    }
  }
  return targets[Math.floor(Math.random() * targets.length)];
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = String((params && params.id) || '').toLowerCase();
  try {
    if (!/^[a-z0-9]{8}$/.test(id)) {
      return new Response(JSON.stringify({ error: '短链不存在' }), { status: 404, headers: jsonHeaders });
    }

    var link;
    try {
      link = await env.DB.prepare('SELECT id, username, domain, mode, enabled FROM rd_links WHERE id = ?1').bind(id).first();
    } catch (e) { link = null; }
    if (!link || link.enabled !== 1) {
      return new Response(JSON.stringify({ error: '短链不存在或已禁用' }), { status: 404, headers: jsonHeaders });
    }

    var tr;
    try {
      tr = await env.DB.prepare('SELECT type, url, weight FROM rd_targets WHERE link_id = ?1 ORDER BY sort ASC, id ASC').bind(id).all();
    } catch (e) { tr = null; }
    var targets = (tr && tr.results) ? tr.results : [];
    if (!targets.length) {
      return new Response(JSON.stringify({ error: '短链未配置目标链接' }), { status: 404, headers: jsonHeaders });
    }

    var chosen = pickTarget(targets, link.mode);
    if (!chosen || !chosen.url) {
      return new Response(JSON.stringify({ error: '短链目标链接无效' }), { status: 404, headers: jsonHeaders });
    }

    var ip = request.headers.get('CF-Connecting-IP') || '';
    var ua = request.headers.get('User-Agent') || '';
    var device = detectDevice(ua);
    var fromUrl = (link.domain || '') + '/' + id;

    // 记录跳转统计（不阻塞 302，失败静默）
    try {
      await env.DB.prepare('INSERT INTO rd_logs (link_id, username, domain, from_url, to_url, ip, device, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
        .bind(id, link.username || '', link.domain || '', fromUrl, chosen.url, ip, device, new Date().toISOString()).run();
    } catch (e) {}

    return new Response(null, {
      status: 302,
      headers: { 'Location': chosen.url, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '服务异常' }), { status: 500, headers: jsonHeaders });
  }
}

// GET/POST /api/admin/my-pixels?site=xxx — 子账户像素管理（支持多落地页）
// v6: 按站点读写 account_sites 表
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
    if (!me) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── GET ──
    if (request.method === 'GET') {
      var qSite = (new URL(request.url)).searchParams.get('site') || me.site || '';
      var ids = [];
      var events = null;
      var ttIds = [];
      var ttEvents = null;
      // 只从 account_sites 读（按站点隔离：站点存在就用它的，空就是空，绝不回退到 accounts/KV 共享数据）
      if (qSite) {
        try {
          var row = await env.DB.prepare('SELECT pixel_ids, fb_events, tt_pixel_ids, tt_events FROM account_sites WHERE site = ?1 AND username = ?2').bind(qSite, me.user).first();
          if (row) {
            ids = JSON.parse(row.pixel_ids || '[]');
            try { events = JSON.parse(row.fb_events || '[]'); } catch (e) {}
            try { ttIds = JSON.parse(row.tt_pixel_ids || '[]'); } catch (e) {}
            try { ttEvents = JSON.parse(row.tt_events || '[]'); } catch (e) {}
          }
        } catch (e) {
          // fb_events / tt_* 列还没迁移：逐级退化，只读已有列
          try {
            var row2 = await env.DB.prepare('SELECT pixel_ids, fb_events FROM account_sites WHERE site = ?1 AND username = ?2').bind(qSite, me.user).first();
            if (row2) {
              ids = JSON.parse(row2.pixel_ids || '[]');
              try { events = JSON.parse(row2.fb_events || '[]'); } catch (e) {}
            }
          } catch (e2) {
            try {
              var row3 = await env.DB.prepare('SELECT pixel_ids FROM account_sites WHERE site = ?1 AND username = ?2').bind(qSite, me.user).first();
              if (row3) { ids = JSON.parse(row3.pixel_ids || '[]'); }
            } catch (e3) {}
          }
        }
      }
      if (!Array.isArray(events)) events = ['AddToCart','Contact','Lead','CompleteRegistration','Purchase','Download'];
      if (!Array.isArray(ttIds)) ttIds = [];
      if (!Array.isArray(ttEvents)) ttEvents = ['ClickButton','Contact','AddToCart','CompleteRegistration'];
      return new Response(JSON.stringify({ ids: ids, events: events, tt_ids: ttIds, tt_events: ttEvents }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── POST ──
    if (request.method === 'POST') {
      const body = await request.json();
      const site = body.site || me.site || '';
      const ids = Array.isArray(body.ids) ? body.ids.filter(function(id){ return /^\d{10,20}$/.test(id); }) : [];
      var idsJson = JSON.stringify(ids);

      // FB 事件：可选字段。传了 events 就覆盖保存；没传则不动现有 fb_events（像素编辑不会误改事件）
      var FB_EVENTS = ['AddToCart','Contact','Lead','CompleteRegistration','Purchase','Download'];
      var hasEvents = Array.isArray(body.events);
      var events = hasEvents ? body.events.filter(function(ev){ return FB_EVENTS.indexOf(ev) !== -1; }) : null;
      var eventsJson = hasEvents ? JSON.stringify(events) : null;

      // TikTok 像素/事件：可选字段。传了 tt_ids / tt_events 才覆盖保存；没传则不动现有值
      var TT_EVENTS = ['ClickButton','Contact','AddToCart','CompleteRegistration'];
      var hasTtIds = Array.isArray(body.tt_ids);
      var ttIds = hasTtIds ? body.tt_ids.filter(function(id){ return /^[A-Za-z0-9]{15,30}$/.test(id); }) : null;
      var ttIdsJson = hasTtIds ? JSON.stringify(ttIds) : null;
      var hasTtEvents = Array.isArray(body.tt_events);
      var ttEvents = hasTtEvents ? body.tt_events.filter(function(ev){ return TT_EVENTS.indexOf(ev) !== -1; }) : null;
      var ttEventsJson = hasTtEvents ? JSON.stringify(ttEvents) : null;

      if (site) {
        // 写入 account_sites（按站点隔离，不污染 accounts 共享表）
        // 不用 ON CONFLICT 上插（表若无 (site,username) 唯一约束会报错被吞，导致新账户写不进去），改为显式「查→更/插」
        try {
          var existingRow = await env.DB.prepare('SELECT 1 AS found FROM account_sites WHERE site = ?1 AND username = ?2').bind(site, me.user).first();
          if (existingRow) {
            // 动态拼 SET：只更新调用方显式传入的字段（pixel_ids 恒更新），避免误清空未传字段
            var sets = ['pixel_ids = ?1'];
            var vals = [idsJson];
            var ni = 2;
            if (hasEvents) { sets.push('fb_events = ?' + ni); vals.push(eventsJson); ni++; }
            if (hasTtIds) { sets.push('tt_pixel_ids = ?' + ni); vals.push(ttIdsJson); ni++; }
            if (hasTtEvents) { sets.push('tt_events = ?' + ni); vals.push(ttEventsJson); ni++; }
            sets.push('config_version = config_version + 1');
            var updSql = 'UPDATE account_sites SET ' + sets.join(', ') + ' WHERE site = ?' + ni + ' AND username = ?' + (ni + 1);
            vals.push(site, me.user);
            var stmt = env.DB.prepare(updSql);
            await stmt.bind.apply(stmt, vals).run();
          } else {
            var newEventsJson = hasEvents ? eventsJson : JSON.stringify(FB_EVENTS);
            var newTtIdsJson = hasTtIds ? ttIdsJson : '[]';
            var newTtEventsJson = hasTtEvents ? ttEventsJson : JSON.stringify(TT_EVENTS);
            await env.DB.prepare('INSERT INTO account_sites (site, username, pixel_ids, fb_events, tt_pixel_ids, tt_events, apk_url, apk_history, config_version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)').bind(site, me.user, idsJson, newEventsJson, newTtIdsJson, newTtEventsJson, '', '[]').run();
          }
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: '像素保存失败: ' + (e && e.message ? e.message : String(e)) }), {
            status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }

      return new Response(JSON.stringify({ ok: true, ids: ids, tt_ids: hasTtIds ? ttIds : null, count: ids.length }), {
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

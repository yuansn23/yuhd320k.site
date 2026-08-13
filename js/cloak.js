/* 斗篷防护守卫脚本（静态，接入落地页 <head>）
 * 接入：<script src="https://url.yuhd320k.site/cloak.js"></script>
 * 站点自动识别（location.origin + pathname），无需传参。
 * 采集行为信号，拦截交互元素点击，未通过则跳转兜底地址。 */
(function () {
  try {
    var cs = document.currentScript;
    var API_BASE = 'https://url.yuhd320k.site';
    if (cs && cs.src) { var k = cs.src.indexOf('/', 8); if (k > 0) API_BASE = cs.src.slice(0, k); }
    var SITE = location.origin + location.pathname;

    var PASS_KEY = 'cloak_pass', PASS_TTL = 30 * 60 * 1000; // 会话级放行缓存 30 分钟

    // ---- 调试模式：脚本 URL 加 ?debug=1，或落地页 URL 加 ?cloak_debug=1 ----
    var DEBUG = false;
    try {
      if (cs && cs.src && cs.src.indexOf('debug=1') !== -1) DEBUG = true;
      if (location.search.indexOf('cloak_debug=1') !== -1) DEBUG = true;
    } catch (e) {}
    var _dbgEl = null, _dbgLines = [];
    function dbg(msg) {
      try { console.log('[cloak]', msg); } catch (e) {}
      if (!DEBUG) return;
      _dbgLines.push(String(msg));
      if (_dbgLines.length > 22) _dbgLines.shift();
      if (!_dbgEl) {
        _dbgEl = document.createElement('div');
        _dbgEl.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;background:rgba(10,12,20,.93);color:#e8f0ff;font:12px/1.55 Menlo,Consolas,monospace;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);max-width:88vw;white-space:pre-wrap;word-break:break-all;box-shadow:0 6px 18px rgba(0,0,0,.45)';
        document.documentElement.appendChild(_dbgEl);
      }
      _dbgEl.innerHTML = '<b style="color:#f0883e">🕶️ 斗篷调试</b>\n' + _dbgLines.join('\n');
    }
    dbg('脚本已加载 ✓');
    dbg('站点: ' + SITE);
    dbg('接口: ' + API_BASE);

    // ---- 行为信号采集 ----
    var sig = {
      maxScroll: 0, mouseMoved: false, mouseCurved: false,
      touchContinuous: false, visibilityChanged: false, scrollRhythmIrregular: false
    };
    var pts = [], scrollSamples = [], touchMoveCount = 0;

    function scrollDepth() {
      var d = document.documentElement;
      var h = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0);
      var y = window.scrollY || d.scrollTop || 0;
      var vh = window.innerHeight || d.clientHeight || 0;
      if (h <= vh) return 100;
      var pct = (y + vh) / h * 100;
      return pct < 0 ? 0 : (pct > 100 ? 100 : pct);
    }

    window.addEventListener('scroll', function () {
      var p = scrollDepth(); if (p > sig.maxScroll) sig.maxScroll = p;
      scrollSamples.push({ y: window.scrollY || 0, t: Date.now() });
      if (scrollSamples.length > 60) scrollSamples.shift();
      if (scrollSamples.length >= 4 && !sig.scrollRhythmIrregular) {
        var diffs = [];
        for (var i = 1; i < scrollSamples.length; i++) diffs.push(Math.abs(scrollSamples[i].y - scrollSamples[i - 1].y) / Math.max(1, scrollSamples[i].t - scrollSamples[i - 1].t));
        var avg = 0; for (var a = 0; a < diffs.length; a++) avg += diffs[a]; avg /= diffs.length;
        var variance = 0; for (var b = 0; b < diffs.length; b++) variance += Math.pow(diffs[b] - avg, 2); variance /= diffs.length;
        if (variance > 1 && avg > 0.1) sig.scrollRhythmIrregular = true;
      }
    }, { passive: true });

    function recordPoint(x, y) {
      sig.mouseMoved = true;
      pts.push({ x: x, y: y, t: Date.now() });
      if (pts.length > 120) pts.shift();
      if (pts.length >= 4 && !sig.mouseCurved) {
        var p0 = pts[0], p1 = pts[pts.length - 1];
        var dx = p1.x - p0.x, dy = p1.y - p0.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > 30) {
          var maxDist = 0;
          for (var q = 0; q < pts.length; q++) {
            var dist = Math.abs(dy * pts[q].x - dx * pts[q].y + p1.x * p0.y - p1.y * p0.x) / len;
            if (dist > maxDist) maxDist = dist;
          }
          if (maxDist > 8) sig.mouseCurved = true; // 轨迹偏离直线 > 8px 视为曲线
        }
      }
    }

    document.addEventListener('mousemove', function (e) { recordPoint(e.clientX, e.clientY); }, { passive: true });
    document.addEventListener('touchstart', function (e) { var t = e.touches[0]; if (t) recordPoint(t.clientX, t.clientY); }, { passive: true });
    document.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) { recordPoint(t.clientX, t.clientY); touchMoveCount++; if (touchMoveCount >= 3) sig.touchContinuous = true; } }, { passive: true });
    document.addEventListener('visibilitychange', function () { sig.visibilityChanged = true; });

    var tzOffset = -new Date().getTimezoneOffset() / 60; // 东正，中国 = +8
    var tzIANA = '';
    try { tzIANA = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var lang = (navigator.language || navigator.userLanguage || '');

    // ---- 静默预热 ipinfo 缓存 ----
    try {
      fetch(API_BASE + '/api/cloak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site: SITE, preflight: true }) }).catch(function () {});
      dbg('预检已发送（打开页面，不记流量）');
    } catch (e) {}

    // ---- 点击拦截 ----
    function isPassed() { try { var v = sessionStorage.getItem(PASS_KEY); if (!v) return false; return (Date.now() - parseInt(v, 10)) < PASS_TTL; } catch (e) { return false; } }
    function markPassed() { try { sessionStorage.setItem(PASS_KEY, String(Date.now())); } catch (e) {} }

    function buildPayload() {
      return {
        site: SITE,
        behavior: {
          scrollDepth: Math.round(sig.maxScroll * 10) / 10,
          mouseMoved: sig.mouseMoved, mouseCurved: sig.mouseCurved,
          touchContinuous: sig.touchContinuous, visibilityChanged: sig.visibilityChanged,
          scrollRhythmIrregular: sig.scrollRhythmIrregular
        },
        client: { timezoneOffset: tzOffset, timezoneIANA: tzIANA, lang: lang }
      };
    }

    function verify(cb) {
      fetch(API_BASE + '/api/cloak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()) })
        .then(function (r) { return r.json(); })
        .then(function (d) { cb(d); })
        .catch(function (e) { dbg('⚠️ 网络异常，放行: ' + (e && e.message ? e.message : e)); cb({ passed: true }); }); // 网络异常放行，避免误伤
    }

    function isInteractive(el) {
      if (!el || !el.tagName) return false;
      var t = el.tagName;
      if (t === 'A' && el.getAttribute('href')) return true;
      if (t === 'BUTTON') return true;
      if (t === 'INPUT' && (el.type === 'submit' || el.type === 'button' || el.type === 'image')) return true;
      if (el.getAttribute && el.getAttribute('onclick')) return true;
      if (el.getAttribute && el.getAttribute('role') === 'button') return true;
      return false;
    }
    function findInteractive(node) {
      var n = node;
      while (n && n !== document.body) { if (isInteractive(n)) return n; n = n.parentElement; }
      return null;
    }

    function proceed(target) {
      var a = (target.closest) ? target.closest('a[href]') : null;
      var hasOnclick = !!(target.getAttribute && target.getAttribute('onclick'));
      // 重触发 click，让原 onclick（如 k2()）正常执行；markPassed 后不会再被拦截
      try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
      // 纯 <a href>（无 onclick）合成事件不会自动跟随，手动跳转
      if (a && !hasOnclick) {
        var href = a.getAttribute('href');
        if (href && href !== '#' && href.indexOf('javascript:') !== 0) {
          if (a.getAttribute('target') === '_blank') window.open(href, '_blank');
          else location.href = href;
        }
      }
    }

    document.addEventListener('click', function (e) {
      var el = findInteractive(e.target);
      if (!el) return;
      if (isPassed()) { dbg('点击（30 分钟放行缓存内，跳过验证）'); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      var target = el;
      dbg('检测到点击 → 验证中...');
      verify(function (d) {
        var db = (d && d._dbg) ? d._dbg : null;
        var logStr = '';
        if (db) logStr = '账号: ' + (db.username || '(空)') + ' 日志: ' + (db.log ? (db.log.ok ? '已写入' : '写入失败[' + db.log.error + ']') : '?');
        if (d && d.passed) {
          markPassed(); proceed(target);
          dbg('✅ 通过，放行点击');
          if (db) dbg(logStr); else dbg('后端未返回 _dbg（部署新版接口后可见账号/日志状态）');
        } else {
          var url = (d && d.redirect) ? d.redirect : 'https://www.google.com';
          dbg('🚫 拦截 → 跳转 ' + url);
          if (d && d.triggered && d.triggered.length) dbg('命中规则: ' + d.triggered.join(', '));
          if (db) dbg(logStr); else dbg('后端未返回 _dbg（部署新版接口后可见账号/日志状态）');
          try { location.replace(url); } catch (err) { location.href = url; }
        }
      });
    }, true);
  } catch (e) {}
})();

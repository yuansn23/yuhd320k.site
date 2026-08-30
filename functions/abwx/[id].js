// GET /abwx/[id] — DP 落地页无限域名（动态落地页模板）
// 任何 8 位 [a-z0-9] 码访问 /abwx/{id} 都返回一个内置 DP 守卫脚本的落地页 HTML，
// 脚本在客户端判定环境并自动跳转（真实用户→实际地址；命中规则→不符合规则地址）。
// 与「落地页无限域名」按钮配套：生成地址后无需手动上传 HTML 文件即可使用。
// 与其它业务完全独立，全新路径 /abwx/。

// DP 守卫脚本地址（与「DP如何部署」页保持一致，可在这一处统一修改）
const DP_SCRIPT_URL = 'https://api.km624da.site/js/dp-ck.js';

// 落地页模板：可随意修改 HTML 内容，但守卫脚本那行 <script> 不要删。
function landingHtml() {
  return '<!DOCTYPE html>\n' +
    '<html lang="zh-CN">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '  <title>加载中</title>\n' +
    '  <script src="' + DP_SCRIPT_URL + '"></script>\n' +
    '</head>\n' +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#333">\n' +
    '  <p style="font-size:16px;margin:0">加载中…</p>\n' +
    '</body>\n' +
    '</html>';
}

export async function onRequest(context) {
  const id = String((context.params && context.params.id) || '').toLowerCase();
  if (!/^[a-z0-9]{8}$/.test(id)) {
    return new Response('链接无效', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(landingHtml(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

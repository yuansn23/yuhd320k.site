// 后台访问地址迁移：老域名 /admin* → 新域名（仅后台路径，其余请求原样放行）
// 两个域名（url.yuhd320k.site 与 url.md625dk.site）都解析到同一个 Pages 项目，
// 这里通过 Host 判断来路：老域名访问后台时 301 跳到新域名，其余不动。
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const p = url.pathname;

  // 仅后台路径需要跳转：/admin、/admin.html、/admin/xxx
  const isAdminPath = p === '/admin' || p === '/admin.html' || p.startsWith('/admin/');

  if (url.hostname === 'url.yuhd320k.site' && isAdminPath) {
    // 保留原路径与查询参数，只换域名
    return Response.redirect('https://url.md625dk.site' + url.pathname + url.search, 301);
  }

  // 其它域名、其它路径：交给后续正常路由处理
  return context.next();
}

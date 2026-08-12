// GET /api/rd?_u=xxx&_s=xxx&_t=url — 普通跳转地址中转计数 + 302跳转
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const target = url.searchParams.get('_t') || '';
    const user = url.searchParams.get('_u') || '';
    const site = url.searchParams.get('_s') || '';

    if (!target) {
      return new Response('Missing target URL', { status: 400 });
    }

    // 下载计数（非阻塞）
    if (user) {
      const today = new Date().toISOString().slice(0, 10);
      context.waitUntil(
        env.DB.prepare(
          'INSERT INTO download_counts (username, date, site, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT (username, date, site) DO UPDATE SET count = count + 1'
        ).bind(user, today, site).run().catch(function(){})
      );
    }

    return Response.redirect(target, 302);
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}

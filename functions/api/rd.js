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

    // 下载计数 + 点击日志（非阻塞）
    if (user) {
      const today = new Date().toISOString().slice(0, 10);
      const ip = request.headers.get('CF-Connecting-IP') || '';
      const ua = request.headers.get('User-Agent') || '';
      const dev = (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) ? '手机' : '电脑';
      const lang = (request.headers.get('Accept-Language') || '').split(',')[0] || '';
      const now = new Date().toISOString();
      context.waitUntil(
        env.DB.batch([
          env.DB.prepare('INSERT INTO download_counts (username, date, site, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT (username, date, site) DO UPDATE SET count = count + 1')
            .bind(user, today, site),
          env.DB.prepare('INSERT INTO click_logs (username, site, click_time, ip, device, lang, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
            .bind(user, site, now, ip, dev, lang, ua.substring(0, 500))
        ]).catch(function(){})
      );
      // 预聚合计数（独立 waitUntil，即使 stats_daily 未建表也不影响日志写入）
      context.waitUntil(
        env.DB.prepare('INSERT INTO stats_daily (username, date, visits, clicks) VALUES (?1, ?2, 0, 1) ON CONFLICT(username, date) DO UPDATE SET clicks = clicks + 1')
          .bind(user, today).run().catch(function(){})
      );
    }

    return Response.redirect(target, 302);
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}

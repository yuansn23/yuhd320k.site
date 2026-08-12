// GET /api/dl?key=apk/app-xxx.apk — 强制下载APK文件
export async function onRequest(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key') || '';
    if (!key) {
      return new Response('Missing key', { status: 400 });
    }
    const obj = await env.r2admin.get(key);
    if (!obj) {
      return new Response('File not found', { status: 404 });
    }
    // 下载计数 + 点击日志（非阻塞）
    const dlUser = url.searchParams.get('_u') || '';
    const dlSite = url.searchParams.get('_s') || '';
    if (dlUser) {
      const today = new Date().toISOString().slice(0, 10);
      const ip = request.headers.get('CF-Connecting-IP') || '';
      const ua = request.headers.get('User-Agent') || '';
      const device = (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) ? '手机' : '电脑';
      const lang = (request.headers.get('Accept-Language') || '').split(',')[0] || '';
      const now = new Date().toISOString();
      context.waitUntil(
        env.DB.batch([
          env.DB.prepare('INSERT INTO download_counts (username, date, site, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT (username, date, site) DO UPDATE SET count = count + 1')
            .bind(dlUser, today, dlSite),
          env.DB.prepare('INSERT INTO click_logs (username, site, click_time, ip, device, lang, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
            .bind(dlUser, dlSite, now, ip, device, lang, ua.substring(0, 500))
        ]).catch(function(){})
      );
    }

    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="' + key.split('/').pop() + '"',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}

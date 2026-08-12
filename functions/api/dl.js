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
    // 下载计数（非阻塞，按用户+日期+站点）
    const dlUser = url.searchParams.get('_u') || '';
    const dlSite = url.searchParams.get('_s') || '';
    if (dlUser) {
      const today = new Date().toISOString().slice(0, 10);
      context.waitUntil(
        env.DB.prepare(
          'INSERT INTO download_counts (username, date, site, count) VALUES (?1, ?2, ?3, 1) ON CONFLICT (username, date, site) DO UPDATE SET count = count + 1'
        ).bind(dlUser, today, dlSite).run().catch(function(){})
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

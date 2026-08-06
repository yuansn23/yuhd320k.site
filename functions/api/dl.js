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

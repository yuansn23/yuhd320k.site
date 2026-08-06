// GET /api/admin/history — 返回上传历史
export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization'
      }});
    }

    const user = env.ADMIN_USER || '';
    const pass = env.ADMIN_PASS || '';
    const auth = request.headers.get('Authorization') || '';
    if (auth !== 'Basic ' + btoa(user + ':' + pass)) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic realm="Admin"', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const raw = (await env.APK_STORE.get('upload_history')) || '[]';
    return new Response(JSON.stringify(JSON.parse(raw)), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

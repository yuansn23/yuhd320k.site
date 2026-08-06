// GET /api/admin/debug — 诊断环境变量是否注入成功（不暴露密码）
export async function onRequest(context) {
  const { env } = context;
  return new Response(JSON.stringify({
    userSet: (env.ADMIN_USER || '') !== '',
    passSet: (env.ADMIN_PASS || '') !== '',
    userLen: (env.ADMIN_USER || '').length,
    passLen: (env.ADMIN_PASS || '').length
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// Scout 转发程序（Cloudflare Worker）
//
// 用途：有些大模型服务商不允许网页直接调用（跨域限制）。这个转发程序把网页的请求
// 原样转给服务商。它不保存任何数据，也不记录 key。
//
// 两种用法：
// 1. 整站部署到 Cloudflare Workers（见 README）：server/worker.mjs 会自动在 /api/proxy 提供它，
//    网页直连失败时会自动改走这里，用户什么都不用填。
// 2. 网站放在 GitHub Pages：把本文件单独部署成一个 Worker（Cloudflare 控制台 → Workers & Pages →
//    创建 Worker → 粘贴本文件 → 部署），再把地址填进 Scout「设置 → 高级：转发地址」。
//
// 安全：只转发到 ALLOWED_HOSTS 里的服务商地址，避免被当成公共代理。

export const ALLOWED_HOSTS = [
  'api.deepseek.com',
  'api.anthropic.com',
  'api.openai.com',
  'dashscope.aliyuncs.com',
  'dashscope-intl.aliyuncs.com',
  'api.moonshot.cn',
  'api.moonshot.ai',
  'open.bigmodel.cn',
  'generativelanguage.googleapis.com',
  'api.tavily.com',
];

// 单独部署时，只允许这些网页使用你的 Worker；留空表示允许任何网页
const ALLOWED_ORIGINS = [
  // 'https://YOUR_NAME.github.io',
];

const MAX_BODY = 512 * 1024;

function cors(origin, allowedOrigins) {
  const ok = !allowedOrigins.length || allowedOrigins.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function fail(status, message, headers) {
  return new Response(JSON.stringify({ error: { message } }), {
    status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers),
  });
}

export async function handleProxy(request, { allowedOrigins = ALLOWED_ORIGINS } = {}) {
  const origin = request.headers.get('Origin') || '';
  const h = cors(origin, allowedOrigins);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (request.method === 'GET') return new Response('Scout proxy is running.', { status: 200, headers: h });
  if (request.method !== 'POST') return fail(405, '只支持 POST', h);
  if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) return fail(403, '这个网页没有被允许使用此转发程序', h);

  let target;
  try { target = new URL(request.headers.get('x-target-url') || ''); } catch (e) { return fail(400, '缺少 x-target-url', h); }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.includes(target.hostname)) return fail(403, '不允许转发到 ' + target.hostname, h);

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY) return fail(413, '请求太大', h);

  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const key = k.toLowerCase();
    if (['x-target-url', 'origin', 'referer', 'host', 'cookie', 'content-length'].includes(key)) continue;
    if (key.startsWith('cf-') || key.startsWith('x-forwarded') || key === 'x-real-ip') continue;
    headers.set(k, v);
  }
  let upstream;
  try {
    upstream = await fetch(target.toString(), { method: 'POST', headers, body, redirect: 'error' });
  } catch (e) {
    return fail(502, '转发失败：连不上 ' + target.hostname, h);
  }
  const out = new Headers(upstream.headers);
  out.delete('content-encoding'); out.delete('content-length');
  Object.entries(h).forEach(([k, v]) => out.set(k, v));
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export default { fetch: request => handleProxy(request) };

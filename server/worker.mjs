// 整站部署到 Cloudflare Workers 时的入口：
// - /api/proxy：同源转发程序（只给本站网页用），浏览器直连服务商失败时自动走这里
// - 其他路径：返回网页静态文件
import { handleProxy } from '../proxy/worker.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/proxy') return handleProxy(request, { allowedOrigins: [url.origin] });
    return env.ASSETS.fetch(request);
  },
};

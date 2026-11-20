const JSON_HEADERS = {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'};

function result(value,status=200) {
  return new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
}

async function bounded(stream,limit) {
  if (!stream) throw new Error('empty body');
  const reader = stream.getReader(), parts = [];
  let length = 0;
  try {
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new RangeError('too large');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) { bytes.set(p,offset); offset += p.length; }
  return new TextDecoder().decode(bytes);
}

async function proxy(request,path) {
  if (request.method !== 'POST') return result({error:'method'},405);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return result({error:'origin'},403);
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer [^\s]{1,4096}$/.test(auth)) return result({error:'key'},401);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return result({error:'content_type'},415);
  let input;
  try {
    input = JSON.parse(await bounded(request.body,160000));
  } catch (e) { return result({error:'request'},e instanceof RangeError ? 413 : 400); }
  if (!input || Array.isArray(input) || typeof input !== 'object') return result({error:'request'},400);
  let url, init;
  if (path === '/api/search') {
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 400) return result({error:'query'},400);
    url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q',input.query);
    url.searchParams.set('count','12');
    init = {headers:{'X-Subscription-Token':auth.slice(7),Accept:'application/json'}};
  } else {
    if (!['deepseek','openai'].includes(input.provider) || typeof input.model !== 'string' ||
      !input.model.trim() || input.model.length > 160 || typeof input.prompt !== 'string' ||
      !input.prompt.trim() || input.prompt.length > 65000 || typeof input.search !== 'boolean') return result({error:'model_request'},400);
    const openai = input.provider === 'openai';
    url = openai ? 'https://api.openai.com/v1/responses' : 'https://api.deepseek.com/chat/completions';
    const body = openai ? {model:input.model,input:input.prompt,store:false,max_output_tokens:4096}
      : {model:input.model,messages:[{role:'user',content:input.prompt}],stream:false,max_tokens:4096};
    if (openai && input.search) Object.assign(body,{tools:[{type:'web_search'}],tool_choice:'required',include:['web_search_call.action.sources']});
    init = {method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)};
  }
  try {
    const upstream = await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(150000)});
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return result({error:'upstream'},upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502);
    }
    const data = JSON.parse(await bounded(upstream.body,1_500_000));
    return result(data);
  } catch (e) { return result({error:'upstream_unavailable'},e.name === 'TimeoutError' ? 504 : 502); }
}

export default {
  async fetch(request,env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/capabilities' && request.method === 'GET') return result({scout_model_proxy:1});
    if (path === '/api/model' || path === '/api/search') return proxy(request,path);
    return env.ASSETS.fetch(request);
  }
};

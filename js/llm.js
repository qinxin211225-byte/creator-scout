// 大模型调用：浏览器直接请求服务商，密钥不经过任何第三方。
// 三种接口格式见 config.js 的 PROVIDERS。
import { PROVIDERS } from './config.js?v=0.3.4';

export class LLMError extends Error {
  constructor(message, kind) { super(message); this.kind = kind || 'error'; }
}

const trimSlash = s => String(s || '').replace(/\/+$/, '');

// 网站整站部署在 Cloudflare Workers 时，同域下有 /api/proxy 转发程序。
// 浏览器直连服务商被跨域拦截时，自动改走它，用户不用做任何设置。
let autoProxy = '';
export async function detectProxy() {
  try {
    const u = new URL('api/proxy', location.href).href;
    const r = await fetch(u, { method: 'GET', cache: 'no-store' });
    if (r.ok && (await r.text()).includes('Scout proxy')) autoProxy = u;
  } catch (e) {}
  return autoProxy;
}
export const hasAutoProxy = () => !!autoProxy;

async function send(target, h, body, signal) {
  return fetch(target, { method: 'POST', headers: h, body: JSON.stringify(body), signal });
}

async function post(url, headers, body, cfg, signal) {
  const h = Object.assign({ 'content-type': 'application/json' }, headers);
  let r;
  try {
    if (cfg.proxy) r = await send(cfg.proxy, Object.assign({ 'x-target-url': url }, h), body, signal);
    else {
      try { r = await send(url, h, body, signal); }
      catch (e) {
        if (e.name === 'AbortError' || !autoProxy) throw e;
        r = await send(autoProxy, Object.assign({ 'x-target-url': url }, h), body, signal);
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new LLMError('浏览器连不上这个服务。可能是网络问题，或者这家服务商不允许网页直接调用（跨域限制）。可以换 DeepSeek / Claude / OpenAI，或在设置里填一个转发地址（见 README）。', 'network');
  }
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch (e) {}
  if (!r.ok) {
    let msg = data && ((data.error && (data.error.message || data.error)) || data.message || data.detail);
    if (typeof msg !== 'string') msg = msg ? JSON.stringify(msg) : text.slice(0, 200);
    const kind = r.status === 401 || r.status === 403 ? 'auth' : r.status === 429 ? 'rate' : r.status === 402 ? 'billing' : 'http';
    const hint = { auth: '（key 不对或没有权限）', rate: '（请求太频繁，稍后再试）', billing: '（账户余额不足）' }[kind] || '';
    throw new LLMError(`服务商返回 ${r.status}${hint}：${msg}`, kind);
  }
  return data;
}

/* ---------- Anthropic Messages 格式（Claude、DeepSeek） ---------- */
async function callMessages(cfg, { system, user, search, maxTokens, signal }) {
  const p = PROVIDERS[cfg.provider] || {};
  const url = trimSlash(cfg.baseUrl) + '/v1/messages';
  const headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
  if (cfg.provider === 'anthropic') headers['anthropic-dangerous-direct-browser-access'] = 'true';
  let tools;
  if (search) {
    tools = p.search === 'deepseek'
      ? [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }, { type: 'deepseek_read_url', name: 'deepseek_read_url' }]
      : [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }];
  }
  const messages = [{ role: 'user', content: user }];
  const out = { text: '', sources: [], usage: { input: 0, output: 0, searches: 0 } };
  for (let i = 0; i < 6; i++) {
    const body = { model: cfg.model, max_tokens: maxTokens, system, messages };
    if (tools) body.tools = tools;
    const d = await post(url, headers, body, cfg, signal);
    const u = d.usage || {};
    out.usage.input += u.input_tokens || 0;
    out.usage.output += u.output_tokens || 0;
    out.usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    for (const b of d.content || []) {
      if (b.type === 'text') {
        out.text += b.text || '';
        for (const c of b.citations || []) if (c.url) out.sources.push(c.url);
      }
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url) out.sources.push(r.url);
      }
    }
    if (d.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: d.content }); continue; }
    break;
  }
  return out;
}

/* ---------- OpenAI Responses 格式 ---------- */
async function callResponses(cfg, { system, user, search, maxTokens, signal }) {
  const url = trimSlash(cfg.baseUrl) + '/responses';
  const body = { model: cfg.model, instructions: system, input: user, max_output_tokens: maxTokens };
  if (search) body.tools = [{ type: 'web_search' }];
  const d = await post(url, { Authorization: 'Bearer ' + cfg.apiKey }, body, cfg, signal);
  const out = { text: '', sources: [], usage: { input: 0, output: 0, searches: 0 } };
  if (typeof d.output_text === 'string') out.text = d.output_text;
  for (const item of d.output || []) {
    if (item.type === 'web_search_call') out.usage.searches++;
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text') {
        if (!d.output_text) out.text += c.text || '';
        for (const a of c.annotations || []) if (a.url) out.sources.push(a.url);
      }
    }
  }
  const u = d.usage || {};
  out.usage.input = u.input_tokens || 0; out.usage.output = u.output_tokens || 0;
  return out;
}

/* ---------- OpenAI Chat Completions 格式 + Tavily 搜索 ---------- */
async function tavily(cfg, query, signal) {
  if (!cfg.tavilyKey) throw new LLMError('这个服务商需要 Tavily 搜索 key 才能联网，请在设置里填写。', 'config');
  const d = await post('https://api.tavily.com/search', { Authorization: 'Bearer ' + cfg.tavilyKey }, { query, max_results: 6 }, cfg, signal);
  return (d.results || []).map(x => ({ title: x.title, url: x.url, content: String(x.content || '').slice(0, 600) }));
}
async function callChat(cfg, { system, user, search, maxTokens, signal }) {
  const url = trimSlash(cfg.baseUrl) + '/chat/completions';
  const headers = { Authorization: 'Bearer ' + cfg.apiKey };
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const tools = search ? [{
    type: 'function',
    function: {
      name: 'web_search', description: '搜索网页，返回标题、网址和摘要',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索词' } }, required: ['query'] },
    },
  }] : undefined;
  const out = { text: '', sources: [], usage: { input: 0, output: 0, searches: 0 } };
  for (let i = 0; i < 10; i++) {
    const body = { model: cfg.model, messages, max_tokens: maxTokens };
    if (tools) body.tools = tools;
    const d = await post(url, headers, body, cfg, signal);
    const u = d.usage || {};
    out.usage.input += u.prompt_tokens || 0; out.usage.output += u.completion_tokens || 0;
    const m = (d.choices && d.choices[0] && d.choices[0].message) || {};
    if (m.tool_calls && m.tool_calls.length && i < 9) {
      messages.push(m);
      for (const tc of m.tool_calls) {
        let q = ''; try { q = JSON.parse(tc.function.arguments || '{}').query || ''; } catch (e) {}
        const res = q ? await tavily(cfg, q, signal) : [];
        out.usage.searches++;
        res.forEach(x => out.sources.push(x.url));
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res) });
      }
      continue;
    }
    out.text = m.content || '';
    break;
  }
  return out;
}

/* ---------- 本机 Codex（通过 bridge/scout_codex_bridge.py） ---------- */
export const CODEX_URL = 'http://127.0.0.1:43219';
async function codexFetch(path, cfg, body, signal) {
  let r;
  try {
    r = await fetch(CODEX_URL + path, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + cfg.codexToken },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new LLMError('连不上本机 Codex：连接程序没在运行。如果装过后台服务，让 Codex 运行一下 --status 检查；没装过就按「设置 → 本机 Codex」把那段话发给 Codex。浏览器问是否允许访问本地网络时，选允许。', 'network');
  }
  let d = null; try { d = await r.json(); } catch (e) {}
  if (r.status === 401) throw new LLMError('本机 Codex 的配对码对不上（可能用 --reset 重置过），请在设置里重新「一键连接」。', 'auth');
  if (r.status === 409) throw new LLMError('Codex 正在处理上一个请求，请稍等。', 'rate');
  if (!r.ok) throw new LLMError((d && d.error) || ('本机 Codex 返回 ' + r.status), 'http');
  return d || {};
}
export async function codexStatus(cfg, signal) { return codexFetch('/status', cfg, {}, signal); }
async function callCodex(cfg, { system, user, search, signal }) {
  const d = await codexFetch('/ask', cfg, { prompt: system + '\n\n' + user, search: !!search }, signal);
  return { text: d.text || '', sources: d.sources || [], usage: { input: 0, output: 0, searches: search ? 1 : 0 } };
}

/* ---------- 对外接口 ---------- */
export function checkConfig(cfg) {
  const p = PROVIDERS[cfg.provider];
  if (!p) return '请先在设置里选择模型服务商';
  if (p.api === 'codex') return cfg.codexToken ? '' : '请先在设置里连接本机 Codex';
  if (!cfg.apiKey) return '请先在设置里填写模型 API Key';
  if (!cfg.baseUrl) return '请先在设置里填写接口地址';
  if (!cfg.model) return '请先在设置里填写模型名';
  if (p.search === 'tavily' && !cfg.tavilyKey) return '这个服务商需要 Tavily 搜索 key，请在设置里填写';
  return '';
}

export async function callLLM(cfg, opts) {
  const p = PROVIDERS[cfg.provider];
  const o = Object.assign({ maxTokens: 6000, search: false }, opts);
  if (p.api === 'codex') return callCodex(cfg, o);
  if (p.api === 'messages') return callMessages(cfg, o);
  if (p.api === 'responses') return callResponses(cfg, o);
  return callChat(cfg, o);
}

export async function testLLM(cfg, signal) {
  const r = await callLLM(cfg, { system: '你是连通性测试。只回复两个字母：OK', user: 'ping', search: false, maxTokens: 20, signal });
  return r.text.trim();
}

// 从模型回复里取出 JSON（容忍 ```json 代码块和前后多余文字）
export function extractJSON(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  const starts = [t.indexOf('{'), t.indexOf('[')].filter(i => i >= 0);
  if (!starts.length) throw new Error('回复里没有 JSON');
  const start = Math.min(...starts);
  const close = t[start] === '{' ? '}' : ']';
  for (let end = t.lastIndexOf(close); end > start; end = t.lastIndexOf(close, end - 1)) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) {}
  }
  throw new Error('回复里的 JSON 不完整');
}

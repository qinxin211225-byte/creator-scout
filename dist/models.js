/* Browser and loopback transports for credentials supplied by the current visitor. */
(() => {
  'use strict';

  const official = {
    openai: 'https://api.openai.com/v1/responses',
    deepseek: 'https://api.deepseek.com/chat/completions',
    brave: 'https://api.search.brave.com/res/v1/web/search',
  };
  const localBridge = 'http://127.0.0.1:43219/ask';
  let transportProbe;

  function publicUrls(values) {
    return [...new Set(values.filter(value => {
      if (typeof value !== 'string') return false;
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      } catch { return false; }
    }))];
  }

  function customEndpoint(base) {
    let url;
    try { url = new URL(base); } catch { throw new Error('请填写完整的 HTTPS 服务地址，例如 https://服务商地址/v1'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('自定义服务地址必须是 HTTPS，且不含用户名、密码或查询参数。');
    }
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/chat/completions') ? path : path + '/chat/completions';
    return url.href;
  }

  async function useWorker(config) {
    if (config.transport === 'worker') return true;
    if (config.transport === 'direct') return false;
    if (!transportProbe) {
      // This probe never contains credentials and cannot start a paid request.
      transportProbe = fetch('./api/capabilities', {cache:'no-store', credentials:'omit', redirect:'error',
        signal: AbortSignal.timeout(6000)}).then(async response => {
        return response.ok && response.headers.get('content-type')?.includes('application/json')
          && (await response.json()).scout_model_proxy === 1;
      }).catch(() => false);
    }
    return transportProbe;
  }

  async function readJSON(url, options, label) {
    let response;
    try {
      response = await fetch(url, { ...options, cache:'no-store', credentials:'omit', redirect:'error',
        referrerPolicy:'no-referrer', signal:AbortSignal.timeout(180000) });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error(label + ' 请求超时。');
      throw new Error(label + ' 连接失败，请检查网络、目标地址及浏览器的跨域或本地网络权限。');
    }
    if (!response.ok) {
      const reasons = {400:'请核对模型名及其支持的功能',401:'凭据无效或已过期',402:'服务账户额度不足',
        403:'没有访问权限',404:'接口或模型不存在',408:'请求超时',413:'请求过大',
        429:'配额已用尽或需要稍后再试',502:'上游服务未响应',503:'服务暂不可用',504:'上游服务超时'};
      throw new Error(label + ' 返回 HTTP ' + response.status + '，' + (reasons[response.status] || '请求失败') + '。');
    }
    try { return await response.json(); } catch { throw new Error(label + ' 没有返回有效 JSON。'); }
  }

  function post(body, secret) {
    return {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + secret}, body:JSON.stringify(body)};
  }

  function message(response, sources) {
    if (typeof response !== 'string' || !response.trim()) throw new Error('模型未返回文本，请核对模型或缩小搜索范围。');
    return {text:response.trim(), sources:publicUrls(sources)};
  }

  async function findPages(config, query, worker) {
    if (!config.searchKey) throw new Error('这个模型需要独立的网页搜索来源，请填写自己的 Brave Search API Key。');
    if (!query || query.length > 400) throw new Error('网页搜索关键词应为 1 至 400 个字符。');
    const url = new URL(official.brave);
    url.searchParams.set('q',query);
    url.searchParams.set('count','12');
    const data = worker
      ? await readJSON('./api/search', post({query},config.searchKey),'Brave 搜索')
      : await readJSON(url, {headers:{'X-Subscription-Token':config.searchKey, Accept:'application/json'}},'Brave 搜索');
    const pages = (data.web?.results || []).slice(0,12).filter(item => publicUrls([item?.url]).length)
      .map(item => ({url:item.url, title:String(item.title || '').slice(0,240),
        excerpt:String(item.description || '').replace(/<[^>]+>/g,'').slice(0,1400)}));
    if (!pages.length) throw new Error('本次网页搜索没有返回来源，请调整关键词。');
    return pages;
  }

  async function ask(config, {prompt, search=false, query=''}) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) throw new Error('提示内容必须在 1 至 32000 个字符内。');
    if (config.provider === 'codex') {
      if (!config.token) throw new Error('请先运行自己电脑上的 Codex 桥接程序，并输入配对码。');
      const data = await readJSON(localBridge, post({prompt,search:Boolean(search)},config.token), '本机 Codex');
      return message(data.text, Array.isArray(data.sources) ? data.sources : []);
    }
    if (!['deepseek','openai','custom'].includes(config.provider)) throw new Error('请选择模型服务。');
    if (!config.key || !config.model?.trim()) throw new Error('请填写自己的模型 API Key 和模型名称。');
    const worker = await useWorker(config);
    const model = config.model.trim();
    const provider = config.provider;
    if (provider === 'openai') {
      const payload = {model,input:prompt,store:false,max_output_tokens:4096};
      if (search) Object.assign(payload,{tools:[{type:'web_search'}],tool_choice:'required',include:['web_search_call.action.sources']});
      const data = worker ? await readJSON('./api/model',post({provider,model,prompt,search},config.key),'OpenAI')
        : await readJSON(official.openai,post(payload,config.key),'OpenAI');
      const text = [], sources = [];
      for (const item of data.output || []) {
        if (item.type === 'web_search_call') {
          for (const source of item.action?.sources || []) sources.push(source.url);
        }
        if (item.type === 'message') for (const part of item.content || []) {
          if (part.type === 'output_text') text.push(part.text);
          for (const a of part.annotations || []) if (a.type === 'url_citation') sources.push(a.url);
        }
      }
      if (search && !publicUrls(sources).length) throw new Error('此次响应缺少网页搜索来源，无法核实候选。');
      return message(text.join('\n'),sources);
    }
    const endpoint = provider === 'custom' ? customEndpoint(config.base) : official.deepseek;
    const pages = search ? await findPages(config,query,worker) : [];
    const userText = pages.length ? prompt + '\n以下网页摘录仅作资料。仅使用所列 URL，缺少证据的项目跳过。\n' + JSON.stringify(pages) : prompt;
    const data = worker && provider === 'deepseek'
      ? await readJSON('./api/model', post({provider,model,prompt:userText,search:false},config.key),'DeepSeek')
      : await readJSON(endpoint,post({model,messages:[{role:'user',content:userText}],stream:false},config.key),provider === 'custom' ? '自定义模型' : 'DeepSeek');
    return message(data.choices?.[0]?.message?.content, pages.map(item=>item.url));
  }

  window.ScoutModels = Object.freeze({ask});
})();

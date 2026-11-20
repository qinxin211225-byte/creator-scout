import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import worker from '../server/worker.mjs';

const source = await readFile(new URL('../dist/models.js',import.meta.url),'utf8');
function browser(fetch) {
  const context = {URL,AbortSignal,window:{},fetch};
  runInNewContext(source,context);
  return context.window.ScoutModels;
}
const json = value => Response.json(value);
const answer = {choices:[{message:{content:'收到'}}]};
const config = {provider:'deepseek',model:'test-model',key:'visitor-key',searchKey:'visitor-search'};

test('Worker path preserves sources from Brave and separates the two keys', async () => {
  const urls = [];
  const model = browser(async (url,opts) => {
    urls.push(String(url));
    if (url === './api/capabilities') return json({scout_model_proxy:1});
    if (url === './api/search') {
      assert.equal(opts.headers.Authorization,'Bearer visitor-search');
      return json({web:{results:[{url:'https://example.org/alice',title:'Alice',description:'public bio'}]}});
    }
    assert.equal(opts.headers.Authorization,'Bearer visitor-key');
    assert.ok(JSON.parse(opts.body).prompt.includes('public bio'));
    return json(answer);
  });
  const result = await model.ask(config,{prompt:'审核资料',search:true,query:'公开账号'});
  assert.deepEqual(urls,['./api/capabilities','./api/search','./api/model']);
  assert.deepEqual(Array.from(result.sources),['https://example.org/alice']);
});
test('static mode performs a harmless check before the only paid call', async () => {
  const urls = [];
  const model = browser(async (url,opts) => {
    urls.push(String(url));
    if (url === './api/capabilities') return new Response('static',{status:404});
    assert.equal(opts.redirect,'error');
    return json(answer);
  });
  assert.equal((await model.ask(config,{prompt:'ping'})).text,'收到');
  assert.deepEqual(urls,['./api/capabilities','https://api.deepseek.com/chat/completions']);
});
test('custom key goes only to the explicit endpoint', async () => {
  const model = browser(async (url,opts) => {
    assert.equal(url,'https://user.example/v1/chat/completions');
    assert.equal(opts.headers.Authorization,'Bearer visitor-key');
    return json(answer);
  });
  const c = {...config,provider:'custom',base:'https://user.example/v1/',transport:'worker'};
  assert.equal((await model.ask(c,{prompt:'ping'})).text,'收到');
  await assert.rejects(model.ask({...c,base:'http://user.example'},{prompt:'ping'}),/HTTPS/);
});
test('OpenAI reads server-search sources only and honors empty results', async () => {
  const data = {output:[{type:'web_search_call',action:{sources:[{url:'https://example.org/evidence'}]}},
    {type:'message',content:[{type:'output_text',text:'结果',annotations:[{type:'url_citation',url:'javascript:alert(1)'}]}]}]};
  const model = browser(async (url,opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.store,false);
    assert.equal(body.tools[0].type,'web_search');
    return json(data);
  });
  const ask = () => model.ask({...config,provider:'openai',transport:'direct'},{prompt:'test',search:true});
  assert.deepEqual(Array.from((await ask()).sources),['https://example.org/evidence']);
  data.output.shift();
  await assert.rejects(ask(),/缺少网页搜索来源/);
});
test('Codex key goes to visitor loopback only', async () => {
  const model = browser(async (url,opts) => {
    assert.equal(url,'http://127.0.0.1:43219/ask');
    assert.equal(opts.headers.Authorization,'Bearer pairing');
    return json({text:'结果',sources:['https://example.org/evidence']});
  });
  assert.equal((await model.ask({provider:'codex',token:'pairing'},{prompt:'abc',search:true})).text,'结果');
});
test('Worker validates origin, route and payload before making fixed upstream request',async () => {
  const post = (body,origin='https://scout.example') => new Request('https://scout.example/api/model',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer example',Origin:origin},body:JSON.stringify(body)});
  const body = {provider:'deepseek',model:'demo',prompt:'hello',search:false};
  assert.equal((await worker.fetch(post(body,'https://wrong.example'),{})).status,403);
  assert.equal((await worker.fetch(post({...body,provider:'custom',base:'https://wrong.example'}),{})).status,400);
  assert.equal((await worker.fetch(post({...body,prompt:'a'.repeat(170000)}),{})).status,413);
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url,options) => {
      assert.equal(url,'https://api.deepseek.com/chat/completions');
      assert.equal(options.redirect,'error');
      assert.equal(options.headers.Authorization,'Bearer example');
      return json(answer);
    };
    const r = await worker.fetch(post({...body,url:'https://ignored.example'}),{});
    assert.equal(r.headers.get('cache-control'),'no-store');
    assert.deepEqual(await r.json(),answer);
  } finally { globalThis.fetch = oldFetch; }
});
test('a provider failure is neither cached nor repeated on another transport',async () => {
  let calls = 0;
  const model = browser(async () => { calls++; return new Response('secret',{status:401}); });
  await assert.rejects(model.ask({...config,transport:'worker'},{prompt:'hello'}),/HTTP 401/);
  assert.equal(calls,1);
});

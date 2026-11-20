// 运行：node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidate, score, keyOf } from '../js/search.js';
import { extractJSON, checkConfig } from '../js/llm.js';
import { handleProxy } from '../proxy/worker.js';
import { DEFAULT_COUNTRIES, DEFAULT_GROUPS } from '../js/config.js';

const q = { platforms: ['instagram', 'tiktok', 'youtube'], fmin: 10000, fmax: 100000, camera: 'prefer', categories: ['lifestyle', 'vlog', 'family'], city: '' };
const ctx = { country: DEFAULT_COUNTRIES[0], group: DEFAULT_GROUPS[0], q, runId: 'r1', sources: [] };

test('extractJSON 能处理代码块和前后文字', () => {
  assert.deepEqual(extractJSON('好的：\n```json\n{"creators":[{"a":1}]}\n```\n以上'), { creators: [{ a: 1 }] });
  assert.deepEqual(extractJSON('[1,2]'), [1, 2]);
  assert.throws(() => extractJSON('没有'));
});

test('粉丝数超出区间被淘汰，支持 25k / 3.2w 写法', () => {
  const base = { platform: 'instagram', username: 'a', group_confidence: 0.9 };
  assert.ok(normalizeCandidate({ ...base, followers: '250k' }, ctx).reject);
  assert.equal(normalizeCandidate({ ...base, followers: '25k' }, ctx).creator.followers, 25000);
  assert.equal(normalizeCandidate({ ...base, followers: '3.2w' }, ctx).creator.followers, 32000);
});

test('粉丝数未知时保留，但标记未核实', () => {
  const r = normalizeCandidate({ platform: 'youtube', username: 'b', followers: null, group_confidence: 0.8 }, ctx);
  assert.equal(r.creator.followers_verified, false);
});

test('人群依据不足、平台不对、必须出镜但不确定，都会淘汰', () => {
  assert.ok(normalizeCandidate({ platform: 'instagram', username: 'c', group_confidence: 0.4 }, ctx).reject);
  assert.ok(normalizeCandidate({ platform: 'twitter', username: 'c', group_confidence: 0.9 }, ctx).reject);
  const strict = { ...ctx, q: { ...q, camera: 'require' } };
  assert.ok(normalizeCandidate({ platform: 'instagram', username: 'c', group_confidence: 0.9, on_camera: null }, strict).reject);
});

test('出镜的生活类博主分数最高', () => {
  const a = score({ category: 'vlog', on_camera: true, group_confidence: 0.9, followers_verified: true }, q);
  const b = score({ category: 'food', on_camera: true, group_confidence: 0.9, followers_verified: true }, q);
  const c = score({ category: 'vlog', on_camera: false, group_confidence: 0.9, followers_verified: true }, q);
  assert.ok(a > b && b > c);
});

test('keyOf 统一大小写并去掉 @', () => {
  assert.equal(keyOf('Instagram', '@Nadia.Mel'), 'instagram:nadia.mel');
});

test('checkConfig 提示缺少的设置', () => {
  assert.match(checkConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'x', model: 'm' }), /Key/);
  assert.match(checkConfig({ provider: 'compat', apiKey: 'k', baseUrl: 'x', model: 'm' }), /Tavily/);
  assert.equal(checkConfig({ provider: 'deepseek', apiKey: 'k', baseUrl: 'x', model: 'm' }), '');
});

test('转发程序拒绝不在白名单的地址和别的网站', async () => {
  const req = (target, origin) => new Request('https://scout.example/api/proxy', { method: 'POST', headers: { 'x-target-url': target, Origin: origin }, body: '{}' });
  assert.equal((await handleProxy(req('https://evil.example/x', 'https://scout.example'), { allowedOrigins: ['https://scout.example'] })).status, 403);
  assert.equal((await handleProxy(req('https://api.deepseek.com/x', 'https://other.example'), { allowedOrigins: ['https://scout.example'] })).status, 403);
  assert.equal((await handleProxy(new Request('https://scout.example/api/proxy'), {})).status, 200);
});

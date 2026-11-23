// 找博主流程：按“国家 × 人群”组合逐个让大模型联网搜索 → 代码校验、去重、打分。
// 粉丝区间、去重、打分全部由代码判断，不直接相信模型的结论。
import { PLATFORMS, CATEGORIES, LIFESTYLE, CAMERA } from './config.js?v=0.3.4';
import { callLLM, extractJSON } from './llm.js?v=0.3.4';

export const keyOf = (platform, username) =>
  String(platform || '').toLowerCase() + ':' + String(username || '').replace(/^@/, '').trim().toLowerCase();

export function score(c, prefs = {}) {
  const life = LIFESTYLE.includes(c.category);
  const cam = c.on_camera === true;
  let s = cam && life ? 60 : cam ? 42 : life ? 25 : 12;
  if (c.on_camera == null) s += 6;                       // 不确定出镜，给一点基础分
  if (prefs.categories && prefs.categories.includes(c.category)) s += 5;
  s += (c.group_confidence || 0) * 20;
  if (c.followers_verified) s += 5;
  return Math.round(Math.min(100, s));
}

const SYSTEM = `你是海外达人（KOL）搜寻助手，用网页搜索寻找真实存在的社交媒体个人博主。
必须遵守：
1. 只返回你在搜索结果或网页里真实看到的账号，绝不编造用户名、粉丝数或简介。
2. 判断博主属于哪个人群，只能依据博主公开的自我介绍、内容使用的语言、内容主题、定位和标签。禁止根据长相、肤色或名字推断族裔。
3. 只要个人或家庭博主；排除品牌、店铺、机构、新闻号、搬运号、段子聚合号。
4. 必须是常住在目标国家的人，不是去旅游的。
5. 粉丝数只写你在页面上看到的数字；看不到就写 null，不要估算。
6. 是否本人出镜：根据看到的内容（vlog、自拍、口播、视频描述）判断；判断不了写 null。
7. 只输出一个 JSON 对象，不要任何解释文字。`;

// 每一轮换一种搜法，避免总搜到同一批人
export const ANGLES = [
  { id: 'market', zh: '达人平台', tip: (g, city, sites) => `优先在达人合作平台的公开页面找：site:collabstr.com、site:joinbrands.com、site:heepsy.com 加“${g.name}（英文人群名）+ ${city} + lifestyle/creator”。这些页面常写着所在城市和粉丝数。` },
  { id: 'native', zh: '母语关键词', tip: (g, city, sites) => `用这个人群的母语关键词和标签加城市名搜索（见识别线索），也可以加 ${sites}。` },
  { id: 'media', zh: '媒体文章', tip: (g, city) => `找媒体、博客、社区网站上“${city} 的${g.name}博主/网红推荐”“在${city}生活的${g.name}”这类文章和名单，从里面挑个人博主。` },
  { id: 'similar', zh: '相似账号', tip: (g, city) => `从已经知道的同类博主出发（合作对象、互相提到的朋友、评论区活跃的同城博主、同一个社区活动的参与者）找新的人。可以搜“${g.name} creator ${city} collab”。` },
  { id: 'niche', zh: '细分内容', tip: (g, city) => `按细分内容找：${city} 的${g.name}妈妈博主、留学生、打工度假、夫妻 vlog、家常菜、开箱、穿搭等，每种都试一下。` },
];

function buildPrompt({ country, group, q, n, exclude, city, angle }) {
  const hints = (group.hints || '').replace(/\{city\}/g, city);
  const plats = q.platforms.map(p => PLATFORMS[p].label).join('、');
  const sites = q.platforms.map(p => 'site:' + PLATFORMS[p].site).join('、');
  const cats = (q.categories || []).map(c => CATEGORIES[c]).join('、') || '不限';
  return `请找 ${n} 位符合条件的博主：
- 常住在：${country.name}（${country.code}），这次重点找：${city}（附近城市也可以）
- 人群：${group.name}
- 识别线索和搜索关键词：${hints || '无'}
- 平台：${plats}
- 粉丝数：${q.fmin} 到 ${q.fmax}
- 出镜要求：${CAMERA[q.camera] || '不限'}
- 优先内容类别：${cats}

这一轮的搜法：${angle.tip(group, city, sites)}
${exclude.length ? `\n下面这些账号已经找到过或看过了，一个都不要再返回，要找新的人：\n${exclude.join(', ')}\n` : ''}
注意：很多结果是住在本国的博主（比如住在菲律宾的菲律宾博主），必须确认常住在${country.name}的才返回。username 必须是 ${plats} 用户名。宁可少返回，也不要编造。

输出格式（字段名不要改）：
{"creators":[{
  "platform":"${q.platforms.join('|')}",
  "username":"不带@的用户名",
  "display_name":"显示名",
  "profile_url":"主页网址",
  "followers":12345 或 null,
  "bio":"简介原文或片段",
  "city":"所在城市或 null",
  "group_confidence":0.0 到 1.0,
  "group_evidence":["用中文写 2～4 条依据，引用原文时加引号"],
  "languages":["内容语言的 ISO 代码，如 id、en"],
  "category":"${Object.keys(CATEGORIES).join('|')}",
  "on_camera":true 或 false 或 null,
  "on_camera_basis":"判断出镜的依据",
  "last_post":"最近一次发布的时间，看不到写 null",
  "contact_email":"简介里公开写出的邮箱，没有写 null",
  "sources":["你看到这个账号的网址"]
}]}
如果确实找不到新的，返回 {"creators":[]}。`;
}

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : null;
  const s = String(v).toLowerCase().replace(/,/g, '').trim();
  const m = s.match(/([\d.]+)\s*(k|m|w|万|千)?/);
  if (!m) return null;
  const mult = { k: 1e3, '千': 1e3, m: 1e6, w: 1e4, '万': 1e4 }[m[2]] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

// 校验并规范化一条结果；不合格返回 { reject: '原因' }
export function normalizeCandidate(raw, { country, group, q, runId, sources }) {
  const platform = String(raw.platform || '').toLowerCase();
  const username = String(raw.username || '').replace(/^@/, '').trim();
  if (!PLATFORMS[platform]) return { reject: '平台不在范围内' };
  if (!q.platforms.includes(platform)) return { reject: '平台不在本次条件里' };
  if (!username || /\s/.test(username) && platform !== 'youtube') return { reject: '用户名无效' };
  const followers = num(raw.followers);
  if (followers != null && (followers < q.fmin || followers > q.fmax)) return { reject: `粉丝 ${followers} 不在区间内` };
  const conf = Math.max(0, Math.min(1, Number(raw.group_confidence) || 0));
  if (conf < 0.6) return { reject: '人群依据不足' };
  const on_camera = raw.on_camera === true ? true : raw.on_camera === false ? false : null;
  if (q.camera === 'require' && on_camera !== true) return { reject: '不确定是否出镜' };
  const category = CATEGORIES[raw.category] ? raw.category : 'other';
  const src = [].concat(raw.sources || []).filter(u => /^https?:\/\//.test(u));
  const c = {
    id: keyOf(platform, username),
    platform, username,
    display_name: String(raw.display_name || username).slice(0, 80),
    profile_url: /^https?:\/\//.test(raw.profile_url || '') ? raw.profile_url : PLATFORMS[platform].url(username),
    followers, followers_verified: followers != null,
    bio: String(raw.bio || '').slice(0, 400),
    country: country.code, city: raw.city || q.city || null,
    group: group.id, group_confidence: Math.round(conf * 100) / 100,
    group_evidence: [].concat(raw.group_evidence || []).map(String).slice(0, 5),
    languages: [].concat(raw.languages || []).map(String).slice(0, 5),
    category,
    on_camera, on_camera_basis: raw.on_camera_basis ? String(raw.on_camera_basis).slice(0, 200) : '',
    last_post: raw.last_post || null,
    contact_email: /@/.test(raw.contact_email || '') ? String(raw.contact_email) : null,
    sources: src.length ? src.slice(0, 5) : (sources || []).slice(0, 3),
    linked_accounts: [],
    found_at: new Date().toISOString(), run_id: runId,
    status: 'new', notes: '',
  };
  c.priority_score = score(c, q);
  return { creator: c };
}

function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export const coverKey = (country, group, city) => `${country}|${group}|${city}`.toLowerCase();

/**
 * 生成搜索任务：轮流搜每个“国家 × 人群”，每轮换一个城市（最久没搜过的优先）和一种搜法。
 * coverage：{ key: 上次搜索时间 }，用来跨次记住搜过哪里。
 */
export function planTasks(combos, q, coverage, rounds) {
  const perCombo = combos.map(([country, group]) => {
    const cities = q.city ? [q.city] : (country.cities.length ? country.cities.slice() : [country.name]);
    cities.sort((a, b) => covTime(coverage[coverKey(country.code, group.id, a)]) - covTime(coverage[coverKey(country.code, group.id, b)]));
    return { country, group, cities };
  });
  const tasks = [];
  for (let r = 0; r < rounds; r++) {
    for (const c of perCombo) {
      if (!q.city && r >= c.cities.length * 2) continue;            // 每个城市最多搜两轮（两种搜法）
      const city = c.cities[r % c.cities.length];
      const times = covCount(coverage[coverKey(c.country.code, c.group.id, city)]);   // 这个城市以前搜过几次，换一种没用过的搜法
      const angle = ANGLES[(Math.floor(r / c.cities.length) + times + hashStr(c.group.id + c.country.code)) % ANGLES.length];
      tasks.push({ country: c.country, group: c.group, city, angle, round: r });
    }
  }
  return tasks;
}
// coverage 的值：[上次时间, 次数]（兼容旧版只存时间）
const covTime = v => Array.isArray(v) ? v[0] : (v || 0);
const covCount = v => Array.isArray(v) ? v[1] : (v ? 1 : 0);
function hashStr(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

/**
 * 运行一次查找。q.limit = 0 表示不限：把所有组合、城市、搜法都试一遍，直到找不到新的或被停止。
 * seen：以前看过但没收录的账号（不合格、重复），会告诉 AI 不要再返回。
 * onFound：每找到一位就回调一次，界面可以边找边显示、边保存。
 */
export async function runSearch({ q, cfg, groups, countries, existing, seen = [], coverage = {}, onProgress, onFound, onSeen, onCover, signal, trigger, presetName }) {
  const runId = 'run-' + Date.now().toString(36);
  const unlimited = !q.limit;
  const limit = unlimited ? Infinity : Math.max(1, Math.min(500, q.limit));
  const run = {
    id: runId, trigger: trigger || 'manual', preset: presetName || '自定义条件',
    started_at: new Date().toISOString(), finished_at: null, status: 'running',
    provider: cfg.provider, model: cfg.model, limit: unlimited ? 0 : limit,
    combos: [], calls: 0, candidates: 0, added: 0, duplicates: 0, rejected: 0,
    reject_reasons: {}, errors: [], usage: { input: 0, output: 0, searches: 0 },
  };
  const log = (text, kind) => onProgress && onProgress({ text, kind, run });

  const known = new Set();
  const byGroup = {};                      // 每个人群已知的用户名，用于告诉 AI 不要重复
  const remember = (platform, username, group) => {
    known.add(keyOf(platform, username));
    if (group) (byGroup[group] = byGroup[group] || new Set()).add(String(username).toLowerCase());
  };
  for (const c of existing) {
    remember(c.platform, c.username, c.group);
    for (const a of c.linked_accounts || []) remember(a.platform, a.username, c.group);
  }
  for (const s of seen) remember(s.platform || 'instagram', s.username, s.group || '*');

  const gById = Object.fromEntries(groups.map(g => [g.id, g]));
  const cByCode = Object.fromEntries(countries.map(c => [c.code, c]));
  const combos = [];
  for (const cc of q.countries) for (const gid of q.groups) if (cByCode[cc] && gById[gid]) combos.push([cByCode[cc], gById[gid]]);
  if (!combos.length) throw new Error('请至少选一个国家和一种人');

  // 指定数量时也一直换城市、换搜法，直到找满；连续几轮没新人就停（见 dryLimit）
  const tasks = planTasks(shuffle(combos), q, coverage, 24);
  const maxCalls = tasks.length;
  const dryLimit = unlimited ? Math.max(6, combos.length * 3) : Math.max(4, combos.length + 2);
  let dry = 0, failStreak = 0, added = 0;
  const comboDry = {};

  for (let i = 0; i < tasks.length && run.calls < maxCalls && added < limit; i++) {
    if (signal && signal.aborted) break;
    const { country, group, city, angle } = tasks[i];
    const ck = country.code + '|' + group.id;
    if ((comboDry[ck] || 0) >= 3) continue;            // 这个组合连续 3 轮没新人，先跳过
    const label = `${group.name} · ${city}，${country.name}`;
    run.combos.push(`${label}（${angle.zh}）`);
    const n = unlimited ? 8 : Math.min(8, Math.max(3, Math.ceil((limit - added) * 1.5)));
    log(`正在搜索：${label} · ${angle.zh}（第 ${run.calls + 1} 轮）`, 'step');
    const exclude = Array.from(byGroup[group.id] || []).slice(-150).concat(Array.from(byGroup['*'] || []).slice(-50));
    let res;
    try {
      run.calls++;
      res = await callLLM(cfg, { system: SYSTEM, user: buildPrompt({ country, group, q, n, exclude, city, angle }), search: true, maxTokens: 6000, signal });
      failStreak = 0;
      onCover && onCover(coverKey(country.code, group.id, city));
    } catch (e) {
      if (e.name === 'AbortError') break;
      run.errors.push(`${label}：${e.message}`);
      log(`${label} 失败：${e.message}`, 'error');
      if (['auth', 'billing', 'config', 'network'].includes(e.kind)) { run.status = 'failed'; break; }
      if (++failStreak >= 3) break;
      continue;
    }
    run.usage.input += res.usage.input; run.usage.output += res.usage.output; run.usage.searches += res.usage.searches;
    let list = [];
    try { const j = extractJSON(res.text); list = Array.isArray(j) ? j : (j.creators || []); }
    catch (e) { run.errors.push(`${label}：回复格式不对`); log(`${label}：AI 回复格式不对，跳过`, 'error'); continue; }
    run.candidates += list.length;
    let got = 0;
    for (const raw of list) {
      if (added >= limit) break;
      const r = normalizeCandidate(raw || {}, { country, group, q, runId, sources: res.sources });
      const uname = String((raw && raw.username) || '').replace(/^@/, '').trim();
      if (r.reject) {
        run.rejected++; run.reject_reasons[r.reject] = (run.reject_reasons[r.reject] || 0) + 1;
        if (uname) { remember(raw.platform || 'instagram', uname, group.id); onSeen && onSeen({ platform: String(raw.platform || 'instagram').toLowerCase(), username: uname.toLowerCase(), group: group.id, reason: r.reject }); }
        continue;
      }
      if (known.has(r.creator.id)) { run.duplicates++; continue; }
      remember(r.creator.platform, r.creator.username, group.id);
      added++; got++;
      onFound && onFound(r.creator, run);
    }
    comboDry[ck] = got ? 0 : (comboDry[ck] || 0) + 1;
    dry = got ? 0 : dry + 1;
    log(`${label}：看到 ${list.length} 个，新找到 ${got} 位（这次累计 ${added}${unlimited ? '' : '/' + limit}）`, got ? 'ok' : 'info');
    if (dry >= dryLimit) { log(`连续 ${dry} 轮没有新博主，这些条件下能找到的基本找完了。可以换城市、换人群，或过几天再找。`, 'info'); break; }
  }

  run.added = added;
  run.finished_at = new Date().toISOString();
  if (signal && signal.aborted) run.status = 'cancelled';
  else if (run.status !== 'failed') run.status = run.errors.length && !added ? 'failed' : run.errors.length ? 'partial' : 'ok';
  return { run };
}

// 找博主流程：按“国家 × 人群”组合逐个让大模型联网搜索 → 代码校验、去重、打分。
// 粉丝区间、去重、打分全部由代码判断，不直接相信模型的结论。
import { PLATFORMS, CATEGORIES, LIFESTYLE, CAMERA } from './config.js?v=0.4.0';
import { callLLM, extractJSON } from './llm.js?v=0.4.0';

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
1. 只返回你在搜索结果或网页里真实看到的账号，绝不编造用户名、粉丝数或简介。每个人都要在 sources 里写上你看到他的网页网址（程序会核对，核对不上的会被丢掉）。
2. 判断博主属于哪个人群，只能依据博主公开的自我介绍、内容使用的语言、内容主题、定位和标签。禁止根据长相、肤色或名字推断族裔。
3. 只要个人或家庭博主；排除品牌、店铺、机构、新闻号、搬运号、段子聚合号。
4. 必须是常住在目标国家的人，不是去旅游的。
5. 粉丝数只写你在页面上看到的数字；看不到就写 null，不要估算。
6. 是否本人出镜：根据看到的内容（vlog、自拍、口播、视频描述）判断；判断不了写 null。
7. 只输出一个 JSON 对象，不要任何解释文字。`;

// 每一轮换一种搜法，避免总搜到同一批人。前两种一次能拆出最多的人
export const ANGLES = [
  { id: 'lists', zh: '名单页', tip: (g, city, sites, ctx) => `先找“一页列出很多博主”的名单页，再把里面符合条件的人都拆出来：
   - 达人平台的国家/城市/人群目录页（Collabstr、Heepsy、Favikon、Feedspot、StarNgage、Influence.co 等），搜如“${ctx.en} influencers ${city}”“${ctx.en} instagram creators in ${ctx.country}”
   - 媒体和博客的榜单文章，如“top ${ctx.en} influencers in ${ctx.country}”“${ctx.country} 的${g.name}网红推荐”
   打开名单页，把每个人的 Instagram 用户名都核对一遍再返回。` },
  { id: 'cross', zh: '跨平台', tip: (g, city, sites, ctx) => `TikTok 和 YouTube 比 Instagram 更容易搜到：先搜 site:tiktok.com 和 site:youtube.com 上住在 ${city} 的${g.name}生活博主（用母语和英语都搜），再从他们的简介、Linktree、视频描述里找到 Instagram 用户名。只返回找到 Instagram 账号的人。` },
  { id: 'native', zh: '母语搜索', tip: (g, city, sites, ctx) => `只用这个人群的母语搜索（识别线索里有例子），自己再想 6 个以上不同说法：城市名的母语写法、“住在/在住/移民/留学/打工度假/日常/vlog”等词的母语说法、常用标签。可以加 ${sites}。` },
  { id: 'community', zh: '社区活动', tip: (g, city, sites, ctx) => `找 ${city} 的${g.name}社区：同乡会、学生会、节日活动、餐厅/超市探店、品牌合作活动、本地媒体采访、播客嘉宾，从这些页面里提到的个人博主找 Instagram 账号。` },
  { id: 'snowball', zh: '顺藤摸瓜', tip: (g, city, sites, ctx) => ctx.known.length
    ? `从这些已经确认的同类博主出发：${ctx.known.map(u => '@' + u).join('、')}。找他们合作过、互相 @、一起出镜、被他们推荐的同城${g.name}博主。`
    : `从你先找到的一两个同类博主出发，找他们合作过、互相 @、一起出镜的同城${g.name}博主。` },
  { id: 'niche', zh: '细分内容', tip: (g, city) => `按细分身份和内容各搜一遍：${city} 的${g.name}妈妈/爸爸博主、留学生、打工度假、新移民、夫妻/情侣 vlog、家常菜、探店、穿搭、美妆、健身、宠物。` },
];

// 人群的英文名，方便在英文名单页里搜
const GROUP_EN = { indonesian: 'Indonesian', indian: 'Indian', thai: 'Thai', malaysian: 'Malaysian', filipino: 'Filipino', nepali: 'Nepali', hongkong: 'Hong Kong', colombian: 'Colombian', mexican: 'Mexican', japanese: 'Japanese', chinese: 'Chinese', korean: 'Korean', vietnamese: 'Vietnamese' };
const COUNTRY_EN = { AU: 'Australia', CA: 'Canada', US: 'USA', GB: 'UK', NZ: 'New Zealand' };

function buildPrompt({ country, group, q, n, exclude, city, angle, known = [] }) {
  const hints = (group.hints || '').replace(/\{city\}/g, city);
  const ctx = { en: group.en || GROUP_EN[group.id] || group.name, country: COUNTRY_EN[country.code] || country.name, known };
  const plats = q.platforms.map(p => PLATFORMS[p].label).join('、');
  const sites = q.platforms.map(p => 'site:' + PLATFORMS[p].site).join('、');
  const cats = (q.categories || []).map(c => CATEGORIES[c]).join('、') || '不限';
  return `请找 ${n} 位符合条件的博主：
- 常住在：${country.name}（${country.code}），这次重点找：${city}（附近城市也可以）
- 人群：${group.name}
- 识别线索和搜索关键词：${hints || '无'}
- 平台：${plats}
- 粉丝数：${q.fmax == null ? `${q.fmin || 0} 以上` : `${q.fmin || 0} 到 ${q.fmax}`}（看不到粉丝数的也可以返回，followers 写 null）
- 出镜要求：${CAMERA[q.camera] || '不限'}
- 优先内容类别：${cats}

这一轮的搜法：${angle.tip(group, city, sites, ctx)}
尽量多找：这一轮目标 ${n} 位，搜不够就换搜索词继续搜，至少搜 6 次再停。
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
  if (followers != null && (followers < (q.fmin || 0) || (q.fmax != null && followers > q.fmax))) return { reject: `粉丝 ${followers} 不在区间内` };
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

/* ---------- 核对：账号必须真的出现在搜索工具返回的网页里 ---------- */
// evidence 只来自服务商的搜索工具（网址、标题、原文片段），不是 AI 自己写的话
export function seenIn(username, evidence) {
  const u = String(username || '').toLowerCase().replace(/^@/, '').trim();
  if (!u) return false;
  const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(`(^|[^a-z0-9._])@?${esc}([^a-z0-9._]|$)`);
  const loose = u.replace(/[._]/g, '');
  return (evidence || []).some(t => {
    if (!t) return false;
    const s = String(t).toLowerCase();
    if (exact.test(s)) return true;
    return loose.length >= 8 && s.replace(/[._]/g, '').includes(loose);
  });
}
const VERIFY_SYSTEM = '你在核实 Instagram 账号是否真实存在。只做核实，不要推荐新账号，不要编造。只输出一个 JSON 对象。';
const verifyPrompt = names => `逐个用网页搜索核实下面这些 Instagram 账号是否真实存在：每个都搜 "instagram.com/用户名" 或 "@用户名"，必要时打开主页。只有在搜索结果或网页里真实看到这个账号才算存在。
${names.map(u => '- ' + u).join('\n')}
输出：{"accounts":[{"username":"用户名","exists":true 或 false,"url":"你看到它的网址"}]}`;

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
export async function runSearch({ q, cfg, groups, countries, existing, seen = [], coverage = {}, onProgress, onFound, onSeen, onCover, checker, signal, trigger, presetName }) {
  const runId = 'run-' + Date.now().toString(36);
  const unlimited = !q.limit;
  const limit = unlimited ? Infinity : Math.max(1, Math.min(500, q.limit));
  const run = {
    id: runId, trigger: trigger || 'manual', preset: presetName || '自定义条件',
    started_at: new Date().toISOString(), finished_at: null, status: 'running',
    provider: cfg.provider, model: cfg.model, limit: unlimited ? 0 : limit,
    combos: [], calls: 0, candidates: 0, added: 0, duplicates: 0, rejected: 0, fake: 0,
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
  const addedList = [];
  const comboDry = {};

  for (let i = 0; i < tasks.length && run.calls < maxCalls && added < limit; i++) {
    if (signal && signal.aborted) break;
    const { country, group, city, angle } = tasks[i];
    const ck = country.code + '|' + group.id;
    if ((comboDry[ck] || 0) >= 3) continue;            // 这个组合连续 3 轮没新人，先跳过
    const label = `${group.name} · ${city}，${country.name}`;
    run.combos.push(`${label}（${angle.zh}）`);
    const n = unlimited ? 15 : Math.min(15, Math.max(5, Math.ceil((limit - added) * 2)));
    const knownHandles = existing.concat(addedList).filter(c => c.group === group.id && c.country === country.code && c.verified !== false).map(c => c.username).slice(0, 5);
    log(`正在搜索：${label} · ${angle.zh}（第 ${run.calls + 1} 轮）`, 'step');
    const exclude = Array.from(byGroup[group.id] || []).slice(-150).concat(Array.from(byGroup['*'] || []).slice(-50));
    let res;
    try {
      run.calls++;
      res = await callLLM(cfg, { system: SYSTEM, user: buildPrompt({ country, group, q, n, exclude, city, angle, known: knownHandles }), search: true, maxTokens: 8000, signal });
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
    // 1) 先用代码筛：平台、粉丝区间、人群依据、重复
    const pending = [];
    for (const raw of list) {
      const r = normalizeCandidate(raw || {}, { country, group, q, runId, sources: res.sources });
      const uname = String((raw && raw.username) || '').replace(/^@/, '').trim();
      if (r.reject) {
        run.rejected++; run.reject_reasons[r.reject] = (run.reject_reasons[r.reject] || 0) + 1;
        if (uname) { remember(raw.platform || 'instagram', uname, group.id); onSeen && onSeen({ platform: String(raw.platform || 'instagram').toLowerCase(), username: uname.toLowerCase(), group: group.id, reason: r.reject }); }
        continue;
      }
      if (known.has(r.creator.id) || pending.some(p => p.creator.id === r.creator.id)) { run.duplicates++; continue; }
      pending.push({ creator: r.creator, raw });
    }
    // 2) 核对真假：账号必须出现在搜索工具返回的网页里；对不上的再专门核实一次
    const ok = [], unsure = [];
    for (const p of pending) (seenIn(p.creator.username, res.evidence) ? ok : unsure).push(p);
    if (unsure.length && !(signal && signal.aborted)) {
      log(`${label}：核对 ${unsure.length} 个没在来源里直接看到的账号…`, 'info');
      try {
        let confirmed = new Set();
        if (checker) {
          confirmed = await checker(unsure.map(p => ({ username: p.creator.username, urls: [p.creator.profile_url].concat(p.creator.sources || []).slice(0, 5) })), signal);
        } else {
          run.calls++;
          const v = await callLLM(cfg, { system: VERIFY_SYSTEM, user: verifyPrompt(unsure.map(p => p.creator.username)), search: true, maxTokens: 3000, signal });
          run.usage.input += v.usage.input; run.usage.output += v.usage.output; run.usage.searches += v.usage.searches;
          let said = [];
          try { const j = extractJSON(v.text); said = j.accounts || []; } catch (e) {}
          for (const a of said) if (a && a.exists === true && seenIn(a.username, v.evidence)) confirmed.add(String(a.username).toLowerCase().replace(/^@/, ''));
        }
        for (const p of unsure) {
          if (confirmed.has(p.creator.username.toLowerCase())) ok.push(p);
          else {
            run.fake++;
            remember(p.creator.platform, p.creator.username, group.id);
            onSeen && onSeen({ platform: p.creator.platform, username: p.creator.username.toLowerCase(), group: group.id, reason: '查不到这个账号' });
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') break;
        run.errors.push(`${label}：核对失败（${e.message}）`);
        run.fake += unsure.length;   // 核对不了就不收，宁缺毋滥
      }
    }
    // 3) 收录
    let got = 0;
    for (const p of ok) {
      if (added >= limit) break;
      p.creator.verified = true;
      remember(p.creator.platform, p.creator.username, group.id);
      added++; got++; addedList.push(p.creator);
      onFound && onFound(p.creator, run);
    }
    comboDry[ck] = got ? 0 : (comboDry[ck] || 0) + 1;
    dry = got ? 0 : dry + 1;
    const fakeNow = pending.length - ok.length;
    log(`${label}：看到 ${list.length} 个，新找到 ${got} 位${fakeNow > 0 ? `，丢掉 ${fakeNow} 个查不到的账号` : ''}（这次累计 ${added}${unlimited ? '' : '/' + limit}）`, got ? 'ok' : 'info');
    if (dry >= dryLimit) { log(`连续 ${dry} 轮没有新博主，这些条件下能找到的基本找完了。可以换城市、换人群，或过几天再找。`, 'info'); break; }
  }

  run.added = added;
  run.finished_at = new Date().toISOString();
  if (signal && signal.aborted) run.status = 'cancelled';
  else if (run.status !== 'failed') run.status = run.errors.length && !added ? 'failed' : run.errors.length ? 'partial' : 'ok';
  return { run };
}

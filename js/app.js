import { VERSION, REPO_URL, PLATFORMS, CATEGORIES, LIFESTYLE, STATUSES, CAMERA, PROVIDERS, DEFAULT_GROUPS, DEFAULT_COUNTRIES } from './config.js';
import { store } from './store.js';
import { checkConfig, testLLM, detectProxy } from './llm.js';
import { runSearch, keyOf } from './search.js';

/* ================= 工具 ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pad = n => String(n).padStart(2, '0');
const dayKey = d => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const dayIndex = d => { d = new Date(d); return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5); };
const ageDays = d => dayIndex(new Date()) - dayIndex(d);
const fmtNum = n => n == null ? '—' : n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w' : Number(n).toLocaleString('zh-CN');
const fmtDate = d => { d = new Date(d); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
const fmtTime = d => { d = new Date(d); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const STATUS_ZH = Object.fromEntries(STATUSES.map(s => [s.key, s.zh]));
const clone = v => JSON.parse(JSON.stringify(v));
function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function setMsg(id, text, kind) { const el = $('#' + id); el.textContent = text; el.className = 'form-msg' + (kind ? ' ' + kind : ''); }

const ICON = {
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".9" fill="currentColor" stroke="none"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.6 2.3 4.4 5 4.6"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10.2 9.3v5.4l4.6-2.7z" fill="currentColor"/></svg>',
};

/* ================= 状态 ================= */
let creators = store.creators();
let runs = store.runs();
let settings = store.settings();
let secrets = store.secrets();
let presets = store.presets();
let groups = store.groups();
let countries = store.countries();
let Q = null;               // 当前搜索条件
let dirty = false;
let controller = null;      // 正在运行的搜索
let lastAddedIds = new Set();
const F = { scope: 'all', platform: 'all', group: 'all', country: 'all', cat: 'all', status: 'active', onCam: false, sort: 'priority', q: '' };
let currentView = 'discover';
let openId = null;

const groupName = id => (groups.find(g => g.id === id) || {}).name || id || '未识别';
const countryName = code => (countries.find(c => c.code === code) || {}).name || code || '';

function llmConfig() {
  const p = PROVIDERS[settings.provider] || PROVIDERS.deepseek;
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl || p.base,
    model: settings.model || p.model,
    apiKey: secrets.apiKey || '',
    tavilyKey: secrets.tavilyKey || '',
    proxy: settings.proxy || '',
  };
}
function persistCreators() { if (!store.saveCreators(creators)) toast('浏览器存储空间不足，请先导出备份'); }

/* ================= 搜索面板 ================= */
function presetById(id) { return presets.find(p => p.id === id); }
function loadPreset(id) {
  const p = presetById(id) || presets[0];
  Q = clone(p || { countries: [], groups: [], platforms: ['instagram'], fmin: 10000, fmax: 100000, camera: 'prefer', categories: [], limit: 10, city: '' });
  settings.activePresetId = p ? p.id : '';
  store.saveSettings(settings);
  dirty = false;
  renderFinder();
}
function chip(group, val, label, on, title) {
  return `<button type="button" class="fchip" data-chip="${group}" data-val="${esc(val)}" aria-pressed="${on}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
}
function renderFinder() {
  $('#presetSel').innerHTML = presets.map(p => `<option value="${esc(p.id)}"${p.id === settings.activePresetId ? ' selected' : ''}>${esc(p.name)}</option>`).join('') + (dirty || !presets.length ? '' : '');
  $('#autoPreset').innerHTML = presets.map(p => `<option value="${esc(p.id)}"${p.id === settings.auto.presetId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#presetDirty').hidden = !dirty;
  $('#chipCountries').innerHTML = countries.map(c => chip('countries', c.code, c.name, Q.countries.includes(c.code), c.cities.join(', '))).join('');
  $('#chipGroups').innerHTML = groups.map(g => chip('groups', g.id, g.name, Q.groups.includes(g.id), g.hints)).join('') + `<button type="button" class="fchip add" data-nav="settings" title="在设置里添加或修改人群">＋ 编辑</button>`;
  $('#chipPlatforms').innerHTML = Object.entries(PLATFORMS).map(([k, p]) => chip('platforms', k, p.label, Q.platforms.includes(k))).join('');
  $('#chipCamera').innerHTML = Object.entries(CAMERA).map(([k, v]) => chip('camera', k, v, Q.camera === k)).join('');
  $('#chipCats').innerHTML = Object.entries(CATEGORIES).map(([k, v]) => chip('categories', k, v, (Q.categories || []).includes(k))).join('');
  $('#qFmin').value = Q.fmin; $('#qFmax').value = Q.fmax; $('#qCity').value = Q.city || ''; $('#qLimit').value = Q.limit;
  $('#autoOn').checked = !!settings.auto.enabled;
  updateComboHint();
}
function updateComboHint() {
  const n = Q.countries.length * Q.groups.length;
  const err = checkConfig(llmConfig());
  $('#comboHint').textContent = !n ? '请至少选一个国家和一个人群' :
    `共 ${n} 种“国家 × 人群”组合，每次随机搜几组，最多找 ${Q.limit} 位。` + (err ? ` ${err}。` : '');
  $('#btnSearch').disabled = !!controller;
}
function markDirty() { dirty = true; $('#presetDirty').hidden = false; updateComboHint(); }
function readInputs() {
  const n = (id, d) => { const v = parseInt($(id).value, 10); return isFinite(v) && v >= 0 ? v : d; };
  Q.fmin = n('#qFmin', 10000); Q.fmax = n('#qFmax', 100000);
  if (Q.fmax < Q.fmin) [Q.fmin, Q.fmax] = [Q.fmax, Q.fmin];
  Q.city = $('#qCity').value.trim();
  Q.limit = Math.max(1, Math.min(50, n('#qLimit', 10)));
}

/* ================= 运行搜索 ================= */
async function doSearch(trigger, presetOverride) {
  if (controller) { toast('已经在搜索了'); return; }
  const cfg = llmConfig();
  const err = checkConfig(cfg);
  if (err) { toast(err); if (trigger === 'manual') go('settings'); return; }
  let q, presetName;
  if (presetOverride) { q = clone(presetOverride); presetName = presetOverride.name + '（自动）'; }
  else { readInputs(); q = clone(Q); const p = presetById(settings.activePresetId); presetName = p && !dirty ? p.name : '自定义条件'; }
  if (!q.countries.length || !q.groups.length) { toast('请至少选一个国家和一个人群'); return; }
  if (!q.platforms.length) { toast('请至少选一个平台'); return; }

  controller = new AbortController();
  const started = Date.now();
  $('#progress').hidden = false;
  $('#progress').classList.remove('done');
  $('#btnCancel').textContent = '取消';
  $('#progLog').innerHTML = '';
  $('#progTitle').textContent = trigger === 'auto' ? '自动查找中…' : '正在搜索…';
  $('#btnSearch').disabled = true;
  $('#btnSearch').classList.add('busy');
  const tick = setInterval(() => { const s = Math.round((Date.now() - started) / 1000); $('#progMeta').textContent = `已用时 ${Math.floor(s / 60)}:${pad(s % 60)} · AI 联网搜索每组通常需要 20～90 秒`; }, 1000);

  let result;
  try {
    result = await runSearch({
      q, cfg, groups, countries, existing: creators, signal: controller.signal, trigger, presetName,
      onProgress: ({ text, kind }) => {
        $('#progLog').insertAdjacentHTML('beforeend', `<li class="${kind || ''}">${esc(text)}</li>`);
        if (kind === 'step') $('#progTitle').textContent = text;
      },
    });
  } catch (e) {
    toast(e.message);
    result = null;
  }
  clearInterval(tick);
  controller = null;
  $('#btnSearch').disabled = false;
  $('#btnSearch').classList.remove('busy');
  if (!result) { $('#progress').hidden = true; updateComboHint(); return; }

  const { run, added } = result;
  creators = added.concat(creators);
  persistCreators();
  runs.unshift(run); store.saveRuns(runs);
  lastAddedIds = new Set(added.map(c => c.id));
  const statusTxt = { ok: '完成', partial: '部分完成', failed: '失败', cancelled: '已取消' }[run.status] || run.status;
  $('#progTitle').textContent = `${statusTxt}：新找到 ${added.length} 位博主` + (run.duplicates ? `，跳过 ${run.duplicates} 位已有的` : '');
  $('#progLog').insertAdjacentHTML('beforeend', `<li class="${added.length ? 'ok' : 'info'}">${esc(summaryLine(run))}</li>`);
  $('#progress').classList.add('done');
  $('#btnCancel').textContent = '收起';
  if (added.length) { F.scope = 'today'; F.group = 'all'; }
  render();
  toast(`${statusTxt}，新找到 ${added.length} 位`);
}
function summaryLine(run) {
  const rs = Object.entries(run.reject_reasons || {}).map(([k, v]) => `${k} ${v}`).join('，');
  return `看了 ${run.candidates} 个候选，留下 ${run.added}，重复 ${run.duplicates}，不合格 ${run.rejected}${rs ? `（${rs}）` : ''}。联网搜索 ${run.usage.searches} 次。`;
}

/* ================= 自动查找 ================= */
function autoStatusText() {
  const a = settings.auto;
  if (!a.enabled) return '每天第一次打开这个网页时，自动按所选模板找一轮。网页关着时不会运行。';
  const today = dayKey(new Date());
  const last = runs.find(r => r.trigger === 'auto');
  if (a.lastDate === today) return `今天已经自动找过了${last && dayKey(last.started_at) === today ? `（新找到 ${last.added} 位）` : ''}，明天打开网页会再找。`;
  return '已开启：今天还没找，打开网页后会自动开始。';
}
function maybeAutoRun() {
  const a = settings.auto;
  $('#autoDesc').textContent = autoStatusText();
  if (!a.enabled) return;
  const today = dayKey(new Date());
  if (a.lastDate === today) return;
  const p = presetById(a.presetId) || presets[0];
  if (!p) return;
  if (checkConfig(llmConfig())) { banner('自动查找已开启，但还没连接大模型。', '去设置', 'settings'); return; }
  a.lastDate = today; store.saveSettings(settings);
  $('#autoDesc').textContent = '今天的自动查找正在进行…';
  setTimeout(() => doSearch('auto', p).then(() => { $('#autoDesc').textContent = autoStatusText(); }), 1200);
}

/* ================= 发现页：列表 ================= */
function filtered() {
  const q = F.q.trim().toLowerCase();
  return creators.filter(c => {
    const age = ageDays(c.found_at);
    if (F.scope === 'today' && age !== 0) return false;
    if (F.scope === '7d' && age > 6) return false;
    if (F.platform !== 'all' && c.platform !== F.platform && !(c.linked_accounts || []).some(a => a.platform === F.platform)) return false;
    if (F.group !== 'all' && c.group !== F.group) return false;
    if (F.country !== 'all' && c.country !== F.country) return false;
    const life = LIFESTYLE.includes(c.category);
    if (F.cat === 'life' && !life) return false;
    if (F.cat === 'other' && life) return false;
    if (F.onCam && c.on_camera !== true) return false;
    if (F.status === 'active' && c.status === 'dropped') return false;
    if (F.status !== 'active' && F.status !== 'all' && c.status !== F.status) return false;
    if (q && !`${c.username} ${c.display_name} ${c.bio || ''} ${c.city || ''}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => {
    if (F.sort === 'followers') return (b.followers || 0) - (a.followers || 0);
    if (F.sort === 'newest') return new Date(b.found_at) - new Date(a.found_at);
    return b.priority_score - a.priority_score;
  });
}
function avatarHTML(c, ring, size) {
  const initial = esc(String(c.display_name || c.username).trim().charAt(0).toUpperCase() || '?');
  return `<span class="av${ring ? ' ring' : ''}" style="--s:${size}px"><span class="av-in" style="--h:${hash(c.id) % 360}">${initial}</span></span>`;
}
function statusSelect(c) {
  return `<select class="st st-${c.status}" data-status="${esc(c.id)}" aria-label="${esc(c.username)} 的跟进状态">${STATUSES.map(s => `<option value="${s.key}"${s.key === c.status ? ' selected' : ''}>${s.zh}</option>`).join('')}</select>`;
}
function camText(c) { return c.on_camera === true ? '出镜' : c.on_camera === false ? '不出镜' : '未知'; }
function chipsHTML(c) {
  const out = [];
  if (c.priority_score >= 80) out.push('<span class="chip top">优先联系</span>');
  out.push(`<span class="chip">${esc(groupName(c.group))} · ${esc(countryName(c.country))} · ${Math.round((c.group_confidence || 0) * 100)}%</span>`);
  out.push(`<span class="chip${LIFESTYLE.includes(c.category) ? ' life' : ''}">${esc(CATEGORIES[c.category] || '其他')}</span>`);
  out.push(c.on_camera === true ? '<span class="chip cam">真人出镜</span>' : c.on_camera === false ? '<span class="chip low">不出镜</span>' : '<span class="chip low">出镜未知</span>');
  if (!c.followers_verified) out.push('<span class="chip warn">粉丝未核实</span>');
  return out.join('');
}
function cardHTML(c) {
  const id = esc(c.id);
  const isNew = lastAddedIds.has(c.id) || ageDays(c.found_at) === 0;
  return `<article class="card${lastAddedIds.has(c.id) ? ' fresh' : ''}">
    <header class="card-h">
      ${avatarHTML(c, isNew, 44)}
      <div class="who"><button type="button" class="handle" data-open="${id}">${esc(c.username)}</button>
        <div class="sub">${esc(c.display_name)}${c.city ? ' · ' + esc(c.city) : ''}，${esc(countryName(c.country))}</div></div>
      <div class="plats"><span title="${PLATFORMS[c.platform] ? PLATFORMS[c.platform].label : ''}">${ICON[c.platform] || ''}</span></div>
    </header>
    <div class="stats">
      <div><b>${c.followers_verified ? fmtNum(c.followers) : '?'}</b><span>粉丝</span></div>
      <div><b>${Math.round((c.group_confidence || 0) * 100)}%</b><span>人群匹配</span></div>
      <div><b>${camText(c)}</b><span>本人出镜</span></div>
      <div><b>${c.priority_score}</b><span>优先分</span></div>
    </div>
    <div class="chips">${chipsHTML(c)}</div>
    <p class="bio">${esc(c.bio || '（没有简介）')}</p>
    ${c.group_evidence && c.group_evidence[0] ? `<p class="evi">依据：${esc(c.group_evidence[0])}</p>` : ''}
    <footer class="card-f">
      ${statusSelect(c)}
      <button type="button" class="ghost" data-open="${id}">${c.notes ? '详情 · 有备注' : '详情'}</button>
      <a class="ghost" href="${esc(c.profile_url)}" target="_blank" rel="noopener">打开主页 ↗</a>
    </footer>
  </article>`;
}
function renderDiscover() {
  const now = new Date();
  const todayList = creators.filter(c => ageDays(c.found_at) === 0);
  $('#dSub').textContent = `${fmtDate(now)} ${WEEK[now.getDay()]} · 已收集 ${creators.length} 位博主` + (runs[0] ? ` · 上次查找 ${fmtDate(runs[0].started_at)} ${fmtTime(runs[0].started_at)}` : '');
  $$('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === F.scope)));
  const lifeCam = todayList.filter(c => c.on_camera === true && LIFESTYLE.includes(c.category)).length;
  $('#kpis').innerHTML = [[todayList.length, '今天新找到'], [lifeCam, '今天出镜生活类'], [creators.filter(c => ageDays(c.found_at) <= 6).length, '近 7 天'], [creators.filter(c => c.status === 'new').length, '待看']]
    .map(([n, l]) => `<div class="kpi"><b>${n}</b><span>${l}</span></div>`).join('');

  const used = groups.filter(g => creators.some(c => c.group === g.id));
  $('#stories').innerHTML = !creators.length ? '' :
    `<button type="button" class="story${F.group === 'all' ? ' on' : ''}${todayList.length ? ' has' : ''}" data-group="all"><span class="sring"><span class="sin" style="background:var(--ink);color:var(--bg)">全部</span></span><span class="st-l">全部人群</span><span class="st-n">共 ${creators.length}</span></button>` +
    used.map(g => {
      const n = todayList.filter(c => c.group === g.id).length;
      const total = creators.filter(c => c.group === g.id).length;
      return `<button type="button" class="story${F.group === g.id ? ' on' : ''}${n ? ' has' : ''}" data-group="${esc(g.id)}"><span class="sring"><span class="sin" style="--h:${hash(g.id) % 360}">${esc(g.code || g.name.slice(0, 2))}</span></span><span class="st-l">${esc(g.name)}</span><span class="st-n">${n ? '今天 +' + n : '共 ' + total}</span></button>`;
    }).join('');

  const list = filtered();
  const scopeName = { today: '今天', '7d': '近 7 天', all: '全部' }[F.scope];
  $('#resultN').textContent = creators.length ? `${scopeName} · ${list.length} 位博主` + (F.group !== 'all' ? ` · ${groupName(F.group)}` : '') : '';
  $('#grid').innerHTML = list.length ? list.map(cardHTML).join('') :
    creators.length
      ? `<div class="empty" style="grid-column:1/-1"><b>没有符合筛选条件的博主</b>换个时间范围或放宽筛选试试。</div>`
      : `<div class="empty" style="grid-column:1/-1"><b>还没有博主</b>${checkConfig(llmConfig()) ? '第一步：去「设置」填上你的大模型 key。第二步：回来选好条件，点「搜索」。' : '选好上面的条件，点「搜索」开始。'}</div>`;
}

/* ================= 跟进看板 ================= */
function renderPipeline() {
  $('#pipe').innerHTML = STATUSES.map(s => {
    const items = creators.filter(c => c.status === s.key).sort((a, b) => b.priority_score - a.priority_score);
    return `<section class="col" aria-label="${s.zh}"><h3 class="st-${s.key}"><i class="sd"></i><span style="color:var(--ink)">${s.zh}</span><span class="n">${items.length}</span></h3>${
      items.map(c => `<div class="row">${avatarHTML(c, false, 32)}<div style="min-width:0"><button type="button" class="handle" data-open="${esc(c.id)}">${esc(c.username)}</button><div class="sub">${esc(groupName(c.group))} · ${esc(c.city || countryName(c.country))} · ${c.followers_verified ? fmtNum(c.followers) : '?'}</div></div>${statusSelect(c)}${c.notes ? `<div class="note" title="${esc(c.notes)}">${esc(c.notes)}</div>` : ''}</div>`).join('')
      || '<p class="empty-s">暂无</p>'}</section>`;
  }).join('');
}

/* ================= 查找记录 ================= */
function renderHistory() {
  const recent = runs.filter(r => ageDays(r.started_at) <= 13);
  const added = recent.reduce((s, r) => s + (r.added || 0), 0);
  const searches = recent.reduce((s, r) => s + ((r.usage && r.usage.searches) || 0), 0);
  $('#hisKpis').innerHTML = [[recent.length, '近 14 天查找次数'], [added, '近 14 天新增'], [recent.filter(r => r.trigger === 'auto').length, '其中自动查找'], [searches, '联网搜索次数']]
    .map(([n, l]) => `<div class="kpi"><b>${n}</b><span>${l}</span></div>`).join('');

  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 13 + i); return dayKey(d); });
  const vals = days.map(k => creators.filter(c => dayKey(c.found_at) === k).length);
  const W = 640, H = 210, P = { l: 30, r: 8, t: 24, b: 30 };
  const top = Math.max(4, Math.ceil(Math.max(...vals) / 2) * 2);
  const bw = (W - P.l - P.r) / days.length;
  const y = v => H - P.b - (v / top) * (H - P.t - P.b);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 14 天每天新增博主数">`;
  [0, top / 2, top].forEach(v => { svg += `<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`; });
  days.forEach((k, i) => {
    const v = vals[i], x = P.l + i * bw + bw * .2, w = bw * .6, isToday = i === days.length - 1;
    svg += `<rect class="bar${isToday ? ' now' : ''}" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - P.b - y(v)).toFixed(1)}" rx="3"/>`;
    if (v) svg += `<text class="val" x="${(x + w / 2).toFixed(1)}" y="${(y(v) - 6).toFixed(1)}">${v}</text>`;
    const d = new Date(k + 'T12:00:00');
    if (i % 2 === 1 || isToday) svg += `<text class="ax" x="${(x + w / 2).toFixed(1)}" y="${H - P.b + 16}" text-anchor="middle">${isToday ? '今天' : (d.getMonth() + 1) + '/' + d.getDate()}</text>`;
  });
  $('#chart').innerHTML = svg + '</svg>';

  const rows = groups.map(g => ({ g, n: creators.filter(c => c.group === g.id).length })).filter(r => r.n).sort((a, b) => b.n - a.n);
  const maxN = Math.max(1, ...rows.map(r => r.n));
  $('#hbars').innerHTML = rows.length ? rows.map(r => `<div class="hb"><span>${esc(r.g.name)}</span><div class="track"><span class="seg1" style="width:${r.n / maxN * 100}%"></span></div><span class="num" style="text-align:right">${r.n} 位</span></div>`).join('') : '<p class="muted">还没有数据。</p>';

  const stTxt = { ok: '完成', partial: '部分完成', failed: '失败', cancelled: '已取消', running: '进行中' };
  $('#runTable').innerHTML = runs.length ? `<tr><th>时间</th><th>方式</th><th>状态</th><th>条件</th><th class="r">候选</th><th class="r">新增</th><th class="r">重复</th><th class="r">用时</th><th>模型</th><th>问题</th></tr>` + runs.slice(0, 100).map(r => {
    const mins = r.finished_at ? Math.max(1, Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 60000)) : null;
    const pill = r.status === 'ok' ? 'ok' : r.status === 'partial' || r.status === 'cancelled' ? 'partial' : 'failed';
    return `<tr><td>${fmtDate(r.started_at)} ${fmtTime(r.started_at)}</td><td>${r.trigger === 'auto' ? '自动' : '手动'}</td><td><span class="pill ${pill}">${stTxt[r.status] || r.status}</span></td><td title="${esc((r.combos || []).join('，'))}">${esc(r.preset)}</td><td class="r">${r.candidates}</td><td class="r"><b>${r.added}</b></td><td class="r">${r.duplicates}</td><td class="r">${mins != null ? mins + ' 分' : '—'}</td><td class="muted">${esc(r.model || '')}</td><td class="muted wrap-cell">${esc((r.errors || []).join('；'))}</td></tr>`;
  }).join('') : '<tr><td class="muted">还没有查找记录。</td></tr>';
}

/* ================= 设置 ================= */
function renderSettings() {
  const p = PROVIDERS[settings.provider] || PROVIDERS.deepseek;
  $('#sProvider').innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}"${k === settings.provider ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  fillProviderFields(settings.provider, false);
  $('#sKey').value = secrets.apiKey || '';
  $('#sTavily').value = secrets.tavilyKey || '';
  $('#sRemember').checked = settings.rememberKey !== false;
  $('#sProxy').value = settings.proxy || '';
  if (!p) return;
  renderGroupTbl(); renderCountryTbl();
}
function fillProviderFields(provider, reset) {
  const p = PROVIDERS[provider];
  $('#sProviderNote').textContent = p.note;
  $('#sModel').placeholder = p.model || '填服务商文档里的模型名';
  $('#sBase').placeholder = p.base || 'https://…/v1';
  $('#sModel').value = reset ? p.model : (settings.provider === provider ? settings.model || p.model : p.model);
  $('#sBase').value = reset ? p.base : (settings.provider === provider ? settings.baseUrl || p.base : p.base);
  $('#sTavilyWrap').hidden = p.search !== 'tavily';
  const link = $('#sKeyLink');
  link.hidden = !p.keyUrl; link.href = p.keyUrl || '#';
}
function readModelForm() {
  const provider = $('#sProvider').value;
  const p = PROVIDERS[provider];
  const s = Object.assign({}, settings, {
    provider,
    model: $('#sModel').value.trim() === p.model ? '' : $('#sModel').value.trim(),
    baseUrl: $('#sBase').value.trim().replace(/\/+$/, '') === p.base ? '' : $('#sBase').value.trim().replace(/\/+$/, ''),
    proxy: $('#sProxy').value.trim(),
    rememberKey: $('#sRemember').checked,
  });
  const sec = { apiKey: $('#sKey').value.trim(), tavilyKey: $('#sTavily').value.trim() };
  return { s, sec };
}
function renderGroupTbl() {
  $('#groupTbl').innerHTML = `<tr><th>名称</th><th>简称</th><th>识别线索 / 搜索词</th><th></th></tr>` + groups.map((g, i) => `<tr>
    <td><input data-g="${i}" data-f="name" value="${esc(g.name)}" aria-label="人群名称"></td>
    <td><input data-g="${i}" data-f="code" value="${esc(g.code || '')}" maxlength="3" class="w-s" aria-label="简称"></td>
    <td><input data-g="${i}" data-f="hints" value="${esc(g.hints || '')}" class="w-l" aria-label="识别线索"></td>
    <td><button type="button" class="ghost" data-delgroup="${i}" aria-label="删除 ${esc(g.name)}">删除</button></td></tr>`).join('');
}
function renderCountryTbl() {
  $('#countryTbl').innerHTML = `<tr><th>代码</th><th>名称</th><th>城市</th><th></th></tr>` + countries.map((c, i) => `<tr>
    <td><input data-c="${i}" data-f="code" value="${esc(c.code)}" maxlength="3" class="w-s" aria-label="国家代码"></td>
    <td><input data-c="${i}" data-f="name" value="${esc(c.name)}" aria-label="国家名称"></td>
    <td><input data-c="${i}" data-f="cities" value="${esc(c.cities.join(', '))}" class="w-l" aria-label="城市"></td>
    <td><button type="button" class="ghost" data-delcountry="${i}" aria-label="删除 ${esc(c.name)}">删除</button></td></tr>`).join('');
}

/* ================= 详情弹窗 ================= */
function openModal(id) {
  const c = creators.find(x => x.id === id); if (!c) return;
  openId = id;
  $('#mBox').className = 'm-box small';
  $('#mBody').innerHTML = `<div class="m-side solo">
    <div class="m-head">${avatarHTML(c, false, 56)}<div style="min-width:0"><h2>${esc(c.username)}</h2><div class="sub">${esc(c.display_name)}${c.city ? ' · ' + esc(c.city) : ''}，${esc(countryName(c.country))} · ${PLATFORMS[c.platform] ? PLATFORMS[c.platform].label : ''}</div></div></div>
    <div class="stats" style="padding:0">
      <div><b>${c.followers_verified ? fmtNum(c.followers) : '?'}</b><span>粉丝${c.followers_verified ? '' : '（未核实）'}</span></div>
      <div><b>${Math.round((c.group_confidence || 0) * 100)}%</b><span>人群匹配</span></div>
      <div><b>${camText(c)}</b><span>本人出镜</span></div>
      <div><b>${c.priority_score}</b><span>优先分</span></div>
    </div>
    <p style="margin:0;font-size:13px;white-space:pre-line">${esc(c.bio || '（没有简介）')}</p>
    <div class="chips" style="padding:0">${chipsHTML(c)}</div>
    <div class="m-sec"><h3>为什么判断是${esc(groupName(c.group))}</h3>${(c.group_evidence || []).length ? `<ul class="ev">${c.group_evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '<p class="muted">AI 没有给出依据。</p>'}</div>
    <div class="m-sec"><h3>出镜判断</h3><p>${esc(camText(c))}${c.on_camera_basis ? '：' + esc(c.on_camera_basis) : ''}</p></div>
    ${!c.followers_verified ? '<p class="muted small">AI 没在页面上看到确切的粉丝数，请打开主页确认。</p>' : ''}
    <div class="m-sec"><h3>链接</h3><div class="acc">
      <a href="${esc(c.profile_url)}" target="_blank" rel="noopener">${ICON[c.platform] || ''}<span>打开主页</span><span>${esc(c.username)}</span></a>
      ${(c.sources || []).filter(u => u !== c.profile_url).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><span>来源</span><span class="src-url">${esc(u.replace(/^https?:\/\//, '').slice(0, 60))}</span></a>`).join('')}
    </div>${c.contact_email ? `<p style="margin-top:8px;font-size:13px">公开邮箱：<span style="user-select:all">${esc(c.contact_email)}</span></p>` : ''}</div>
    <div class="m-sec"><h3>跟进状态</h3><div class="st-seg">${STATUSES.map(s => `<button type="button" class="st-${s.key}" data-setstatus="${s.key}" aria-pressed="${s.key === c.status}"><span>${s.zh}</span></button>`).join('')}</div></div>
    <div class="m-sec"><h3><label for="mNotes">备注（自动保存）</label></h3><textarea id="mNotes" placeholder="报价、联系渠道、对方回复……">${esc(c.notes || '')}</textarea></div>
    <div class="m-foot"><p class="meta">${fmtDate(c.found_at)} ${fmtTime(c.found_at)} 发现${c.last_post ? ' · 最近发布：' + esc(c.last_post) : ''}${(c.languages || []).length ? ' · 语言 ' + esc(c.languages.join(', ')) : ''}</p>
    <button type="button" class="ghost danger" data-delcreator="${esc(c.id)}">删除这位博主</button></div>
  </div>`;
  showModal();
}
function showModal() { $('#modal').hidden = false; document.body.style.overflow = 'hidden'; setTimeout(() => { const x = $('.m-x'); x && x.focus(); }, 0); }
function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; openId = null; }

/* ================= 导出 ================= */
function csvOf(list) {
  const cols = [
    ['平台', 'platform'], ['用户名', 'username'], ['显示名', 'display_name'], ['主页', 'profile_url'], ['粉丝', c => c.followers_verified ? c.followers : ''],
    ['国家', c => countryName(c.country)], ['城市', 'city'], ['人群', c => groupName(c.group)], ['人群匹配度', 'group_confidence'],
    ['本人出镜', camText], ['类别', c => CATEGORIES[c.category]], ['优先分', 'priority_score'], ['状态', c => STATUS_ZH[c.status]],
    ['备注', 'notes'], ['公开邮箱', 'contact_email'], ['判断依据', c => (c.group_evidence || []).join(' / ')], ['发现时间', c => dayKey(c.found_at)],
  ];
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.map(c => c[0]).join(',')].concat(list.map(c => cols.map(([, f]) => q(typeof f === 'function' ? f(c) : c[f])).join(','))).join('\n');
}
function download(name, text, type) {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([type === 'text/csv' ? '﻿' + text : text], { type: type + ';charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  } catch (e) { return false; }
}
function openTextDialog(title, desc, text, filename, type) {
  $('#mBox').className = 'm-box small';
  $('#mBody').innerHTML = `<div class="csv-box"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(desc)}</p>
    <textarea id="dlgText" readonly aria-label="内容">${esc(text)}</textarea>
    <div class="actions"><button type="button" class="btn" id="dlgDl">下载文件</button><button type="button" class="btn sec" id="dlgCopy">复制</button></div></div>`;
  $('#dlgDl').onclick = () => { if (!download(filename, text, type)) toast('浏览器拦住了下载，请用“复制”'); };
  $('#dlgCopy').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('已复制'); } catch (e) { $('#dlgText').select(); toast('请按 Ctrl/⌘+C 复制'); } };
  showModal();
}

/* ================= 写回 ================= */
function patchCreator(id, patch) {
  const c = creators.find(x => x.id === id); if (!c) return;
  Object.assign(c, patch, { updated_at: new Date().toISOString() });
  persistCreators();
}

/* ================= 渲染与路由 ================= */
const VIEWS = ['discover', 'pipeline', 'history', 'settings'];
function banner(text, btn, nav) {
  $('#bannerSlot').innerHTML = text ? `<div class="banner">${esc(text)}${btn ? `<button type="button" data-nav="${nav}">${esc(btn)}</button>` : ''}</div>` : '';
}
function renderChrome() {
  const today = creators.filter(c => ageDays(c.found_at) === 0 && c.status === 'new').length;
  const b1 = $('#badgeToday'); b1.hidden = !today; b1.textContent = today;
  const pend = creators.filter(c => c.status === 'contacted').length;
  const b2 = $('#badgePending'); b2.hidden = !pend; b2.textContent = pend; b2.title = '已联系、等回复';
  const err = checkConfig(llmConfig());
  $('#badgeSetup').hidden = !err;
  $('#modelPill').className = 'src-pill' + (err ? ' mock' : '');
  $('#modelLabel').textContent = err ? '未连接模型' : `${PROVIDERS[settings.provider].label} · ${llmConfig().model}`;
  if (err && !creators.length && currentView === 'discover') banner('欢迎使用 Scout。先在设置里填上你自己的大模型 key（推荐 DeepSeek），就可以开始找博主。', '去设置', 'settings');
  else if (!err && $('#bannerSlot').textContent.includes('欢迎使用')) banner('');
}
function render() {
  VIEWS.forEach(v => {
    $('#view-' + v).hidden = v !== currentView;
    const n = $('#nav-' + v); if (v === currentView) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  if (currentView === 'discover') { renderDiscover(); updateComboHint(); }
  if (currentView === 'pipeline') renderPipeline();
  if (currentView === 'history') renderHistory();
  if (currentView === 'settings') renderSettings();
  renderChrome();
}
function route() { const h = (location.hash || '').replace('#', ''); currentView = VIEWS.includes(h) ? h : 'discover'; render(); }
function go(v) { if (location.hash !== '#' + v) { try { location.hash = v; } catch (e) { currentView = v; render(); } } else { currentView = v; render(); } window.scrollTo(0, 0); }

/* ================= 事件 ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-nav], [data-open], [data-close]');
  if (!t) return;
  const d = t.dataset;
  if (d.nav) { go(d.nav); return; }
  if (d.chip) {
    const k = d.chip, v = d.val;
    if (k === 'camera') Q.camera = v;
    else { const arr = Q[k] || (Q[k] = []); const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
    $$(`[data-chip="${k}"]`).forEach(b => b.setAttribute('aria-pressed', String(k === 'camera' ? b.dataset.val === Q.camera : Q[k].includes(b.dataset.val))));
    markDirty(); return;
  }
  if (d.scope) { F.scope = d.scope; renderDiscover(); return; }
  if (d.group) { F.group = (F.group === d.group && d.group !== 'all') ? 'all' : d.group; renderDiscover(); return; }
  if (d.open) { openModal(d.open); return; }
  if (t.hasAttribute('data-close')) { closeModal(); return; }
  if (d.setstatus && openId) {
    patchCreator(openId, { status: d.setstatus });
    $$('[data-setstatus]').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
    render(); toast('已改为「' + STATUS_ZH[d.setstatus] + '」'); return;
  }
  if (d.delcreator) {
    if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = '再点一次确认删除'; return; }
    creators = creators.filter(c => c.id !== d.delcreator); persistCreators(); closeModal(); render(); toast('已删除'); return;
  }
  if (d.delgroup != null) { groups.splice(+d.delgroup, 1); store.saveGroups(groups); renderGroupTbl(); renderFinder(); return; }
  if (d.delcountry != null) { countries.splice(+d.delcountry, 1); store.saveCountries(countries); renderCountryTbl(); renderFinder(); return; }

  switch (t.id) {
    case 'btnCancel':
      if (controller) { controller.abort(); $('#progTitle').textContent = '正在取消…'; }
      else { $('#progress').hidden = true; $('#btnCancel').textContent = '取消'; }
      return;
    case 'btnPresetSave': {
      readInputs();
      const cur = presetById(settings.activePresetId);
      $('#mBox').className = 'm-box small';
      $('#mBody').innerHTML = `<form class="csv-box" id="presetForm"><h2>保存为模板</h2><p class="muted" style="margin:0">把现在选的国家、人群、平台、粉丝和出镜条件存起来，下次一键选用，也能给自动查找用。</p>
        <div class="form" style="margin-top:12px"><label for="presetName">模板名称</label><input id="presetName" maxlength="40" value="${esc(cur && dirty ? cur.name + '（修改版）' : '我的条件 ' + (presets.length + 1))}"></div>
        <div class="actions"><button type="submit" class="btn">保存</button>${cur && dirty && !cur.id.startsWith('example-') ? '<button type="button" class="btn sec" id="presetOverwrite">覆盖「' + esc(cur.name) + '」</button>' : ''}</div></form>`;
      showModal();
      setTimeout(() => { const i = $('#presetName'); i && i.select(); }, 30);
      return;
    }
    case 'presetOverwrite': {
      const cur = presetById(settings.activePresetId);
      Object.assign(cur, clone(Q), { id: cur.id, name: cur.name }); store.savePresets(presets);
      dirty = false; closeModal(); renderFinder(); toast('已更新模板'); return;
    }
    case 'btnPresetDel': {
      if (presets.length <= 1) { toast('至少保留一个模板'); return; }
      if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = '再点确认删除'; setTimeout(() => { delete t.dataset.armed; t.textContent = '删除模板'; }, 3000); return; }
      presets = presets.filter(p => p.id !== settings.activePresetId); store.savePresets(presets);
      delete t.dataset.armed; t.textContent = '删除模板';
      if (!presetById(settings.auto.presetId)) { settings.auto.presetId = presets[0].id; store.saveSettings(settings); }
      loadPreset(presets[0].id); return;
    }
    case 'btnCsv': {
      const list = filtered();
      openTextDialog(`导出 ${list.length} 位博主`, '导出的是当前筛选结果，可以直接用 Excel 或 Google 表格打开。', csvOf(list), `scout-博主-${dayKey(new Date())}.csv`, 'text/csv');
      return;
    }
    case 'btnSaveModel': case 'btnTestModel': {
      const { s, sec } = readModelForm();
      settings = s; secrets = sec;
      store.saveSettings(settings);
      if (!store.saveSecrets(secrets, settings.rememberKey)) setMsg('modelMsg', '浏览器不允许保存，key 只在这次打开时有效。', 'bad');
      renderChrome(); updateComboHint();
      if (t.id === 'btnSaveModel') { const err = checkConfig(llmConfig()); setMsg('modelMsg', err ? '已保存。' + err + '。' : '已保存。可以点「测试连接」确认能用。', err ? '' : 'ok'); return; }
      const err = checkConfig(llmConfig());
      if (err) { setMsg('modelMsg', err, 'bad'); return; }
      setMsg('modelMsg', '正在测试…');
      t.disabled = true;
      testLLM(llmConfig()).then(r => setMsg('modelMsg', `连接成功，模型回复：${r.slice(0, 40)}`, 'ok'))
        .catch(err2 => setMsg('modelMsg', '连接失败：' + err2.message, 'bad'))
        .finally(() => { t.disabled = false; });
      return;
    }
    case 'btnAddGroup': groups.push({ id: 'g-' + Date.now().toString(36), name: '新人群', code: '', hints: '' }); store.saveGroups(groups); renderGroupTbl(); renderFinder(); return;
    case 'btnResetGroups': groups = clone(DEFAULT_GROUPS); store.saveGroups(groups); renderGroupTbl(); renderFinder(); toast('已恢复默认人群'); return;
    case 'btnAddCountry': countries.push({ code: 'XX', name: '新国家', cities: [] }); store.saveCountries(countries); renderCountryTbl(); renderFinder(); return;
    case 'btnResetCountries': countries = clone(DEFAULT_COUNTRIES); store.saveCountries(countries); renderCountryTbl(); renderFinder(); toast('已恢复默认国家'); return;
    case 'btnExport': {
      const text = JSON.stringify(store.exportAll(), null, 2);
      openTextDialog('导出备份', '保存好这个文件，换电脑后在「设置 → 数据备份 → 导入备份」里恢复。不包含 API Key。', text, `scout-备份-${dayKey(new Date())}.json`, 'application/json');
      return;
    }
    case 'btnClear':
      if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = '再点一次：清空所有数据'; setTimeout(() => { delete t.dataset.armed; t.textContent = '清空所有数据'; }, 4000); return; }
      store.clearAll(); location.hash = 'discover'; location.reload(); return;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('select[data-status]')) {
    patchCreator(t.dataset.status, { status: t.value }); t.className = 'st st-' + t.value;
    toast('已改为「' + STATUS_ZH[t.value] + '」');
    if (currentView === 'pipeline') renderPipeline(); else renderChrome();
    return;
  }
  if (t.id === 'presetSel') { loadPreset(t.value); return; }
  if (t.id === 'autoOn') {
    settings.auto.enabled = t.checked;
    if (t.checked && !presetById(settings.auto.presetId)) settings.auto.presetId = settings.activePresetId;
    if (t.checked) settings.auto.lastDate = dayKey(new Date());   // 从明天开始自动找，今天想找就点「搜索」
    store.saveSettings(settings);
    $('#autoDesc').textContent = t.checked ? '已开启：从明天起，每天第一次打开这个网页时自动找一轮。' : autoStatusText();
    toast(t.checked ? '已开启自动查找' : '已关闭自动查找');
    return;
  }
  if (t.id === 'autoPreset') { settings.auto.presetId = t.value; store.saveSettings(settings); toast('自动查找会用「' + (presetById(t.value) || {}).name + '」'); return; }
  if (['qFmin', 'qFmax', 'qCity', 'qLimit'].includes(t.id)) { readInputs(); markDirty(); return; }
  const fmap = { fPlatform: 'platform', fCountry: 'country', fCat: 'cat', fStatus: 'status', fSort: 'sort' };
  if (fmap[t.id]) { F[fmap[t.id]] = t.value; renderDiscover(); return; }
  if (t.id === 'fOnCam') { F.onCam = t.checked; renderDiscover(); return; }
  if (t.id === 'sProvider') { fillProviderFields(t.value, true); return; }
  if (t.dataset.g != null) {
    const g = groups[+t.dataset.g]; const f = t.dataset.f;
    g[f] = f === 'code' ? t.value.trim().toUpperCase() : t.value.trim();
    store.saveGroups(groups); renderFinder(); return;
  }
  if (t.dataset.c != null) {
    const c = countries[+t.dataset.c]; const f = t.dataset.f;
    if (f === 'cities') c.cities = t.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    else if (f === 'code') {
      const old = c.code; c.code = t.value.trim().toUpperCase();
      presets.forEach(p => { const i = p.countries.indexOf(old); if (i >= 0) p.countries[i] = c.code; }); store.savePresets(presets);
      const i = Q.countries.indexOf(old); if (i >= 0) Q.countries[i] = c.code;
    } else c[f] = t.value.trim();
    store.saveCountries(countries); renderFinder(); return;
  }
  if (t.id === 'importFile' && t.files && t.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try { store.importAll(JSON.parse(reader.result)); setMsg('dataMsg', '导入成功，正在刷新…', 'ok'); setTimeout(() => location.reload(), 600); }
      catch (err) { setMsg('dataMsg', '导入失败：' + err.message, 'bad'); }
    };
    reader.readAsText(t.files[0]); t.value = '';
  }
});
let noteT;
document.addEventListener('input', e => {
  if (e.target.id === 'fQ') { F.q = e.target.value; renderDiscover(); }
  if (e.target.id === 'mNotes' && openId) {
    const id = openId, v = e.target.value;
    clearTimeout(noteT); noteT = setTimeout(() => { patchCreator(id, { notes: v }); toast('备注已保存'); }, 600);
  }
});
$('#finder').addEventListener('submit', e => { e.preventDefault(); doSearch('manual'); });
document.addEventListener('submit', e => {
  if (e.target.id !== 'presetForm') return;
  e.preventDefault();
  const name = $('#presetName').value.trim() || `我的条件 ${presets.length + 1}`;
  const p = Object.assign(clone(Q), { id: 'p-' + Date.now().toString(36), name });
  presets.push(p); store.savePresets(presets);
  settings.activePresetId = p.id; store.saveSettings(settings);
  dirty = false; closeModal(); renderFinder(); toast('已保存模板「' + name + '」');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) { closeModal(); render(); } });
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => { if (controller) { e.preventDefault(); e.returnValue = ''; } });

/* ================= 启动 ================= */
function initStatic() {
  $('#ver').textContent = VERSION;
  $('#repoLink').href = REPO_URL;
  $('#fPlatform').innerHTML = '<option value="all">全部平台</option>' + Object.entries(PLATFORMS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  $('#fCountry').innerHTML = '<option value="all">全部国家</option>' + countries.map(c => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('');
  $('#fStatus').innerHTML = '<option value="active">隐藏已放弃</option><option value="all">全部状态</option>' + STATUSES.map(s => `<option value="${s.key}">只看「${s.zh}」</option>`).join('');
}
initStatic();
loadPreset(settings.activePresetId);
route();
detectProxy().finally(maybeAutoRun);

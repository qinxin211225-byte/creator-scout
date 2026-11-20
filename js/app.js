import { VERSION, REPO_URL, PLATFORMS, PLATFORM_TABS, FAN_PRESETS, LIMITS, CATEGORIES, LIFESTYLE, STATUSES, PROVIDERS, DEFAULT_GROUPS, DEFAULT_COUNTRIES } from './config.js';
import { store } from './store.js';
import { checkConfig, testLLM, detectProxy, codexStatus, CODEX_URL } from './llm.js';
import { runSearch } from './search.js';

/* ================= 工具 ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pad = n => String(n).padStart(2, '0');
const dayKey = d => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const dayIndex = d => { d = new Date(d); return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5); };
const ageDays = d => dayIndex(new Date()) - dayIndex(d);
const fmtNum = n => n == null ? '?' : n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : Number(n).toLocaleString('zh-CN');
const fmtWhen = d => { d = new Date(d); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const STATUS_ZH = Object.fromEntries(STATUSES.map(s => [s.key, s.zh]));
const clone = v => JSON.parse(JSON.stringify(v));
function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }
function setMsg(id, text, kind) { const el = $('#' + id); el.textContent = text; el.className = 'msg' + (kind ? ' ' + kind : ''); }

const ICON = {
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".9" fill="currentColor" stroke="none"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.6 2.3 4.4 5 4.6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l16 16M20 4 4 20"/></svg>',
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
let Q = null;
let controller = null;
let lastAdded = new Set();
const F = { scope: 'all', group: 'all', cam: false, sort: 'priority' };
let listTab = 'all';
let currentView = 'discover';
let openId = null;
let os = /win/i.test(navigator.platform || navigator.userAgent) ? 'win' : 'mac';

const groupName = id => (groups.find(g => g.id === id) || {}).name || '未识别';
const countryName = code => (countries.find(c => c.code === code) || {}).name || code || '';
const isCodex = () => settings.provider === 'codex';

function llmConfig() {
  const p = PROVIDERS[settings.provider] || PROVIDERS.deepseek;
  return {
    provider: settings.provider, baseUrl: settings.baseUrl || p.base, model: settings.model || p.model,
    apiKey: secrets.apiKey || '', tavilyKey: secrets.tavilyKey || '', codexToken: secrets.codexToken || '', proxy: settings.proxy || '',
  };
}
function saveSecrets() { return store.saveSecrets(secrets, isCodex() || settings.rememberKey !== false); }
function persist() { if (!store.saveCreators(creators)) toast('浏览器存储空间不足，请先在设置里导出备份'); }

/* ================= 搜索条件 ================= */
const presetById = id => presets.find(p => p.id === id);
function loadPreset(id) {
  const p = presetById(id) || presets[0];
  Q = clone(p);
  Q.platforms = ['instagram'];
  settings.activePresetId = p ? p.id : '';
  store.saveSettings(settings);
  renderFinder();
}
const chip = (k, v, label, on, title) => `<button type="button" class="chip" data-chip="${k}" data-val="${esc(v)}" aria-pressed="${on}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
function fanId() { const f = FAN_PRESETS.find(f => f.min === Q.fmin && f.max === Q.fmax); return f ? f.id : ''; }
function renderFinder() {
  $('#ptabs').innerHTML = PLATFORM_TABS.map(t => `<button type="button" class="ptab" role="tab" aria-selected="${t.id === 'instagram'}"${t.ready ? '' : ' disabled'}>${ICON[t.id] || ''}${t.label}${t.ready ? '' : '<span class="soon">即将推出</span>'}</button>`).join('');
  $('#chipCountries').innerHTML = countries.map(c => chip('countries', c.code, c.name, Q.countries.includes(c.code), c.cities.join(', '))).join('');
  $('#chipGroups').innerHTML = groups.map(g => chip('groups', g.id, g.name, Q.groups.includes(g.id), g.hints)).join('') + `<button type="button" class="chip edit" data-nav="settings" data-open-fold="groups">＋ 编辑</button>`;
  const fid = fanId();
  $('#chipFans').innerHTML = FAN_PRESETS.map(f => chip('fans', f.id, f.label, f.id === fid)).join('');
  $('#qCam').checked = Q.camera === 'require';
  $('#qLife').checked = (Q.categories || []).length > 0;
  $('#chipLimit').innerHTML = LIMITS.map(l => chip('limit', l.v, l.label, (Q.limit || 0) === l.v)).join('');
  $('#qCity').value = Q.city || '';
  $('#presetSel').innerHTML = presets.map(p => `<option value="${esc(p.id)}"${p.id === settings.activePresetId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#autoOn').checked = !!settings.auto.enabled;
  $('#autoDesc').textContent = autoText();
  updateHint();
}
function updateHint() {
  const err = checkConfig(llmConfig());
  const n = Q.countries.length * Q.groups.length;
  $('#searchHint').textContent = err ? err : !n ? '至少选一个国家和一种人' : !Q.limit
    ? `不限：${n} 种组合轮流搜，每轮换城市和搜法，直到找不到新的或你点「停止」。找到的边找边显示`
    : `在 ${n} 种组合里轮流搜，换着城市找，找满 ${Q.limit} 位就停`;
  $('#searchHint').style.color = err ? 'var(--warn)' : '';
  $('#btnSearch').disabled = !!controller;
}
function readInputs() {
  Q.city = $('#qCity').value.trim();
  Q.camera = $('#qCam').checked ? 'require' : 'prefer';
  Q.categories = $('#qLife').checked ? LIFESTYLE.slice() : [];
}

/* ================= 搜索 ================= */
async function doSearch(trigger, preset) {
  if (controller) { toast('已经在搜索了'); return; }
  const cfg = llmConfig();
  const err = checkConfig(cfg);
  if (err) { toast(err); if (trigger === 'manual') go('settings'); return; }
  let q, name;
  if (preset) { q = clone(preset); q.platforms = ['instagram']; name = preset.name + '（自动）'; }
  else { readInputs(); q = clone(Q); const p = presetById(settings.activePresetId); name = p && JSON.stringify(stripId(p)) === JSON.stringify(stripId(Q)) ? p.name : '自定义条件'; }
  if (!q.countries.length || !q.groups.length) { toast('至少选一个国家和一种人'); return; }

  controller = new AbortController();
  const t0 = Date.now();
  const prog = $('#progress');
  prog.hidden = false; prog.classList.remove('done');
  $('#progLog').innerHTML = '';
  $('#btnCancel').textContent = '停止';
  $('#progTitle').textContent = trigger === 'auto' ? '每天自动找：正在搜索…' : '正在搜索…';
  $('#btnSearch').disabled = true; $('#btnSearchTxt').textContent = '搜索中…';
  lastAdded = new Set();
  let found = 0;
  const perGroup = isCodex() ? 'Codex 每轮通常 1～4 分钟' : '每轮通常 20～90 秒';
  const meta = () => { const s = Math.round((Date.now() - t0) / 1000); $('#progMeta').textContent = `已找到 ${found} 位 · 用时 ${Math.floor(s / 60)}:${pad(s % 60)} · ${perGroup}${q.limit ? '' : ' · 随时可以停止，已找到的会保留'}`; };
  const tick = setInterval(meta, 1000); meta();
  prog.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (!q.limit) { F.scope = 'today'; F.group = 'all'; }
  let pendingRender = null;
  const seenBuf = [];

  let result = null;
  try {
    result = await runSearch({
      q, cfg, groups, countries, existing: creators, seen: store.seen(), coverage: store.coverage(),
      signal: controller.signal, trigger, presetName: name,
      onProgress: ({ text, kind }) => {
        $('#progLog').insertAdjacentHTML('beforeend', `<li class="${kind || ''}">${esc(text)}</li>`);
        const log = $('#progLog'); log.scrollTop = log.scrollHeight;
        if (kind === 'step') $('#progTitle').textContent = text;
        if (seenBuf.length) store.addSeen(seenBuf.splice(0));
      },
      onFound: c => {   // 边找边保存、边显示
        creators.unshift(c); found++; lastAdded.add(c.id); persist(); meta();
        if (!pendingRender) pendingRender = setTimeout(() => { pendingRender = null; if (currentView === 'discover') renderFeed(); renderChrome(); }, 300);
      },
      onSeen: s => seenBuf.push(s),
      onCover: key => store.touchCoverage(key),
    });
  } catch (e) { toast(e.message); }
  if (seenBuf.length) store.addSeen(seenBuf.splice(0));
  clearInterval(tick);
  controller = null;
  $('#btnSearch').disabled = false; $('#btnSearchTxt').textContent = '搜索';
  if (!result) { if (!found) prog.hidden = true; updateHint(); render(); return; }

  const { run } = result;
  runs.unshift(run); store.saveRuns(runs);
  const st = { ok: '完成', partial: '部分完成', failed: '没有完成', cancelled: '已停止' }[run.status] || run.status;
  $('#progTitle').textContent = `${st}：新找到 ${run.added} 位博主`;
  const rs = Object.entries(run.reject_reasons || {}).map(([k, v]) => `${k} ${v}`).join('，');
  $('#progLog').insertAdjacentHTML('beforeend', `<li class="${run.added ? 'ok' : 'info'}">${esc(`共 ${run.calls} 轮，看了 ${run.candidates} 个候选：新找到 ${run.added}，已有的 ${run.duplicates}，不合格 ${run.rejected}${rs ? `（${rs}）` : ''}`)}</li>`);
  prog.classList.add('done');
  $('#btnCancel').textContent = '收起';
  if (run.added) { F.scope = 'today'; F.group = 'all'; }
  render();
  toast(`${st}，新找到 ${run.added} 位`);
  if (run.added && q.limit) $('#feedTitle').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
const stripId = p => ({ countries: p.countries, groups: p.groups, fmin: p.fmin, fmax: p.fmax, camera: p.camera, categories: p.categories, city: p.city || '', limit: p.limit || 0 });

/* ================= 每天自动找 ================= */
function autoText() {
  const a = settings.auto;
  if (!a.enabled) return '开启后，每天第一次打开网页会按当前条件自动找一轮';
  const today = dayKey(new Date());
  const p = presetById(a.presetId);
  const last = runs.find(r => r.trigger === 'auto');
  if (a.lastDate === today) return `今天已经找过${last && dayKey(last.started_at) === today ? `（新找到 ${last.added} 位）` : ''}，明天打开网页再找 · 条件：${p ? p.name : '已删除'}`;
  return `已开启 · 条件：${p ? p.name : '已删除'}`;
}
function maybeAutoRun() {
  const a = settings.auto;
  if (!a.enabled) return;
  const today = dayKey(new Date());
  if (a.lastDate === today) return;
  const p = presetById(a.presetId) || presets[0];
  if (!p || checkConfig(llmConfig())) { banner('每天自动找已开启，但 AI 还没连接好。', '去设置', 'settings'); return; }
  a.lastDate = today; store.saveSettings(settings);
  setTimeout(() => doSearch('auto', p).then(() => { $('#autoDesc').textContent = autoText(); }), 1200);
}

/* ================= 找博主：信息流 ================= */
function avatar(c, ring, size) {
  const ch = esc(String(c.display_name || c.username).trim().charAt(0).toUpperCase() || '?');
  return `<span class="av${ring ? ' ring' : ''}" style="--s:${size}px"><span class="av-in" style="--h:${hash(c.id) % 360}">${ch}</span></span>`;
}
const camLabel = c => c.on_camera === true ? '出镜' : c.on_camera === false ? '不出镜' : '出镜?';
function cardHTML(c) {
  const id = esc(c.id);
  const saved = c.status !== 'new' && c.status !== 'dropped';
  const tags = [`#${groupName(c.group)}`, `#${countryName(c.country)}`, `#${CATEGORIES[c.category] || '其他'}`];
  return `<article class="pcard${lastAdded.has(c.id) ? ' fresh' : ''}">
    <div class="ph">
      ${avatar(c, ageDays(c.found_at) === 0, 72)}
      <div class="who">
        <button type="button" class="handle" data-open="${id}">${esc(c.username)}${c.priority_score >= 80 ? '<span class="top">很匹配</span>' : ''}</button>
        <span class="sub">${esc(c.display_name)}${c.city ? ' · ' + esc(c.city) : ''}</span>
        <div class="stats"><span><b class="${c.followers_verified ? '' : 'q-mark'}">${fmtNum(c.followers)}</b> 粉丝</span><span><b>${Math.round((c.group_confidence || 0) * 100)}%</b> 匹配</span><span><b>${camLabel(c)}</b></span></div>
      </div>
    </div>
    <p class="bio">${esc(c.bio || '（没有简介）')}</p>
    <div class="tags">${tags.map(esc).map(t => `<span>${t}</span>`).join('')}${c.followers_verified ? '' : '<span class="warn">粉丝数未核实</span>'}</div>
    ${c.group_evidence && c.group_evidence[0] ? `<p class="why">依据：${esc(c.group_evidence[0])}</p>` : ''}
    <div class="acts">
      <button type="button" class="${saved ? 'btn-sec' : 'btn-blue'}" data-save="${id}">${saved ? '已收藏' : '收藏'}</button>
      <a class="btn-sec" href="${esc(c.profile_url)}" target="_blank" rel="noopener">在 Instagram 打开</a>
      <button type="button" class="ghost" data-drop="${id}" title="不合适，以后不显示">不合适</button>
    </div>
  </article>`;
}
function feedList() {
  return creators.filter(c => {
    if (c.status === 'dropped') return false;
    if (F.scope === 'today' && ageDays(c.found_at) !== 0) return false;
    if (F.group !== 'all' && c.group !== F.group) return false;
    if (F.cam && c.on_camera !== true) return false;
    return true;
  }).sort((a, b) => F.sort === 'followers' ? (b.followers || 0) - (a.followers || 0) : F.sort === 'newest' ? new Date(b.found_at) - new Date(a.found_at) : b.priority_score - a.priority_score);
}
function renderFeed() {
  const today = creators.filter(c => ageDays(c.found_at) === 0 && c.status !== 'dropped');
  const used = groups.filter(g => creators.some(c => c.group === g.id && c.status !== 'dropped'));
  $('#stories').innerHTML = used.length < 1 ? '' :
    `<button type="button" class="story${F.group === 'all' ? ' on' : ''}${today.length ? ' has' : ''}" data-group="all"><span class="sring"><span class="sin" style="background:var(--ink);color:var(--bg)">全部</span></span><span class="st-l">全部</span><span class="st-n">${today.length ? '今天 +' + today.length : ''}</span></button>` +
    used.map(g => { const n = today.filter(c => c.group === g.id).length; return `<button type="button" class="story${F.group === g.id ? ' on' : ''}${n ? ' has' : ''}" data-group="${esc(g.id)}"><span class="sring"><span class="sin" style="--h:${hash(g.id) % 360}">${esc(g.code || g.name.slice(0, 2))}</span></span><span class="st-l">${esc(g.name)}</span><span class="st-n">${n ? '今天 +' + n : '共 ' + creators.filter(c => c.group === g.id && c.status !== 'dropped').length}</span></button>`; }).join('');
  $$('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === F.scope)));
  $('#fCam').checked = F.cam; $('#fSort').value = F.sort;
  const list = feedList();
  $('#feedTitle').textContent = `${F.scope === 'today' ? '今天找到' : '找到的博主'} · ${list.length}`;
  $('#grid').innerHTML = list.length ? list.map(cardHTML).join('') :
    creators.length ? `<div class="empty"><b>这里没有博主</b>换成「全部」或别的人群看看。</div>`
      : `<div class="empty"><b>还没有博主</b>${checkConfig(llmConfig()) ? '先去「设置」连接 AI（本机 Codex 或 API Key），再回来点「搜索」。' : '选好上面的条件，点「搜索」。'}</div>`;
}

/* ================= 我的名单 ================= */
function renderList() {
  const tabs = [{ key: 'all', zh: '全部' }].concat(STATUSES);
  const count = k => k === 'all' ? creators.filter(c => c.status !== 'dropped').length : creators.filter(c => c.status === k).length;
  $('#listTabs').innerHTML = tabs.map(t => `<button type="button" class="tab" role="tab" data-tab="${t.key}" aria-selected="${t.key === listTab}">${t.zh}<span>${count(t.key)}</span></button>`).join('');
  const list = creators.filter(c => listTab === 'all' ? c.status !== 'dropped' : c.status === listTab).sort((a, b) => new Date(b.updated_at || b.found_at) - new Date(a.updated_at || a.found_at));
  $('#rows').innerHTML = list.length ? list.map(c => `<div class="row">${avatar(c, false, 44)}
    <div style="min-width:0"><button type="button" class="handle" data-open="${esc(c.id)}" style="font-size:14px">${esc(c.username)}</button>
    <div class="sub">${esc(groupName(c.group))} · ${esc(c.city || countryName(c.country))} · ${fmtNum(c.followers)} 粉丝</div></div>
    ${statusSelect(c)}${c.notes ? `<div class="note" title="${esc(c.notes)}">备注：${esc(c.notes)}</div>` : ''}</div>`).join('')
    : `<div class="empty" style="margin-top:12px"><b>这里还没有人</b>在「找博主」里点「收藏」，博主就会出现在这里。</div>`;
  const st = { ok: ['完成', 'ok'], partial: ['部分完成', 'partial'], failed: ['没有完成', 'failed'], cancelled: ['已取消', 'partial'] };
  $('#runs').innerHTML = runs.length ? runs.slice(0, 8).map(r => { const s = st[r.status] || [r.status, 'partial']; return `<div class="run"><span class="pill ${s[1]}">${s[0]}</span><span>${fmtWhen(r.started_at)}</span><span>${r.trigger === 'auto' ? '自动' : '手动'} · ${esc(r.preset)}</span><b>新增 ${r.added}</b><span class="hint">${esc(r.model || '')}${(r.errors || []).length ? ' · ' + esc(r.errors[0]) : ''}</span></div>`; }).join('') : '<p class="hint">还没有查找记录。</p>';
}
function statusSelect(c) {
  return `<select class="st st-${c.status}" data-status="${esc(c.id)}" aria-label="${esc(c.username)} 的跟进状态">${STATUSES.map(s => `<option value="${s.key}"${s.key === c.status ? ' selected' : ''}>${s.zh}</option>`).join('')}</select>`;
}

/* ================= 设置 ================= */
function bridgeCmd() {
  const site = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${os === 'win' ? 'python' : 'python3'} scout_codex_bridge.py --site ${site}`;
}
function renderSettings() {
  $('#modeCodex').checked = isCodex();
  $('#modeApi').checked = !isCodex();
  $('#panelCodex').hidden = !isCodex();
  $('#panelApi').hidden = isCodex();
  $$('[data-os]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.os === os)));
  $('#cmdText').textContent = bridgeCmd();
  $('#btnConnect').href = CODEX_URL + '/connect';
  if (isCodex() && !$('#codexMsg').textContent) setMsg('codexMsg', secrets.codexToken ? '已配对。可以点「检查连接」确认连接程序还在运行。' : '还没连接。', secrets.codexToken ? 'ok' : '');
  const apiProv = settings.provider === 'codex' ? (settings.lastApiProvider || 'deepseek') : settings.provider;
  $('#sProvider').innerHTML = Object.entries(PROVIDERS).filter(([k]) => k !== 'codex').map(([k, v]) => `<option value="${k}"${k === apiProv ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  fillProvider(apiProv, false);
  $('#sKey').value = secrets.apiKey || '';
  $('#sTavily').value = secrets.tavilyKey || '';
  $('#sRemember').checked = settings.rememberKey !== false;
  $('#sProxy').value = settings.proxy || '';
  renderTables();
}
function fillProvider(provider, reset) {
  const p = PROVIDERS[provider];
  const same = settings.provider === provider && !reset;
  $('#sProviderNote').textContent = p.note;
  $('#sModel').placeholder = p.model || '填服务商文档里的模型名';
  $('#sBase').placeholder = p.base || 'https://…/v1';
  $('#sModel').value = same ? settings.model || p.model : p.model;
  $('#sBase').value = same ? settings.baseUrl || p.base : p.base;
  $('#sTavilyWrap').hidden = p.search !== 'tavily';
  $('#sKeyLink').hidden = !p.keyUrl; $('#sKeyLink').href = p.keyUrl || '#';
}
function saveApiForm() {
  const provider = $('#sProvider').value, p = PROVIDERS[provider];
  const model = $('#sModel').value.trim(), base = $('#sBase').value.trim().replace(/\/+$/, '');
  Object.assign(settings, { provider, lastApiProvider: provider, model: model === p.model ? '' : model, baseUrl: base === p.base ? '' : base, proxy: $('#sProxy').value.trim(), rememberKey: $('#sRemember').checked });
  secrets.apiKey = $('#sKey').value.trim(); secrets.tavilyKey = $('#sTavily').value.trim();
  store.saveSettings(settings); saveSecrets();
}
function renderTables() {
  $('#groupTbl').innerHTML = `<tr><th>人群</th><th>简称</th><th>识别线索 / 搜索词</th><th></th></tr>` + groups.map((g, i) => `<tr>
    <td><input data-g="${i}" data-f="name" value="${esc(g.name)}" aria-label="人群名称"></td>
    <td><input class="s" data-g="${i}" data-f="code" value="${esc(g.code || '')}" maxlength="3" aria-label="简称"></td>
    <td><input class="l" data-g="${i}" data-f="hints" value="${esc(g.hints || '')}" aria-label="识别线索"></td>
    <td><button type="button" class="ghost" data-delgroup="${i}">删除</button></td></tr>`).join('');
  $('#countryTbl').innerHTML = `<tr><th>国家</th><th>代码</th><th>城市（英文，逗号分隔）</th><th></th></tr>` + countries.map((c, i) => `<tr>
    <td><input data-c="${i}" data-f="name" value="${esc(c.name)}" aria-label="国家名称"></td>
    <td><input class="s" data-c="${i}" data-f="code" value="${esc(c.code)}" maxlength="3" aria-label="国家代码"></td>
    <td><input class="l" data-c="${i}" data-f="cities" value="${esc(c.cities.join(', '))}" aria-label="城市"></td>
    <td><button type="button" class="ghost" data-delcountry="${i}">删除</button></td></tr>`).join('');
}
function pairWith(token, from) {
  token = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) { setMsg('codexMsg', '配对码格式不对，请从终端完整复制。', 'bad'); return; }
  if (settings.provider !== 'codex') settings.lastApiProvider = settings.provider;
  settings.provider = 'codex'; store.saveSettings(settings);
  secrets.codexToken = token; saveSecrets();
  setMsg('codexMsg', '已配对，正在检查…');
  codexStatus(llmConfig()).then(s => { setMsg('codexMsg', `已连接本机 Codex（配对 ${Math.round(s.expires_in / 3600)} 小时内有效）。可以回去搜索了。`, 'ok'); toast('已连接本机 Codex'); })
    .catch(e => setMsg('codexMsg', e.message, 'bad'))
    .finally(() => renderChrome());
  if (from === 'link') toast('配对成功');
}

/* ================= 详情 ================= */
function openModal(id) {
  const c = creators.find(x => x.id === id); if (!c) return;
  openId = id;
  $('#mBody').innerHTML = `<div class="m-in">
    <div class="ph">${avatar(c, true, 86)}<div class="who"><span class="handle" style="font-size:18px">${esc(c.username)}</span><span class="sub">${esc(c.display_name)}${c.city ? ' · ' + esc(c.city) : ''}，${esc(countryName(c.country))}</span>
      <div class="stats"><span><b class="${c.followers_verified ? '' : 'q-mark'}">${fmtNum(c.followers)}</b> 粉丝</span><span><b>${Math.round((c.group_confidence || 0) * 100)}%</b> 匹配</span><span><b>${c.priority_score}</b> 分</span></div></div></div>
    <p class="bio" style="-webkit-line-clamp:unset">${esc(c.bio || '（没有简介）')}</p>
    <div><h3>为什么是${esc(groupName(c.group))}</h3>${(c.group_evidence || []).length ? `<ul>${c.group_evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '<p class="hint">AI 没给出依据。</p>'}</div>
    <div><h3>出镜</h3><p style="margin:0;font-size:13px">${esc(camLabel(c))}${c.on_camera_basis ? '：' + esc(c.on_camera_basis) : ''}</p></div>
    ${c.followers_verified ? '' : '<p class="hint" style="margin:0">AI 没在页面上看到确切粉丝数，打开主页确认一下。</p>'}
    <div class="links"><a href="${esc(c.profile_url)}" target="_blank" rel="noopener">${ICON.instagram}<span>在 Instagram 打开</span><span>@${esc(c.username)}</span></a>
      ${(c.sources || []).filter(u => u !== c.profile_url).slice(0, 4).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><span>来源</span><span>${esc(u.replace(/^https?:\/\//, ''))}</span></a>`).join('')}</div>
    ${c.contact_email ? `<p style="margin:0;font-size:13px">公开邮箱：<span style="user-select:all">${esc(c.contact_email)}</span></p>` : ''}
    <div><h3>跟进状态</h3><div class="st-seg">${STATUSES.map(s => `<button type="button" class="st-${s.key}" data-setstatus="${s.key}" aria-pressed="${s.key === c.status}"><span>${s.zh}</span></button>`).join('')}</div></div>
    <div><h3><label for="mNotes">备注（自动保存）</label></h3><textarea id="mNotes" placeholder="报价、联系方式、对方回复……">${esc(c.notes || '')}</textarea></div>
    <div class="m-foot"><span>${fmtWhen(c.found_at)} 找到${c.last_post ? ' · 最近发布 ' + esc(c.last_post) : ''}</span><button type="button" class="ghost" data-del="${esc(c.id)}" style="color:var(--bad)">删除</button></div>
  </div>`;
  showModal();
}
function showModal() { $('#modal').hidden = false; document.body.style.overflow = 'hidden'; setTimeout(() => { const x = $('.m-x'); x && x.focus(); }, 0); }
function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; openId = null; render(); }
function textDialog(title, desc, text, filename, type) {
  $('#mBody').innerHTML = `<div class="m-in dlg"><h2 style="font-size:17px">${esc(title)}</h2><p class="hint" style="margin:0">${esc(desc)}</p><textarea id="dlgText" readonly aria-label="内容">${esc(text)}</textarea>
    <div class="row-btns"><button type="button" class="btn-blue" id="dlgDl">下载文件</button><button type="button" class="btn-sec" id="dlgCopy">复制</button></div></div>`;
  $('#dlgDl').onclick = () => {
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([type === 'text/csv' ? '﻿' + text : text], { type: type + ';charset=utf-8' })); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    catch (e) { toast('浏览器拦住了下载，请用“复制”'); }
  };
  $('#dlgCopy').onclick = () => copy(text, $('#dlgText'));
  showModal();
}
async function copy(text, box) { try { await navigator.clipboard.writeText(text); toast('已复制'); } catch (e) { if (box) { box.focus(); box.select && box.select(); } toast('请按 Ctrl/⌘+C 复制'); } }
function csv(list) {
  const cols = [['用户名', 'username'], ['显示名', 'display_name'], ['主页', 'profile_url'], ['粉丝', c => c.followers_verified ? c.followers : ''], ['国家', c => countryName(c.country)], ['城市', 'city'], ['人群', c => groupName(c.group)], ['匹配度', 'group_confidence'], ['出镜', camLabel], ['类别', c => CATEGORIES[c.category]], ['状态', c => STATUS_ZH[c.status]], ['备注', 'notes'], ['公开邮箱', 'contact_email'], ['依据', c => (c.group_evidence || []).join(' / ')], ['找到时间', c => dayKey(c.found_at)]];
  const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.map(c => c[0]).join(',')].concat(list.map(c => cols.map(([, f]) => q(typeof f === 'function' ? f(c) : c[f])).join(','))).join('\n');
}
function patch(id, p) { const c = creators.find(x => x.id === id); if (!c) return; Object.assign(c, p, { updated_at: new Date().toISOString() }); persist(); }

/* ================= 外框与路由 ================= */
const VIEWS = ['discover', 'list', 'settings'];
function banner(text, btn, nav) { $('#bannerSlot').innerHTML = text ? `<div class="banner">${esc(text)}${btn ? `<button type="button" data-nav="${nav}">${esc(btn)}</button>` : ''}</div>` : ''; }
function renderChrome() {
  const err = checkConfig(llmConfig());
  $('#badgeSetup').hidden = !err;
  const saved = creators.filter(c => c.status === 'saved').length;
  $('#badgeList').hidden = !saved; $('#badgeList').textContent = saved;
  $('#connPill').classList.toggle('on', !err);
  $('#connLabel').textContent = err ? '未连接 AI' : isCodex() ? '本机 Codex' : `${PROVIDERS[settings.provider].label} · ${llmConfig().model}`;
  if (err && !creators.length && currentView === 'discover') banner('欢迎使用 Scout。先在设置里连接 AI：用电脑上的 Codex，或者填一个 API Key。', '去设置', 'settings');
  else if (!err || currentView === 'settings') banner('');
  if (Q) updateHint();
}
function render() {
  VIEWS.forEach(v => { $('#view-' + v).hidden = v !== currentView; const n = $('#nav-' + v); if (v === currentView) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
  if (currentView === 'discover') renderFeed();
  if (currentView === 'list') renderList();
  if (currentView === 'settings') renderSettings();
  renderChrome();
}
function route() {
  const h = location.hash || '';
  const m = h.match(/^#pair=([A-Za-z0-9_-]+)/);
  if (m) {   // 连接程序确认页跳回来，带着配对码
    try { history.replaceState(null, '', location.pathname + location.search + '#settings'); } catch (e) {}
    currentView = 'settings'; render(); pairWith(m[1], 'link'); return;
  }
  const v = h.replace('#', '');
  currentView = VIEWS.includes(v) ? v : 'discover';
  render();
}
function go(v) { if (location.hash !== '#' + v) { try { location.hash = v; } catch (e) { currentView = v; render(); } } else { currentView = v; render(); } window.scrollTo(0, 0); }

/* ================= 事件 ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('button, a[data-nav], [data-close]');
  if (!t) return;
  const d = t.dataset;
  if (d.nav) { go(d.nav); if (d.openFold) setTimeout(() => { const f = $('details.fold'); if (f) { f.open = true; f.scrollIntoView({ block: 'start' }); } }, 50); return; }
  if (d.chip) {
    if (d.chip === 'fans') { const f = FAN_PRESETS.find(x => x.id === d.val); Q.fmin = f.min; Q.fmax = f.max; }
    else if (d.chip === 'limit') Q.limit = +d.val;
    else { const a = Q[d.chip]; const i = a.indexOf(d.val); if (i >= 0) a.splice(i, 1); else a.push(d.val); }
    renderFinder(); return;
  }
  if (d.scope) { F.scope = d.scope; renderFeed(); return; }
  if (d.group) { F.group = F.group === d.group && d.group !== 'all' ? 'all' : d.group; renderFeed(); return; }
  if (d.open) { openModal(d.open); return; }
  if (t.hasAttribute('data-close')) { closeModal(); return; }
  if (d.save) { const c = creators.find(x => x.id === d.save); const on = c.status === 'new'; patch(d.save, { status: on ? 'saved' : 'new' }); renderFeed(); renderChrome(); toast(on ? '已收藏，在「我的名单」里跟进' : '已取消收藏'); return; }
  if (d.drop) { patch(d.drop, { status: 'dropped' }); renderFeed(); toast('已标记不合适，不再显示'); return; }
  if (d.tab) { listTab = d.tab; renderList(); return; }
  if (d.setstatus && openId) { patch(openId, { status: d.setstatus }); $$('[data-setstatus]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); toast('已改为「' + STATUS_ZH[d.setstatus] + '」'); return; }
  if (d.del) { if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = '再点一次确认删除'; return; } creators = creators.filter(c => c.id !== d.del); persist(); closeModal(); toast('已删除'); return; }
  if (d.os) { os = d.os; renderSettings(); return; }
  if (d.delgroup != null) { groups.splice(+d.delgroup, 1); store.saveGroups(groups); renderTables(); renderFinder(); return; }
  if (d.delcountry != null) { countries.splice(+d.delcountry, 1); store.saveCountries(countries); renderTables(); renderFinder(); return; }

  switch (t.id) {
    case 'btnCancel':
      if (controller) { controller.abort(); $('#progTitle').textContent = '正在停止，已找到的会保留…'; }
      else $('#progress').hidden = true;
      return;
    case 'btnPresetSave': {
      readInputs();
      $('#mBody').innerHTML = `<form class="m-in" id="presetForm"><h2 style="font-size:17px">存为常用条件</h2><p class="hint" style="margin:0">下次一键选用，「每天自动找」也会用它。</p>
        <div class="form"><label for="presetName">名字</label><input id="presetName" maxlength="40" value="我的条件 ${presets.length + 1}"></div>
        <div class="row-btns"><button type="submit" class="btn-blue">保存</button></div></form>`;
      showModal(); setTimeout(() => $('#presetName') && $('#presetName').select(), 30); return;
    }
    case 'btnPresetDel': {
      if (presets.length <= 1) { toast('至少保留一个'); return; }
      if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = '确认删除'; setTimeout(() => { delete t.dataset.armed; t.textContent = '删除'; }, 3000); return; }
      presets = presets.filter(p => p.id !== settings.activePresetId); store.savePresets(presets);
      if (!presetById(settings.auto.presetId)) settings.auto.presetId = presets[0].id;
      delete t.dataset.armed; t.textContent = '删除'; loadPreset(presets[0].id); return;
    }
    case 'btnCsv': { const list = creators.filter(c => listTab === 'all' ? c.status !== 'dropped' : c.status === listTab); textDialog(`导出 ${list.length} 位博主`, '可以直接用 Excel 或 Google 表格打开。', csv(list), `scout-${dayKey(new Date())}.csv`, 'text/csv'); return; }
    case 'btnCopyCmd': copy(bridgeCmd(), $('#cmdText')); return;
    case 'btnCodexTest':
      if (!secrets.codexToken) { setMsg('codexMsg', '还没配对，请先点「一键连接 Codex」。', 'bad'); return; }
      setMsg('codexMsg', '正在检查…');
      codexStatus(llmConfig()).then(s => setMsg('codexMsg', s.busy ? '已连接，Codex 正在处理一个请求。' : `已连接，配对还有 ${Math.max(1, Math.round(s.expires_in / 3600))} 小时有效。`, 'ok')).catch(err => setMsg('codexMsg', err.message, 'bad'));
      return;
    case 'btnPair': pairWith($('#pairInput').value, 'manual'); $('#pairInput').value = ''; return;
    case 'btnSaveModel': saveApiForm(); renderChrome(); setMsg('modelMsg', checkConfig(llmConfig()) || '已保存，可以点「测试连接」确认。', checkConfig(llmConfig()) ? 'bad' : 'ok'); return;
    case 'btnTestModel': {
      saveApiForm(); renderChrome();
      const err = checkConfig(llmConfig()); if (err) { setMsg('modelMsg', err, 'bad'); return; }
      setMsg('modelMsg', '正在测试…'); t.disabled = true;
      testLLM(llmConfig()).then(r => setMsg('modelMsg', '连接成功，模型回复：' + r.slice(0, 40), 'ok')).catch(e2 => setMsg('modelMsg', '连接失败：' + e2.message, 'bad')).finally(() => { t.disabled = false; });
      return;
    }
    case 'btnAddGroup': groups.push({ id: 'g-' + Date.now().toString(36), name: '新人群', code: '', hints: '' }); store.saveGroups(groups); renderTables(); renderFinder(); return;
    case 'btnResetGroups': groups = clone(DEFAULT_GROUPS); store.saveGroups(groups); renderTables(); renderFinder(); toast('已恢复默认'); return;
    case 'btnAddCountry': countries.push({ code: 'XX', name: '新国家', cities: [] }); store.saveCountries(countries); renderTables(); renderFinder(); return;
    case 'btnResetCountries': countries = clone(DEFAULT_COUNTRIES); store.saveCountries(countries); renderTables(); renderFinder(); toast('已恢复默认'); return;
    case 'btnExport': textDialog('导出备份', '换电脑后在「设置 → 数据备份 → 导入备份」恢复。不含 key 和配对码。', JSON.stringify(store.exportAll(), null, 2), `scout-备份-${dayKey(new Date())}.json`, 'application/json'); return;
    case 'btnClear':
      if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = '再点一次：全部清空'; setTimeout(() => { delete t.dataset.armed; t.textContent = '清空所有数据'; }, 4000); return; }
      store.clearAll(); location.hash = 'discover'; location.reload(); return;
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'finder') { doSearch('manual'); return; }
  if (e.target.id === 'presetForm') {
    const name = $('#presetName').value.trim() || `我的条件 ${presets.length + 1}`;
    const p = Object.assign(clone(Q), { id: 'p-' + Date.now().toString(36), name });
    presets.push(p); store.savePresets(presets); settings.activePresetId = p.id; store.saveSettings(settings);
    closeModal(); renderFinder(); toast('已保存「' + name + '」');
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('select[data-status]')) { patch(t.dataset.status, { status: t.value }); t.className = 'st st-' + t.value; toast('已改为「' + STATUS_ZH[t.value] + '」'); if (currentView === 'list') renderList(); renderChrome(); return; }
  if (t.id === 'presetSel') { loadPreset(t.value); return; }
  if (['qCam', 'qLife', 'qCity'].includes(t.id)) { readInputs(); updateHint(); return; }
  if (t.id === 'autoOn') {
    settings.auto.enabled = t.checked;
    if (t.checked) {   // 用当前条件；如果改过条件，自动存成一个常用条件
      readInputs();
      let p = presetById(settings.activePresetId);
      if (!p || JSON.stringify(stripId(p)) !== JSON.stringify(stripId(Q))) { p = Object.assign(clone(Q), { id: 'p-' + Date.now().toString(36), name: '每天自动找的条件' }); presets.push(p); store.savePresets(presets); settings.activePresetId = p.id; }
      settings.auto.presetId = p.id;
      settings.auto.lastDate = dayKey(new Date());
    }
    store.saveSettings(settings); renderFinder();
    toast(t.checked ? '已开启：从明天起每天自动找' : '已关闭每天自动找'); return;
  }
  if (t.id === 'fCam') { F.cam = t.checked; renderFeed(); return; }
  if (t.id === 'fSort') { F.sort = t.value; renderFeed(); return; }
  if (t.name === 'mode') {
    if (t.value === 'codex') { if (settings.provider !== 'codex') settings.lastApiProvider = settings.provider; settings.provider = 'codex'; }
    else settings.provider = settings.lastApiProvider || 'deepseek';
    store.saveSettings(settings); setMsg('codexMsg', ''); renderSettings(); renderChrome(); return;
  }
  if (t.id === 'sProvider') { fillProvider(t.value, true); return; }
  if (t.dataset.g != null) { const g = groups[+t.dataset.g]; g[t.dataset.f] = t.dataset.f === 'code' ? t.value.trim().toUpperCase() : t.value.trim(); store.saveGroups(groups); renderFinder(); return; }
  if (t.dataset.c != null) {
    const c = countries[+t.dataset.c], f = t.dataset.f;
    if (f === 'cities') c.cities = t.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    else if (f === 'code') { const old = c.code; c.code = t.value.trim().toUpperCase(); presets.forEach(p => { const i = p.countries.indexOf(old); if (i >= 0) p.countries[i] = c.code; }); store.savePresets(presets); const i = Q.countries.indexOf(old); if (i >= 0) Q.countries[i] = c.code; }
    else c[f] = t.value.trim();
    store.saveCountries(countries); renderFinder(); return;
  }
  if (t.id === 'importFile' && t.files && t.files[0]) {
    const r = new FileReader();
    r.onload = () => { try { store.importAll(JSON.parse(r.result)); setMsg('dataMsg', '导入成功，正在刷新…', 'ok'); setTimeout(() => location.reload(), 600); } catch (err) { setMsg('dataMsg', '导入失败：' + err.message, 'bad'); } };
    r.readAsText(t.files[0]); t.value = '';
  }
});
let noteT;
document.addEventListener('input', e => {
  if (e.target.id === 'mNotes' && openId) { const id = openId, v = e.target.value; clearTimeout(noteT); noteT = setTimeout(() => { patch(id, { notes: v }); toast('备注已保存'); }, 600); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => { if (controller) { e.preventDefault(); e.returnValue = ''; } });
// 从连接程序确认页切回来时，刷新连接状态
document.addEventListener('visibilitychange', () => { if (!document.hidden) { secrets = store.secrets(); settings = store.settings(); renderChrome(); } });

/* ================= 启动 ================= */
$('#ver').textContent = VERSION;
$('#repoLink').href = REPO_URL;
loadPreset(settings.activePresetId);
route();
detectProxy().finally(maybeAutoRun);

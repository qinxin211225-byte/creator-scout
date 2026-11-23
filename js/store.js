// 所有数据只存在用户自己的浏览器（localStorage）。
import { DEFAULT_COUNTRIES, DEFAULT_GROUPS, DEFAULT_PRESETS } from './config.js?v=0.3.7';

const K = {
  creators: 'scout.creators.v1',
  runs: 'scout.runs.v1',
  settings: 'scout.settings.v1',
  presets: 'scout.presets.v1',
  groups: 'scout.groups.v1',
  countries: 'scout.countries.v1',
  secret: 'scout.secret.v1',
  seen: 'scout.seen.v1',
  coverage: 'scout.coverage.v1',
};

function read(storage, key, fallback) {
  try { const v = storage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function write(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch (e) { console.warn('保存失败', e); return false; }
}
const L = () => window.localStorage;
const S = () => window.sessionStorage;
const clone = v => JSON.parse(JSON.stringify(v));

export const DEFAULT_SETTINGS = {
  provider: 'deepseek', baseUrl: '', model: '', proxy: '',
  rememberKey: true,
  auto: { enabled: false, presetId: 'example-asia', lastDate: '' },
  activePresetId: 'example-asia',
};

export const store = {
  creators: () => read(L(), K.creators, []),
  saveCreators: list => write(L(), K.creators, list),
  runs: () => read(L(), K.runs, []),
  saveRuns: list => write(L(), K.runs, list.slice(0, 200)),

  // 看过但没收录的账号（不合格或重复），下次告诉 AI 别再推荐；最多记 5000 个
  seen: () => read(L(), K.seen, []),
  addSeen(items) {
    if (!items.length) return;
    const all = read(L(), K.seen, []);
    const keys = new Set(all.map(x => x.platform + ':' + x.username));
    for (const it of items) if (!keys.has(it.platform + ':' + it.username)) { all.push(Object.assign({ at: new Date().toISOString() }, it)); keys.add(it.platform + ':' + it.username); }
    write(L(), K.seen, all.slice(-5000));
  },
  removeSeen(platform, username) { write(L(), K.seen, read(L(), K.seen, []).filter(x => !(x.platform === platform && x.username === username))); },
  // 每个“国家|人群|城市”上次搜索的时间，下次优先搜没搜过的城市
  coverage: () => read(L(), K.coverage, {}),
  touchCoverage(key) { const c = read(L(), K.coverage, {}); const v = c[key]; c[key] = [Date.now(), (Array.isArray(v) ? v[1] : v ? 1 : 0) + 1]; write(L(), K.coverage, c); },

  settings: () => Object.assign(clone(DEFAULT_SETTINGS), read(L(), K.settings, {})),
  saveSettings: s => write(L(), K.settings, s),

  presets: () => read(L(), K.presets, null) || clone(DEFAULT_PRESETS),
  savePresets: p => write(L(), K.presets, p),
  groups: () => read(L(), K.groups, null) || clone(DEFAULT_GROUPS),
  saveGroups: g => write(L(), K.groups, g),
  countries: () => read(L(), K.countries, null) || clone(DEFAULT_COUNTRIES),
  saveCountries: c => write(L(), K.countries, c),

  // 密钥：勾选“记住”存 localStorage，否则只存在当前标签页（sessionStorage）
  secrets: () => Object.assign({}, read(S(), K.secret, {}), read(L(), K.secret, {})),
  saveSecrets(secrets, remember) {
    try { L().removeItem(K.secret); S().removeItem(K.secret); } catch (e) {}
    return write(remember ? L() : S(), K.secret, secrets);
  },

  exportAll() {
    return {
      app: 'scout', exported_at: new Date().toISOString(),
      creators: this.creators(), runs: this.runs(), presets: this.presets(), seen: this.seen(), coverage: this.coverage(),
      groups: this.groups(), countries: this.countries(), settings: this.settings(),
    };
  },
  importAll(data) {
    if (!data || data.app !== 'scout') throw new Error('这不是 Scout 的备份文件');
    if (Array.isArray(data.creators)) this.saveCreators(data.creators);
    if (Array.isArray(data.runs)) this.saveRuns(data.runs);
    if (Array.isArray(data.presets)) this.savePresets(data.presets);
    if (Array.isArray(data.groups)) this.saveGroups(data.groups);
    if (Array.isArray(data.countries)) this.saveCountries(data.countries);
    if (Array.isArray(data.seen)) write(L(), K.seen, data.seen);
    if (data.coverage && typeof data.coverage === 'object') write(L(), K.coverage, data.coverage);
    if (data.settings) this.saveSettings(Object.assign(this.settings(), data.settings));
  },
  clearAll() {
    try { Object.values(K).forEach(k => { L().removeItem(k); S().removeItem(k); }); } catch (e) {}
  },
};

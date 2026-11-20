// Scout 默认配置。用户在「设置」里改的内容保存在自己的浏览器，不会改这个文件。
// 想给所有人换默认值（比如加一个国家），改这里再提交即可。

export const VERSION = '0.3.2';
export const REPO_URL = 'https://github.com/qinxin211225-byte/creator-scout';

export const PLATFORMS = {
  instagram: { label: 'Instagram', url: u => `https://www.instagram.com/${encodeURIComponent(u)}/`, site: 'instagram.com' },
  tiktok:    { label: 'TikTok',    url: u => `https://www.tiktok.com/@${encodeURIComponent(u)}`,  site: 'tiktok.com' },
  youtube:   { label: 'YouTube',   url: u => `https://www.youtube.com/@${encodeURIComponent(u)}`, site: 'youtube.com' },
};

// 平台标签：第一版只开放 Instagram，其他平台以后加（每个平台有自己的界面风格）
export const PLATFORM_TABS = [
  { id: 'instagram', label: 'Instagram', ready: true },
  { id: 'tiktok', label: 'TikTok', ready: false },
  { id: 'x', label: 'X', ready: false },
  { id: 'youtube', label: 'YouTube', ready: false },
];

export const FAN_PRESETS = [
  { id: '1-10', label: '1万–10万', min: 10000, max: 100000 },
  { id: '1-3', label: '1万–3万', min: 10000, max: 30000 },
  { id: '3-5', label: '3万–5万', min: 30000, max: 50000 },
  { id: '5-10', label: '5万–10万', min: 50000, max: 100000 },
];

// 每次找多少位；0 = 不限（所有组合、城市、搜法都试一遍，直到找不到新的或手动停止）
export const LIMITS = [
  { v: 10, label: '10 位' }, { v: 30, label: '30 位' }, { v: 50, label: '50 位' }, { v: 0, label: '不限' },
];

export const CATEGORIES = {
  lifestyle: '生活日常', vlog: 'Vlog', family: '家庭育儿', food: '美食', travel: '旅行',
  beauty: '美妆', fashion: '穿搭', fitness: '健身', other: '其他',
};
export const LIFESTYLE = ['lifestyle', 'vlog', 'family'];

export const STATUSES = [
  { key: 'new', zh: '待看' }, { key: 'saved', zh: '收藏' }, { key: 'contacted', zh: '已联系' },
  { key: 'replied', zh: '已回复' }, { key: 'partnered', zh: '合作' }, { key: 'dropped', zh: '放弃' },
];

export const CAMERA = { require: '必须出镜', prefer: '优先出镜', any: '不限' };

// 国家：code 用两位国家代码；cities 用英文名（搜索时更准）
export const DEFAULT_COUNTRIES = [
  { code: 'AU', name: '澳大利亚', cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Canberra'] },
  { code: 'CA', name: '加拿大', cities: ['Toronto', 'Vancouver', 'Calgary', 'Edmonton', 'Montreal', 'Ottawa', 'Winnipeg', 'Brampton', 'Mississauga', 'Surrey'] },
  { code: 'US', name: '美国', cities: ['Los Angeles', 'New York', 'Miami', 'Houston', 'Chicago', 'Dallas', 'San Antonio', 'Phoenix', 'San Diego', 'Orlando'] },
  { code: 'GB', name: '英国', cities: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow'] },
  { code: 'NZ', name: '新西兰', cities: ['Auckland', 'Wellington', 'Christchurch'] },
];

// 人群：hints 是给 AI 的识别线索和搜索关键词（只依据博主公开自述和内容语言，不看长相）
export const DEFAULT_GROUPS = [
  { id: 'indonesian', name: '印尼人', code: 'ID', hints: '印尼语内容；简介含 🇮🇩；anak rantau、orang indonesia di {city}、#diasporaindonesia' },
  { id: 'indian', name: '印度人', code: 'IN', hints: '印地语/旁遮普语内容；简介含 🇮🇳；desi in {city}、indian mom {city}、#desiabroad' },
  { id: 'thai', name: '泰国人', code: 'TH', hints: '泰语内容；简介含 🇹🇭；คนไทยใน{city}、thai in {city}' },
  { id: 'malaysian', name: '马来人', code: 'MY', hints: '马来语内容；简介含 🇲🇾；anak malaysia di {city}、#malaysianabroad' },
  { id: 'filipino', name: '菲律宾人', code: 'PH', hints: '他加禄语内容；简介含 🇵🇭；pinoy/pinay in {city}、#pinoyabroad' },
  { id: 'nepali', name: '尼泊尔人', code: 'NP', hints: '尼泊尔语内容；简介含 🇳🇵；nepali in {city}、#nepaliabroad' },
  { id: 'hongkong', name: '香港人', code: 'HK', hints: '粤语内容；简介含 🇭🇰 或“香港人”；港人移民 {city}、移民日常' },
  { id: 'colombian', name: '哥伦比亚人', code: 'CO', hints: '西班牙语内容；简介含 🇨🇴；colombiana en {city}、paisa、#colombianosenusa' },
  { id: 'mexican', name: '墨西哥人', code: 'MX', hints: '西班牙语内容；简介含 🇲🇽；mexicana en {city}、#mexicanosenusa' },
];

export const DEFAULT_PRESETS = [
  {
    id: 'example-asia', name: '示例：澳洲/加拿大的亚洲移民生活博主',
    countries: ['AU', 'CA'], groups: ['indonesian', 'indian', 'thai', 'malaysian', 'filipino', 'nepali', 'hongkong'],
    city: '', platforms: ['instagram'], fmin: 10000, fmax: 100000,
    camera: 'prefer', categories: ['lifestyle', 'vlog', 'family'], limit: 10,
  },
  {
    id: 'example-latam', name: '示例：美国的拉美移民生活博主',
    countries: ['US'], groups: ['colombian', 'mexican'],
    city: '', platforms: ['instagram'], fmin: 10000, fmax: 100000,
    camera: 'prefer', categories: ['lifestyle', 'vlog', 'family'], limit: 10,
  },
];

// 模型服务商。api 决定用哪种接口格式：
//   messages  = Anthropic Messages 格式（Claude；DeepSeek 也提供兼容地址）
//   responses = OpenAI Responses 格式（自带 web_search）
//   chat      = OpenAI Chat Completions 格式，联网靠 Tavily
export const PROVIDERS = {
  codex: {
    label: '本机 Codex', api: 'codex', search: 'codex',
    base: 'http://127.0.0.1:43219', model: 'Codex',
    keyUrl: '', note: '用你电脑上已登录的 Codex CLI 去找，结果传回网页。需要运行一个小的连接程序。',
  },
  deepseek: {
    label: 'DeepSeek', api: 'messages', search: 'deepseek',
    base: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys', note: '自带联网搜索，搜索不另收费。',
  },
  anthropic: {
    label: 'Claude（Anthropic）', api: 'messages', search: 'anthropic',
    base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5',
    keyUrl: 'https://platform.claude.com/settings/keys', note: '自带联网搜索（按次收费）。',
  },
  openai: {
    label: 'OpenAI', api: 'responses', search: 'openai',
    base: 'https://api.openai.com/v1', model: '',
    keyUrl: 'https://platform.openai.com/api-keys', note: '自带联网搜索。模型名填支持 web_search 的模型。',
  },
  compat: {
    label: '其他 OpenAI 兼容接口（通义千问、Kimi、智谱等）', api: 'chat', search: 'tavily',
    base: '', model: '',
    keyUrl: '', note: '这些接口没有统一的联网搜索，需要另外填一个 Tavily 搜索 key。',
  },
};

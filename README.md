# Scout · 开源找博主工作台

**[👉 打开网页直接使用](https://qinxin211225-byte.github.io/creator-scout/)**　|　[English](#english)

Scout 是一个找海外博主（KOL / 达人）的工作台。连接你自己的 AI（**电脑上的 Codex**，或者 **API Key**），选好国家、人群、粉丝区间和是否出镜，点「搜索」，AI 会联网帮你找到符合条件的个人博主，并整理成可以跟进的名单。

第一版专注 **Instagram**，界面也是 Instagram 风格。TikTok、X、YouTube 会陆续加入，每个平台有自己的风格。

- **不用安装，不用注册**：打开网页就能用，手机和电脑都可以。
- **数据只在你的浏览器里**：找到的博主、跟进备注、API Key 都保存在你自己的电脑上，不会上传到任何服务器。
- **用你自己的 AI**：一键连接电脑上已登录的 Codex；或者填 DeepSeek、Claude、OpenAI、通义千问、Kimi、智谱等的 API Key。
- **自动更新**：项目更新后，刷新网页就是最新版，你的数据不受影响。

---

## 三步开始

1. **打开网页**：点上面的链接。
2. **连接 AI**：进入「设置」，二选一：
   - **本机 Codex**：复制页面上的一段话发给 Codex，它会帮你装好并自动连上（详见下文）。
   - **API Key**：选服务商（推荐 DeepSeek，自带联网搜索），填 key，点「测试连接」。
3. **开始搜索**：回到「找博主」，选条件，点「搜索」。按钮会转圈，直到找完为止，进度会实时显示。

## 连接电脑上的 Codex

适合已经在用 Codex 的人。网页把搜索任务交给你电脑上的 Codex，Codex 联网找完再把结果传回网页。

准备：电脑上装好 Python 3.9+ 和 [Codex CLI](https://github.com/openai/codex)，并运行过 `codex login`。

打开网页「设置 → 本机 Codex」，点「复制，发给 Codex」，把这段话粘贴给 Codex（Codex 应用或终端里的 `codex`）。Codex 会先读一遍 [`scout_codex_bridge.py`](bridge/scout_codex_bridge.py) 确认安全，再装成后台服务，并自动打开浏览器连好网页。中途 Codex 问是否允许，点允许即可。

会用终端的话，也可以直接运行：

```bash
curl -fsSL https://qinxin211225-byte.github.io/creator-scout/bridge/install.sh | bash -s -- https://qinxin211225-byte.github.io/creator-scout/
```

只需要做一次：连接程序开机自动运行、出错自动重启，配对永久有效，以后不用再开终端。

自己手动装也可以：

```bash
python3 scout_codex_bridge.py --site https://qinxin211225-byte.github.io/creator-scout/ --install   # 安装后台服务
python3 ~/.scout/scout_codex_bridge.py --status       # 查看是否在运行
python3 ~/.scout/scout_codex_bridge.py --uninstall    # 卸载
python3 ~/.scout/scout_codex_bridge.py --site … --reset   # 作废旧配对，网页需重新连接
```

后台服务：Mac 用 launchd（`~/Library/LaunchAgents/com.scout.codexbridge.plist`），Linux 用 systemd 用户服务，Windows 用「启动」文件夹。日志在 `~/.scout/bridge.log`。

安全说明：
- 只监听本机 `127.0.0.1:43219`，只接受 `--site` 指定网站、并且带配对码的请求
- 配对码保存在 `~/.scout/codex_bridge_token`（只有你能读），不会打印到屏幕或日志
- 配对页只能用一次，配对成功后自动关闭；在新浏览器上配对需要先 `--reset`
- Codex 只用一种严格方式运行：只读沙箱，禁用命令执行、插件和应用，不读用户配置。Codex CLI 太旧不支持时直接报错，不会降级
- 不记录请求内容

浏览器不允许网站访问本机时：下载整个仓库，在仓库根目录运行
`python3 bridge/scout_codex_bridge.py --site http://127.0.0.1:43219/ --ui-dir . --connect`，会在本机打开同一个工作台并自动配对。

## 功能

| 功能 | 说明 |
|---|---|
| 搜索 | 国家、人群、粉丝区间、找多少（10 / 30 / 50 / 不限）、只要真人出镜、生活类优先；更多条件里有城市、常用条件 |
| 不重复 | 每轮换城市和搜法；已找到的和看过不合格的账号都会告诉 AI 不要再推荐；边找边保存，随时可以停止 |
| 每天自动找 | 打开开关后，每天第一次打开网页时自动按当前条件找一轮。网页关着时不会运行 |
| 博主卡片 | Instagram 主页风格：粉丝数、人群匹配度、是否出镜、简介、AI 的判断依据；一键收藏、标记不合适 |
| 我的名单 | 收藏 → 已联系 → 已回复 → 合作 / 放弃，可写备注，可导出 CSV，最近查找记录 |
| 去重 | 已经找到过的账号不会重复出现 |
| 可配置 | 人群、国家和城市都能在设置里增删改 |
| 备份 | 整个工作台可导出备份、导入恢复 |

## 支持的模型

| 服务商 | 联网搜索 | 说明 |
|---|---|---|
| 本机 Codex | 自带 | 用你电脑上已登录的 Codex CLI，需要运行连接程序 |
| DeepSeek（推荐） | 自带 | 搜索不另收费，只按 token 计费 |
| Claude（Anthropic） | 自带 | 搜索按次收费 |
| OpenAI | 自带 | 模型名请填支持 `web_search` 的模型 |
| 通义千问、Kimi、智谱等 OpenAI 兼容接口 | 需要 [Tavily](https://tavily.com) key | 在设置里选「其他 OpenAI 兼容接口」 |

### 提示「浏览器连不上这个服务」怎么办？

有的服务商不允许网页直接调用（跨域限制）。可以：

1. 换用 DeepSeek / Claude / OpenAI；或者
2. 部署一个自己的转发程序：把 [`proxy/worker.js`](proxy/worker.js) 部署到 Cloudflare Workers（免费），把地址填进「设置 → 高级：转发地址」。转发程序是你自己的，不保存任何数据；或者
3. 用 Cloudflare Workers 部署整个网站（见下文），转发会自动生效。

## 准确性说明

- 博主由 AI 联网搜索得到。每张卡片都附有 AI 的判断依据和来源链接，**联系前请点开主页确认**。
- AI 没在页面上看到确切粉丝数时，卡片会标「粉丝未核实」。
- 「是否出镜」根据 AI 看到的内容描述判断，可能不准。
- 粉丝区间、去重、人群匹配度门槛（低于 60% 不收录）由代码检查，不完全依赖 AI。

## 使用须知

- 只收集博主公开展示的信息。
- 判断人群只依据博主公开的自我介绍、内容语言和标签，**不根据长相、肤色或名字推断族裔**。
- 请遵守各平台的使用条款和当地隐私法规，不要用于批量私信、骚扰或出售名单。
- 费用由你选择的模型服务商直接向你收取。

## 部署自己的一份

想改代码或部署到自己的网址，有两种方式：

**GitHub Pages（最简单，免费）**

1. Fork 本仓库。
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`，保存。
3. 几分钟后访问 `https://你的用户名.github.io/仓库名/`。

**Cloudflare Workers（自带转发程序，跨域问题自动解决）**

```bash
npx wrangler login
npx wrangler deploy
```

部署后网站同域下会有 `/api/proxy`。浏览器直连服务商被拦截时，会自动改走它，用户不用做任何设置。它只转发到白名单里的模型服务商，只接受本站网页的请求，不保存任何数据。

**本地开发**

网页使用 ES 模块，需要通过本地服务器打开：

```bash
python3 -m http.server 8000
# 然后打开 http://localhost:8000
```

运行测试（需要 Node 22 和 Python 3.9 或更高版本）：

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p "test_*.py"
```

## 项目结构

```
index.html        页面结构
assets/app.css    样式
js/config.js      默认人群、国家、模板、模型服务商（想改默认值改这里）
js/store.js       浏览器本地存储
js/llm.js         各家大模型的调用
js/search.js      找博主流程：搜索、校验、去重、打分
js/app.js         界面逻辑
proxy/worker.js   转发程序（可单独部署成 Cloudflare Worker）
server/worker.mjs 整站部署到 Cloudflare Workers 时的入口
bridge/           本机 Codex 连接程序
tests/            自动化测试
```

## 参与贡献

欢迎提 Issue 和 Pull Request。比如：新的人群模板、更多平台、更多模型服务商、界面翻译。

## 许可证

[MIT](LICENSE)

---

<a id="english"></a>

## English

**Scout** is an open-source workbench for finding social media creators (KOLs). Bring your own LLM API key, pick countries, audience groups, platforms, follower range and on-camera preference, then hit **Search**. The AI searches the web and returns matching individual creators you can track and follow up with.

- **No install, no sign-up.** Just open the web page.
- **Your data stays in your browser.** Creators, notes and API keys are stored locally and never sent to any server other than your chosen model provider.
- **Bring your own AI:** one-click connect to the Codex CLI on your computer (via a small local bridge), or use an API key: DeepSeek (built-in web search), Claude, OpenAI, or any OpenAI-compatible API plus a Tavily search key.
- **Instagram first:** v1 focuses on Instagram with an Instagram-style UI; TikTok, X and YouTube will follow.
- **Auto search:** optionally run one search per day the first time you open the page.
- **Always up to date:** refresh the page to get the latest version.

**Quick start:** open the page → Settings → choose a provider and paste your API key → Test → go back to Discover, choose filters, click Search.

**Please use responsibly:** only public information is collected; audience groups are inferred only from creators' self-descriptions, content language and hashtags, never from appearance. Follow each platform's terms and local privacy laws.

License: MIT.

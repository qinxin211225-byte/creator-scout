# 博主雷达

在浏览器连接自己的模型，查找公开创作者、记录跟进状态和备注、导出 CSV。访客各用自己的额度，工作台没有共享管理员密码。

## 开始使用

打开网站，选择「模型连接」。OpenAI 支持带来源的联网搜索。DeepSeek 和支持 Chat Completions 的 HTTPS 服务可以直接审核粘贴的公开资料；如果希望自动联网找账号，需要额外填写自己的 Brave Search Key。先测试文本连接，再开始查找。模型返回的资料还要通过粉丝数、发帖日期和来源链接校验，搜索结果可能为空。

在线 Worker 将 OpenAI、DeepSeek 和 Brave 请求转发到对应的固定官方地址。密钥由浏览器随请求提交，应用不持久化密钥，也不记录请求内容。自定义服务的模型密钥直接发送到访客填入的地址，该服务须允许浏览器跨域访问。关闭或刷新页面后需重新输入密钥。账号、运行记录和跟进备注存在当前浏览器的站点存储中；不同浏览器配置文件各自独立，同一浏览器配置文件的使用者共享工作台。清除站点数据会清除记录。

## 使用访客自己的 Codex

在自己的电脑安装 Codex CLI 和 Python 3.9+，使用 `codex login` 登录。网页「本机 Codex」提供桥接程序下载及带站点来源的启动命令。在下载目录执行命令，在网页点击「一键连接 Codex」，然后在本机页面确认。手动输入配对码也可配对。配对码一小时有效，按 Ctrl+C 断开连接。浏览器询问本地网络访问时允许这个站点访问本机桥接。CLI 需要支持 exec、--json、--ephemeral、--ignore-user-config 与只读沙箱等选项。Windows 需要受所用 Codex CLI 支持的执行环境。

如果浏览器限制网站访问本机，下载并解压完整源码，在项目根目录运行以下命令，在本机同源工作台进行配对。它使用该本机地址的浏览器存储。

```sh
python3 dist/codex_bridge.py --origin http://127.0.0.1:43219 --ui-dir dist --connect
```

命令会打开本机工作台并自动填入配对码。保持桥接窗口开启。Codex 联网搜索仅采纳 CLI 搜索事件中可核对的来源；也可以选择「审核我提供的公开资料」。

## 自行部署

- **Cloudflare Workers**：从项目根目录运行 `npx wrangler login`、`npx wrangler deploy`。仓库内的 wrangler.jsonc 声明了静态目录和模型转发服务。部署无需站主提供模型 Key。
- **GitHub Pages 或其他静态站点**：部署 dist/ 下的 index.html、visitor.js、models.js 和 codex_bridge.py。纯静态站点直接访问供应商 API，能否成功取决于供应商的 CORS 策略。
- **本机预览**：在根目录执行 `python3 -m http.server 8000 --directory dist`，打开 http://localhost:8000 。支持 Python 的本机桥接模式见上。
- **运行适配器测试**：使用 Node 22 或更高版本，执行 `node --test tests/*.test.mjs`。

访客主动发起任务，浏览器内执行结果审核并保存。没有后台定时任务或跨设备同步。模型文本测试与实际联网搜索分别计入访客供应商账户的使用量。

## 许可证

MIT，见 LICENSE。

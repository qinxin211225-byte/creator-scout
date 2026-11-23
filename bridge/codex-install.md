# 给 Codex 的安装说明：Scout 本机 Codex 连接程序

用户想让 Scout 找博主网页调用这台电脑上的 Codex 去搜索博主。请帮用户安装连接程序，装好后它会开机自动运行，并自动连上网页。

- 网站地址（下面记作 SITE）：就是这份说明所在网址去掉 `bridge/codex-install.md` 的部分，例如 `https://qinxin211225-byte.github.io/creator-scout/`
- 程序：`SITE` + `bridge/scout_codex_bridge.py`（单个 Python 文件，可以先读一遍）

## 它做什么

- 只监听本机 `127.0.0.1:43219`，只接受来自 SITE 所在网站、并带配对码的请求
- 配对码存在 `~/.scout/codex_bridge_token`，不打印；配对页只能用一次
- 收到网页的搜索请求时，用只读沙箱运行 `codex exec` 做网页搜索，把结果传回网页
- `--install` 会把自己复制到 `~/.scout/`，设成开机自启（Mac：launchd；Linux：systemd 用户服务；Windows：启动文件夹）
- `--open` 装好后打开浏览器完成配对

## 安装步骤

需要 Python 3.9+ 和已登录的 `codex`。没有 Python 就先告诉用户，不要自己装。运行命令需要联网和设置开机启动，请向用户申请权限。

Mac / Linux：

```bash
mkdir -p ~/.scout && curl -fsSL SITEbridge/scout_codex_bridge.py -o ~/.scout/scout_codex_bridge.py && python3 ~/.scout/scout_codex_bridge.py --site SITE --install --open
```

Windows（PowerShell）：

```powershell
New-Item -ItemType Directory -Force "$HOME\.scout" | Out-Null; Invoke-WebRequest SITEbridge/scout_codex_bridge.py -OutFile "$HOME\.scout\scout_codex_bridge.py"; python "$HOME\.scout\scout_codex_bridge.py" --site SITE --install --open
```

（把 `SITE` 换成上面的网站地址。）

## 完成后

用简单的中文告诉用户结果。成功时会显示“✅ 全部完成”，浏览器会自动打开 Scout 并显示“已连接”。如果浏览器没打开，请用户回到 Scout 网页「设置 → 本机 Codex」点「没自动连上？点这里」。

查看状态：`python3 ~/.scout/scout_codex_bridge.py --status`　卸载：`python3 ~/.scout/scout_codex_bridge.py --uninstall`

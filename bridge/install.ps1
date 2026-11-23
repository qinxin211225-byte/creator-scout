# Scout 本机 Codex 连接程序 · 一行安装（Windows PowerShell）
# 用法：$env:SCOUT_SITE='https://你的网站/'; irm https://你的网站/bridge/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$site = if ($env:SCOUT_SITE) { $env:SCOUT_SITE } else { 'https://qinxin211225-byte.github.io/creator-scout/' }
if (-not $site.EndsWith('/')) { $site += '/' }
Write-Host 'Scout：正在安装本机 Codex 连接程序…'
$py = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) { Write-Host '❌ 需要 Python 3：请先从 python.org 安装（勾选 Add to PATH），再运行这行命令。'; return }
$dir = Join-Path $HOME '.scout'
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest "$($site)bridge/scout_codex_bridge.py" -OutFile (Join-Path $dir 'scout_codex_bridge.py') -UseBasicParsing
python (Join-Path $dir 'scout_codex_bridge.py') --site $site --install --open

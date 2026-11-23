#!/bin/bash
# Scout 本机 Codex 连接程序 · 一行安装（Mac / Linux）
# 用法：curl -fsSL https://你的网站/bridge/install.sh | bash -s -- https://你的网站/
set -e
SITE="${1:-${SCOUT_SITE:-https://qinxin211225-byte.github.io/creator-scout/}}"
case "$SITE" in */) ;; *) SITE="$SITE/" ;; esac
echo "Scout：正在安装本机 Codex 连接程序…"
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 需要 Python 3。Mac 可以先运行：xcode-select --install，装好后再运行这行命令。"
  exit 1
fi
mkdir -p "$HOME/.scout"
curl -fsSL "${SITE}bridge/scout_codex_bridge.py" -o "$HOME/.scout/scout_codex_bridge.py"
python3 "$HOME/.scout/scout_codex_bridge.py" --site "$SITE" --install --open

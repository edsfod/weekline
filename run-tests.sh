#!/usr/bin/env bash
# 运行全部测试：纯函数层（无头 Edge 打开 tests/test.html）与服务的计划文件读写（Python unittest）
cd "$(dirname "$0")"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
[ -x "$EDGE" ] || EDGE="/c/Program Files/Google/Chrome/Application/chrome.exe"
URL="file:///$(pwd -W)/tests/test.html"
PROFILE="$(mktemp -d)"
echo "== 纯函数层（tests/test.html）"
"$EDGE" --headless=new --disable-gpu --no-first-run --user-data-dir="$(cygpath -w "$PROFILE")" --virtual-time-budget=5000 --dump-dom "$URL" 2>/dev/null \
  | sed -n '/<pre id="out">/,/<\/pre>/p' | sed -e 's/<pre id="out">//' -e 's/<\/pre>.*//' -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&amp;/\&/g' -e 's/&quot;/"/g'
rm -rf "$PROFILE"
echo "== 服务（tests/test_server.py）"
PY="$(powershell -NoProfile -ExecutionPolicy Bypass -File web-kit/find-python.ps1 -Console | tr -d '\r')"
[ -n "$PY" ] || { echo "找不到 Python 3.8+"; exit 1; }
"$PY" tests/test_server.py

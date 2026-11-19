#!/bin/zsh
# Usage: run-a85.sh <attempt-name>. Real DeepSeek via isolated loopback relay; synthetic data only.
set -eu
base=/private/tmp/willyou-m14-stage6.WRvdST
here="$base/g03/claude-prep-1214412aa"
bin="$base/package/mac-arm64/WillYou.app/Contents/MacOS/WillYou"
commit=${M14_COMMIT:-1214412aad05bb629e1d9ce7d532755195fe4dca}
test "$(shasum -a 256 "$base/package/mac-arm64/WillYou.app/Contents/Resources/app.asar" | cut -d ' ' -f1)" = ${M14_ASAR:-023e1f888ae4aacee33642555cef939c3a739666b17a11eb8cdacab6c7eec901}
: "${DEEPSEEK_API_KEY:?missing}"
out="$base/g03/$1"; test ! -e "$out"
if lsof -nP -iTCP:3425 -sTCP:LISTEN >/dev/null; then echo "port busy"; exit 125; fi
if lsof -nP "$bin" >/dev/null 2>&1; then echo "package running"; exit 125; fi
set +e
M14_LIVE_DEEPSEEK_KEY="$DEEPSEEK_API_KEY" env -u DEEPSEEK_API_KEY -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  -u OPENAI_BASE_URL -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_OAUTH_TOKEN -u CODEX_API_KEY \
  M14_X1_AUTH="${M14_X1_AUTH:-}" M14_ACCEPTANCE_APP="$bin" M14_SMOKE_CLAUDE='/Users/liubu/.local/share/claude/versions/2.1.326' \
  node "$here/a85-live.mjs" "$out" "$commit" >"$out.console.log" 2>&1
code=$?
set -e
echo "exit $1 $code"
python3 "$here/summarize.py" "$out/result.json"

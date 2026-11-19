#!/bin/zsh
# Usage: run.sh <attempt-name> <scenario>   e.g. run.sh claude-attempt-001 a82
set -eu
base=/private/tmp/willyou-m14-stage6.WRvdST
here="$base/g03/claude-prep-1214412aa"
bundle="$base/package/mac-arm64/WillYou.app"
bin="$bundle/Contents/MacOS/WillYou"
expected_asar=${M14_ASAR:-023e1f888ae4aacee33642555cef939c3a739666b17a11eb8cdacab6c7eec901}
commit=${M14_COMMIT:-1214412aad05bb629e1d9ce7d532755195fe4dca}
test "$(cat "$base/source-commit.txt")" = "$commit"
test "$(shasum -a 256 "$bundle/Contents/Resources/app.asar" | cut -d ' ' -f1)" = "$expected_asar"
node --check "$here/shared-review-packaged.mjs"
out="$base/g03/$1"
test ! -e "$out"
if lsof -nP -iTCP:3425 -sTCP:LISTEN >/dev/null; then echo "port 3425 busy"; exit 125; fi
if lsof -nP "$bin" >/dev/null 2>&1; then echo "package already running"; exit 125; fi
set +e
env -u DEEPSEEK_API_KEY -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u OPENAI_BASE_URL \
  -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_OAUTH_TOKEN -u CODEX_API_KEY \
  M14_ACCEPTANCE_APP="$bin" M14_SMOKE_CLAUDE='/Users/liubu/.local/share/claude/versions/2.1.326' \
  node "$here/shared-review-packaged.mjs" "$out" "$2" "$commit" >"$out.console.log" 2>&1
code=$?
set -e
echo "exit $1 $2 $code"
if lsof -nP "$bin" >/dev/null 2>&1; then echo "WARNING: package still running"; fi
python3 -c "import json,sys;r=json.load(open(sys.argv[1]));print(r['status'],r.get('phase'),(r.get('error') or '')[:600]);print('exit',r.get('exit'),'renderer',r.get('rendererErrors'))" "$out/result.json"

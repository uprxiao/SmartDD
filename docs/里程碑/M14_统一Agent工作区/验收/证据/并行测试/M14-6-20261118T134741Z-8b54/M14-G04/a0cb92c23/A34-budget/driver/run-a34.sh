#!/bin/zsh
set -u
# usage: run-a34.sh <attempt-number> <seed|pressure|disk|enterprise> [source-attempt-number]
workspace=/private/tmp/willyou-m14-stage6.WRvdST/g04
candidate=${workspace:h}
app="$candidate/package/mac-arm64/WillYou.app/Contents/MacOS/WillYou"
asar="$candidate/package/mac-arm64/WillYou.app/Contents/Resources/app.asar"
commit=$(cat "$candidate/source-commit.txt")
sha=${A34_ASAR:?need A34_ASAR}
[[ "$(shasum -a 256 "$asar" | cut -d ' ' -f1)" == "$sha" ]] || { print -u2 'asar mismatch'; exit 65; }
lsof -nP -iTCP:3425 -sTCP:LISTEN && { print -u2 'port 3425 busy'; exit 66; }
lsof -nP "$app" >/dev/null 2>&1 && { print -u2 'test App already running'; exit 66; }
printf -v slot "attempt-%03d" "$1"
out="$workspace/$slot"; [[ -e "$out" ]] && { print -u2 'attempt exists'; exit 67; }
src=()
if [[ $# -eq 3 ]]; then printf -v s "attempt-%03d" "$3"; src=("$workspace/$s"); fi
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u CODEX_API_KEY -u OPENAI_API_KEY -u DEEPSEEK_API_KEY \
  M14_ACCEPTANCE_COMMIT="$commit" A34_ENTERPRISE_PATH="<用户指定的企业 SVN 工作副本>" \
  node "$workspace/prep-a34/a34-budget.mjs" "$app" "$out" "$sha" "$2" "${src[@]}" > "$out.console.log" 2>&1
code=$?
print "A34 $2 $slot exited $code"
lsof -nP -iTCP:3425 -sTCP:LISTEN && { print -u2 'listener left'; exit 66; }
exit $code

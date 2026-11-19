#!/bin/zsh
set -eu
m14_root=/private/tmp/willyou-m14-stage6.WRvdST
m14_source=9a9da26a785ef3b4bb35ad1d757bfb0cdbcad030
[[ $# = 1 && "$1" =~ '^[a-zA-Z0-9][a-zA-Z0-9-]{0,32}$' ]]
m14_attempt="$m14_root/m13-before-cleanup-9a9da26a7-$1"
m14_log="$m14_root/m13-full-9a9da26a7-$1.log"
[[ ! -e "$m14_attempt" && ! -e "$m14_log" ]]
[[ "$(cat "$m14_root/source-commit.txt")" = "$m14_source" ]]
if lsof -nP -iTCP:3425 -sTCP:LISTEN >/dev/null; then exit 25; fi
if lsof -nP -iTCP:3426 -sTCP:LISTEN >/dev/null; then exit 26; fi
cd "$m14_root/source"
[[ "$(git rev-parse HEAD)" = "$m14_source" ]]
[[ -z "$(git status --porcelain --untracked-files=no)" ]]
[[ -f 'docs/里程碑/M13_应用Skill与MCP插件化重构/技研/实验/A5_插件声明_20261110/zentao-plugin/.willyou-plugin/plugin.json' ]]
mkdir -m 700 "$m14_attempt"
mkdir -m 700 "$m14_attempt/home" "$m14_attempt/tmp"
/usr/bin/env -i PATH='/Users/liubu/.hermes/node/bin:/Users/liubu/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
  HOME="$m14_attempt/home" TMPDIR="$m14_attempt/tmp" LANG='en_US.UTF-8' TZ='Asia/Singapore' \
  CI=1 /usr/bin/caffeinate -i /Users/liubu/.hermes/node/bin/node scripts/run-tests.mjs src/main/core/applications --maxWorkers=2 --reporter=verbose > "$m14_log" 2>&1 || {
  m14_rc=$?
  tail -36 "$m14_log"
  exit "$m14_rc"
}
tail -10 "$m14_log"

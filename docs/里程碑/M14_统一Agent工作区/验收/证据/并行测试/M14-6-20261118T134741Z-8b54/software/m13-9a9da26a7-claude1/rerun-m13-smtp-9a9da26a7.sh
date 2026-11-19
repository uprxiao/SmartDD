#!/bin/zsh
set -eu
m14_root=/private/tmp/willyou-m14-stage6.WRvdST
m14_src=9a9da26a785ef3b4bb35ad1d757bfb0cdbcad030
m14_rerun="$m14_root/m13-smtp-retake-9a9da26a7"
m14_log="$m14_root/m13-smtp-retake-9a9da26a7.log"
[[ ! -e "$m14_rerun" && ! -e "$m14_log" ]]
[[ "$(cat "$m14_root/source-commit.txt")" = "$m14_src" ]]
cd "$m14_root/source"
[[ "$(git rev-parse HEAD)" = "$m14_src" ]]
[[ -z "$(git status --porcelain --untracked-files=no)" ]]
mkdir -m 700 "$m14_rerun"
mkdir -m 700 "$m14_rerun/home" "$m14_rerun/tmp"
/usr/bin/env -i PATH='/Users/liubu/.hermes/node/bin:/Users/liubu/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
  HOME="$m14_rerun/home" TMPDIR="$m14_rerun/tmp" LANG='en_US.UTF-8' TZ='Asia/Singapore' \
  CI=1 /usr/bin/caffeinate -i /Users/liubu/.hermes/node/bin/node scripts/run-tests.mjs \
  src/main/core/applications/__tests__/mail-send-data.test.ts --maxWorkers=1 --reporter=verbose \
  -t 'rotates during a real in-flight SMTP send, uses fresh authentication for the next send, and never replays the old unknown result' > "$m14_log" 2>&1 || {
  m14_rc=$?
  tail -35 "$m14_log"
  exit "$m14_rc"
}
tail -10 "$m14_log"

#!/bin/zsh
set -eu
base=/private/tmp/willyou-m14-stage6.WRvdST
suite="$base/g03"
driver="$suite/prep-next/a67-tier-matrix-r3/a67-packaged.mjs"
binary="$base/package/mac-arm64/WillYou.app/Contents/MacOS/WillYou"
asar="$base/package/mac-arm64/WillYou.app/Contents/Resources/app.asar"
[[ "$#" -eq 5 && "$1" == attempt-[0-9][0-9][0-9] ]] || exit 64
[[ "$2" == claude || "$2" == codex ]] || exit 64
[[ "$3" == ordinary || "$3" == linked ]] || exit 64
[[ "$4" == clean || "$4" == conflict || "$4" == overlap || "$4" == leave || "$4" == staged || "$4" == reject ]] || exit 64
[[ "$5" == ask || "$5" == auto || "$5" == full ]] || exit 64
[[ "$5" != auto || "$2" == codex ]] || exit 64
[[ "$4" != reject || "$5" == ask ]] || exit 64
if [[ "$5" == full && "${M14_A67_CONFIRM_AUTHORIZED_FULL:-0}" != 1 ]]; then
  print -u2 'A67 full-access row awaits separately documented explicit user authorization'
  exit 65
fi
: "${M14_EXPECTED_SOURCE_COMMIT:?Coordinator candidate commit required}"
: "${M14_EXPECTED_ASAR_SHA256:?Coordinator exact ASAR hash required}"
: "${M14_SMOKE_CLAUDE:=/Users/liubu/.local/share/claude/versions/2.1.326}"
test "$(pwd -P)" = "$base/source"
test "$(git rev-parse HEAD)" = "$M14_EXPECTED_SOURCE_COMMIT"
test "$(shasum -a 256 "$asar" | cut -d ' ' -f1)" = "$M14_EXPECTED_ASAR_SHA256"
test ! -e "$suite/$1"
test ! -e "$suite/$1.console.log"
node --check "$driver"
node "$base/source/scripts/lib/check-cdp-expressions.mjs" "$driver"
assert_idle() {
  if lsof -nP -iTCP:3425 -sTCP:LISTEN; then return 125; fi
  if lsof -nP "$binary"; then return 125; fi
}
assert_idle
set +e
env -i PATH="$PATH" LANG=en_US.UTF-8 M14_SMOKE_CLAUDE="$M14_SMOKE_CLAUDE" \
  M14_A67_CONFIRM_AUTHORIZED_FULL="${M14_A67_CONFIRM_AUTHORIZED_FULL:-0}" \
  node "$driver" "$suite/$1" "$M14_EXPECTED_SOURCE_COMMIT" "$M14_EXPECTED_ASAR_SHA256" "$2" "$3" "$4" "$5" >"$suite/$1.console.log" 2>&1
code=$?
set -e
printf 'A67 %s %s %s %s %s exited %s\n' "$1" "$2" "$3" "$4" "$5" "$code"
assert_idle
exit "$code"

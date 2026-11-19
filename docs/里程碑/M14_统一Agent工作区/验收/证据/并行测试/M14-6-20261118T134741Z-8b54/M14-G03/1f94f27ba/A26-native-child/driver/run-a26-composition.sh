#!/bin/zsh
set -eu
base=/private/tmp/willyou-m14-stage6.WRvdST
suite="$base/g03"
driver="$suite/prep-next/a26-native-composition/a26-request-composition.mjs"
binary="$base/package/mac-arm64/WillYou.app/Contents/MacOS/WillYou"
asar="$base/package/mac-arm64/WillYou.app/Contents/Resources/app.asar"
[[ "$#" -eq 1 && "$1" == attempt-<-> ]] || exit 64
: "${M14_EXPECTED_SOURCE_COMMIT:?Need the coordinator frozen source commit}"
: "${M14_EXPECTED_ASAR_SHA256:?Need the coordinator exact candidate ASAR hash}"
: "${M14_SMOKE_CLAUDE:=/Users/liubu/.local/share/claude/versions/2.1.326}"
test "$(pwd -P)" = "$base/source"
test "$(cat "$base/source-commit.txt")" = "$M14_EXPECTED_SOURCE_COMMIT"
test "$(shasum -a 256 "$asar" | cut -d ' ' -f1)" = "$M14_EXPECTED_ASAR_SHA256"
test -x "$M14_SMOKE_CLAUDE"
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
env -i PATH="$PATH" LANG=en_US.UTF-8 M14_ACCEPTANCE_APP="$binary" M14_SMOKE_CLAUDE="$M14_SMOKE_CLAUDE" M14_EXPECTED_ASAR_SHA256="$M14_EXPECTED_ASAR_SHA256" \
  node "$driver" "$suite/$1" "$M14_EXPECTED_SOURCE_COMMIT" > "$suite/$1.console.log" 2>&1
code=$?
set -e
printf 'A26 composed requests %s exited %s\n' "$1" "$code"
assert_idle
exit "$code"

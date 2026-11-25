#!/bin/bash
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")" && pwd -P)"
[[ "$root" == /private/tmp/willyou-m16-E03E05.* ]]
cd "$root/source"
shared="/Users/liubu/hx/4.uprxiao/SmartDD/node_modules"
node_bin=$(dirname -- "$(command -v node)")
codex="/Users/liubu/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex"
claude="/Users/liubu/.local/bin/claude"
agy="/Users/liubu/.local/bin/agy"
runner="$shared/electron/dist/Electron.app/Contents/MacOS/Electron"
selection="${1:-codex,claude,antigravity}"
exec env -i HOME="$root/host-home" TMPDIR="$root/tmp" XDG_CACHE_HOME="$root/cache" PATH="$node_bin:/usr/bin:/bin:/usr/sbin:/sbin" ELECTRON_RUN_AS_NODE=1 WILLYOU_TEST_CACHE_DIR="$root/cache" M16_E03_E05_ROOT="$root" M16_SELECTION="$selection" M16_NODE_BIN="$node_bin" M16_CODEX="$codex" M16_CLAUDE="$claude" M16_AGY="$agy" "$runner" "$shared/vitest/vitest.mjs" run src/main/core/agent/m16-schedule-preflight.test.ts --maxWorkers=1 --no-file-parallelism

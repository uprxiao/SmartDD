#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
case "$root" in /private/tmp/willyou-m16-e06-e09.*) ;; *) echo 'Unexpected frozen experiment root' >&2; exit 1;; esac
test "$(cat "$root/baseline-commit.txt")" = a0acddb3a2325c6bf732adaa7e954ce4d767a2c3
replay=$(mktemp -d /private/tmp/wm16e06r.XXXXXXXX)
mkdir -p "$replay/home" "$replay/tmp" "$replay/cache" "$replay/logs"
cd "$root/source"
run_test() {
  label=$1; shift
  env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
    HOME="$replay/home" TMPDIR="$replay/tmp" \
    XDG_CONFIG_HOME="$replay/home/config" XDG_CACHE_HOME="$replay/cache" \
    WILLYOU_TEST_CACHE_DIR="$replay/cache/vite-$label" \
    WILLYOU_TEST_EVIDENCE_DIR="$replay/logs/mail-evidence" \
    GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 \
    npm_config_offline=true npm_config_audit=false npm_config_fund=false npm_config_cache="$replay/cache/npm" \
    node scripts/run-tests.mjs --maxWorkers 1 --reporter verbose "$@" > "$replay/logs/$label.log" 2>&1
}
printf 'Replay root: %s\n' "$replay"
run_test e06-baseline src/main/core/agent/git-workspaces.test.ts src/main/core/files/agent-sources.test.ts
run_test e06-project-rpc src/main/core/agent/project-resources.test.ts -t 'G4 resolves registered cwd'
run_test e09-baseline src/main/core/applications/__tests__/agent-business-tools.test.ts src/main/core/agent/host-business-requests.test.ts src/main/core/agent/business-browser.test.ts src/main/core/agent/capabilities-permissions.test.ts src/main/core/agent/delegation-service.test.ts
run_test e06-e09-new src/main/core/agent/m16-e06-private.test.ts src/main/core/agent/m16-e09-agent-origin.private.test.ts src/main/core/agent/m16-e09-delegation.private.test.ts src/main/core/capabilities/m16-e09-global-projection.private.test.ts -t 'F16 E0[69]'
run_test e06-e09-scope-with-notification src/main/core/browser/__tests__/m16-scope-candidate.private.test.ts src/renderer/core/m16-e09-notification.private.test.ts
run_test e09-scheduled-browser-candidate src/main/core/agent/m16-e09-browser-origin.private.test.ts
run_test e09-projections src/main/core/capabilities/skill-projection.test.ts src/main/core/capabilities/mcp-projection.test.ts -t 'discovers Antigravity Skills|projects a user Skill|native-login Claude|supports a real worktree|builds process-only|cancel/disable'
run_test e09-mail src/main/core/applications/__tests__/mail-effect-boundary.test.ts src/main/core/applications/__tests__/mail-execution.test.ts -t 'preflight installs frozen|known precondition|freezes BCC|persists the claim|retiring a task request'
# These last two commands need the host OS's normal native process/Unix socket
# facilities and application's own sandbox. Run under standard allowed native
# test execution. No external sites, GUI, real mail provider or daily data.
run_test e09-external-plugin src/main/core/applications/plugins/__tests__/session-tools.test.ts -t 'requires exact current-window review|executes only the approved input once|invalidates an old account'
run_test e09-native-cli-mcp src/main/core/applications/plugins/__tests__/session-tools.test.ts -t 'uses the real signed native CLI|executes mcp via the common host service|executes cli via the common host service'
printf 'Completed: %s\n' "$replay"

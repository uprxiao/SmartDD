#!/bin/zsh
set -euo pipefail
RUN=/private/tmp/willyou-m11-c8-t25read
SRC=/private/tmp/willyou-m11-c8-t25read/src
mkdir -p "$RUN/home" "$RUN/cache" "$RUN/out"
cd "$SRC"
exec /usr/bin/env -i \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin \
  TMPDIR="$RUN" \
  HOME="$RUN/home" \
  WILLYOU_TEST_CACHE_DIR="$RUN/cache" \
  WILLYOU_M11_ZEN_MODE=unknown-mcp \
  WILLYOU_ACCEPTANCE_APP=/private/tmp/willyou-m11-s7/package-c7-attempt-001/mac-arm64/WillYou.app/Contents/MacOS/WillYou \
  WILLYOU_ACCEPTANCE_ASAR_SHA=b87809c74aa2e4d9750710a053af71b9b96dd6f355790db3879384d18bd39b42 \
  WILLYOU_TEST_SOURCE_MANIFEST_SHA=42e08ed9d1915a8d357e37349fcc456ea5d0e9e2d7b92c9b589e137f8866a5b9 \
  WILLYOU_CODEX_CLI=/Users/hx/.codex/packages/app-server-daemon/releases/0.166.0-aarch64-apple-darwin/bin/codex \
  /opt/homebrew/bin/node scripts/applications/m11-zen-cli-ui.mjs

#!/bin/zsh
set -euo pipefail
: "${WILLYOU_ACCEPTANCE_APP:?Require coordinator C7 T25 variant executable}"
: "${WILLYOU_ACCEPTANCE_ASAR_SHA:?Require coordinator variant ASAR SHA256}"
: "${WILLYOU_T25_VARIANT_DIFF_MANIFEST:?Require generated data difference manifest}"
: "${WILLYOU_T25_VARIANT_DIFF_SHA:?Require data difference manifest SHA256}"
cd '/private/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-M11-C7-20261101T191439Z-e388-afkggf6b/t25-worker-attempt003'
exec /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin TMPDIR=/private/tmp HOME='/private/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-M11-C7-20261101T191439Z-e388-afkggf6b/t25-worker-attempt003/driver-home' WILLYOU_TEST_CACHE_DIR='/private/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-M11-C7-20261101T191439Z-e388-afkggf6b/t25-private-vite-cache' WILLYOU_ACCEPTANCE_APP="$WILLYOU_ACCEPTANCE_APP" WILLYOU_ACCEPTANCE_ASAR_SHA="$WILLYOU_ACCEPTANCE_ASAR_SHA" WILLYOU_T25_VARIANT_DIFF_MANIFEST="$WILLYOU_T25_VARIANT_DIFF_MANIFEST" WILLYOU_T25_VARIANT_DIFF_SHA="$WILLYOU_T25_VARIANT_DIFF_SHA" WILLYOU_TEST_SOURCE_MANIFEST_SHA=42e08ed9d1915a8d357e37349fcc456ea5d0e9e2d7b92c9b589e137f8866a5b9 WILLYOU_CODEX_CLI=/Users/hx/.codex/packages/app-server-daemon/releases/0.166.0-aarch64-apple-darwin/bin/codex /opt/homebrew/bin/node scripts/applications/m11-t25-ui.mjs

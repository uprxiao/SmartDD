#!/bin/sh
set -eu
[ "${SMARTDD_USER_DATA-}" = '/private/tmp/willyou-m12-t145-cert-sites24-prep-004/runtime-001/userdata' ] || exit 70
exec '/private/tmp/willyou-m12-s2-package-048/mac-arm64/WillYou.app/Contents/MacOS/WillYou' '--host-resolver-rules=MAP m12-cert.test 127.0.0.1' '--no-proxy-server' "$@"

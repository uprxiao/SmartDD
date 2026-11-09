#!/bin/sh
set -eu
[ "${SMARTDD_USER_DATA-}" = '/private/tmp/willyou-m12-t017-App025-AI-001/runtime-001/userdata' ] || exit 70
exec '/private/tmp/willyou-m12-app025-installer-001/Installed Applications/WillYou.app/Contents/MacOS/WillYou' '--host-resolver-rules=MAP m12-cert.test 127.0.0.1' '--no-proxy-server' "$@"

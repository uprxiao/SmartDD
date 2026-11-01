#!/bin/sh
# S0a 联网边界补验（由用户本人运行）。每个用例各调用一次 codex exec（各 1 次真实模型调用），只用假数据。
# 目的：确认“放行单个 Unix socket”的配置没有顺带放开对外联网，并确认放行 A 不会放行 B。
#   E2b  放行本宿主 socket        期望：channel.connected=true，ok=true；externalTcp443 应为 ERR:*/TIMEOUT（联网仍被阻止）
#   E3neg 放行的是别的路径        期望：channel.connected=false（EPERM）；externalTcp443 同上
# 探针只做 TCP 握手，不发送任何内容；结果写入 results/。
cd "$(dirname "$0")" || exit 1
CFG_BASE='"default_permissions=\"wy\"","permissions.wy.extends=\":read-only\"","permissions.wy.network.enabled=true","features.network_proxy=true"'
echo "== E2b：放行本宿主 socket =="
S0A_CFG="[$CFG_BASE,\"permissions.wy.network.unix_sockets={\\\"<SOCK>\\\"=\\\"allow\\\"}\"]" node run.mjs none E2b | python3 show.py
echo "== E3neg：放行的是另一个路径 =="
S0A_CFG="[$CFG_BASE,\"permissions.wy.network.unix_sockets={\\\"/tmp/some-other.sock\\\"=\\\"allow\\\"}\"]" node run.mjs none E3neg | python3 show.py

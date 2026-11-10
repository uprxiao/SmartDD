#!/bin/sh
# WillYou MCP stdio 启动包装 v3（补验 C1，修正审核三 G01）：
#   wy-mcp-launch.sh [--cwd DIR] [--set TARGET=SRCVAR]... [--arg INDEX=SRCVAR]... [--unset NAME]... [--unset-prefix PREFIX]... -- CMD [ARG]...
# 控制信息只来自 "--" 之前的选项；CMD 之后的参数一律当数据原样传递，不识别任何标记。
# --arg INDEX=SRCVAR：把 CMD 之后第 INDEX 个参数（从 0 起）替换为 SRCVAR 的值；SRCVAR 与 --set 的来源都必须是 WY_MCPV_ 私有槽。
# 顺序：①读取私有槽 → ②清除继承凭据与全部私有槽 → ③注入该 MCP 自有变量 → exec。
set -eu
cwd=; sets=; argmap=; unsets=; prefixes=; n=0
ok(){ case "$1" in ''|*[!A-Za-z0-9_]*) echo "wy-mcp-launch: invalid name '$1'" >&2; exit 64;; esac; }
slot(){ ok "$1"; case "$1" in WY_MCPV_*) ;; *) echo "wy-mcp-launch: source must be a WY_MCPV_ slot: $1" >&2; exit 64;; esac
  eval "[ \"\${$1+x}\" = x ]" || { echo "wy-mcp-launch: missing source $1" >&2; exit 65; }; }
while [ $# -gt 0 ]; do case "$1" in
  --cwd) cwd=$2; shift 2;;
  --set) t=${2%%=*}; s=${2#*=}; ok "$t"; slot "$s"; n=$((n+1)); eval "__wy_v$n=\"\${$s}\""; sets="$sets $t=$n"; shift 2;;
  --arg) i=${2%%=*}; s=${2#*=}; case "$i" in ''|*[!0-9]*) echo "wy-mcp-launch: invalid index '$i'" >&2; exit 64;; esac; slot "$s"; n=$((n+1)); eval "__wy_v$n=\"\${$s}\""; argmap="$argmap $i=$n"; shift 2;;
  --unset) ok "$2"; unsets="$unsets $2"; shift 2;;
  --unset-prefix) ok "$2"; prefixes="$prefixes $2"; shift 2;;
  --) shift; break;;
  *) echo "wy-mcp-launch: bad option $1" >&2; exit 64;;
esac; done
[ $# -gt 0 ] || { echo "wy-mcp-launch: missing command" >&2; exit 64; }
cmd=$1; shift
# ① 按位置替换（参数内容本身从不被解释）
c=$#; i=0
while [ $i -lt $c ]; do a=$1; shift
  for m in $argmap; do [ "${m%%=*}" = "$i" ] && eval "a=\${__wy_v${m#*=}}"; done
  set -- "$@" "$a"; i=$((i+1)); done
for m in $argmap; do [ "${m%%=*}" -lt "$c" ] || { echo "wy-mcp-launch: index out of range ${m%%=*}" >&2; exit 64; }; done
# ② 清除继承凭据与私有槽
for x in $unsets; do unset "$x"; done
for p in $prefixes; do for x in $(env | sed -n "s/^\($p[A-Za-z0-9_]*\)=.*/\1/p"); do unset "$x"; done; done
# ③ 注入 MCP 自有变量，清理暂存
for p in $sets; do t=${p%%=*}; k=${p#*=}; eval "export $t=\"\${__wy_v$k}\""; done
k=1; while [ $k -le $n ]; do unset "__wy_v$k"; k=$((k+1)); done
[ -z "$cwd" ] || cd "$cwd"
exec "$cmd" "$@"

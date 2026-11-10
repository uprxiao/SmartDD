#!/bin/sh
# WillYou MCP stdio 启动包装 v2（补验 B2，修正审核二 F03）：
#   wy-mcp-launch.sh [--cwd DIR] [--set TARGET=SRCVAR]... [--unset NAME]... [--unset-prefix PREFIX]... -- CMD [ARG|@WYARG:SRCVAR]...
# 顺序：①读取私有槽的值（参数替换、--set 来源）→ ②清除继承的模型／宿主凭据与全部私有槽 → ③再注入该 MCP 明确授权的自有变量。
# 因此 MCP 自有变量即使与被清除的模型变量同名也会保留；私有槽在子进程中不可见。名字只允许 [A-Za-z0-9_]。
set -eu
cwd=; sets=; unsets=; prefixes=; n=0
ok(){ case "$1" in ''|*[!A-Za-z0-9_]*) echo "wy-mcp-launch: invalid name '$1'" >&2; exit 64;; esac; }
has(){ eval "[ \"\${$1+x}\" = x ]" || { echo "wy-mcp-launch: missing source $1" >&2; exit 65; }; }
while [ $# -gt 0 ]; do case "$1" in
  --cwd) cwd=$2; shift 2;;
  --set) t=${2%%=*}; s=${2#*=}; ok "$t"; ok "$s"; has "$s"; n=$((n+1)); eval "__wy_v$n=\"\${$s}\""; sets="$sets $t=$n"; shift 2;;
  --unset) ok "$2"; unsets="$unsets $2"; shift 2;;
  --unset-prefix) ok "$2"; prefixes="$prefixes $2"; shift 2;;
  --) shift; break;;
  *) echo "wy-mcp-launch: bad option $1" >&2; exit 64;;
esac; done
[ $# -gt 0 ] || { echo "wy-mcp-launch: missing command" >&2; exit 64; }
# ① 参数替换（读取私有槽）
c=$#; i=0
while [ $i -lt $c ]; do a=$1; shift; case "$a" in @WYARG:*) v=${a#@WYARG:}; ok "$v"; has "$v"; eval "a=\${$v}";; esac; set -- "$@" "$a"; i=$((i+1)); done
# ② 清除继承凭据与私有槽
for x in $unsets; do unset "$x"; done
for p in $prefixes; do for x in $(env | sed -n "s/^\($p[A-Za-z0-9_]*\)=.*/\1/p"); do unset "$x"; done; done
# ③ 注入 MCP 自有变量，随后清理本脚本内部暂存
for p in $sets; do t=${p%%=*}; k=${p#*=}; eval "export $t=\"\${__wy_v$k}\""; unset "__wy_v$k"; done
[ -z "$cwd" ] || cd "$cwd"
exec "$@"

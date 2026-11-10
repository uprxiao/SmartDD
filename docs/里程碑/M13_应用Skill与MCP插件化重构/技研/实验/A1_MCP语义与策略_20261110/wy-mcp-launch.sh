#!/bin/sh
# WillYou MCP stdio 启动包装（技研 A1）：
#   wy-mcp-launch.sh [--cwd DIR] [--set TARGET=SRCVAR]... [--unset NAME]... [--unset-prefix PREFIX]... -- CMD [ARG|@WYARG:SRCVAR]...
# 值只经环境变量传入；名字只允许 [A-Za-z0-9_]；@WYARG:VAR 形式的参数在此处替换为变量值（避免 CLI 对参数做 ${} 展开）。
set -eu
cwd=; sets=; unsets=; prefixes=
ok(){ case "$1" in ''|*[!A-Za-z0-9_]*) echo "wy-mcp-launch: invalid name '$1'" >&2; exit 64;; esac; }
while [ $# -gt 0 ]; do case "$1" in
  --cwd) cwd=$2; shift 2;;
  --set) t=${2%%=*}; s=${2#*=}; ok "$t"; ok "$s"; sets="$sets $t=$s"; shift 2;;
  --unset) ok "$2"; unsets="$unsets $2"; shift 2;;
  --unset-prefix) ok "$2"; prefixes="$prefixes $2"; shift 2;;
  --) shift; break;;
  *) echo "wy-mcp-launch: bad option $1" >&2; exit 64;;
esac; done
[ $# -gt 0 ] || { echo "wy-mcp-launch: missing command" >&2; exit 64; }
for p in $sets; do t=${p%%=*}; s=${p#*=}; eval "[ \"\${$s+x}\" = x ]" || { echo "wy-mcp-launch: missing source $s" >&2; exit 65; }; eval "export $t=\"\${$s}\""; done
n=$#; i=0
while [ $i -lt $n ]; do a=$1; shift; case "$a" in @WYARG:*) v=${a#@WYARG:}; ok "$v"; eval "a=\${$v}";; esac; set -- "$@" "$a"; i=$((i+1)); done
for x in $unsets; do unset "$x"; done
for p in $prefixes; do for x in $(env | sed -n "s/^\($p[A-Za-z0-9_]*\)=.*/\1/p"); do unset "$x"; done; done
[ -z "$cwd" ] || cd "$cwd"
exec "$@"

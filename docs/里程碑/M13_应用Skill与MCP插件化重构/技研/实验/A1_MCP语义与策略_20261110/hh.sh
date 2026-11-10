#!/bin/sh
# headersHelper 技研：从 WY_MCPV_* 读取已求值的请求头值，原样输出 JSON（不经 Claude 展开）
exec node -e 'const m=JSON.parse(process.argv[1]);const o={};for(const[k,v]of Object.entries(m))o[k]=process.env[v]??"";process.stdout.write(JSON.stringify(o))' "$1"

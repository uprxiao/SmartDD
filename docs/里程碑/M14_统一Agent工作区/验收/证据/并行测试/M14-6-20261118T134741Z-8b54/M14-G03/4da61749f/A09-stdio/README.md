# A09 双向 stdio MCP 投影实包

2026-11-19 08:34 新加坡时间。macOS arm64，冻结 `4da61749fc24f8d05481b6139e276cf6c4afd5b0`，ASAR `39351e634975433afb8034cda4e3a387fbd534b3f982ad56b3f88e062864dbc4`。真实本机 Claude/Codex 从实际 App 启动；模型与 MCP 只使用本轮合成环境。

- 140 两端各启动两个真实 stdio 来源。四条过程回执逐项匹配 argv 的中文、空格、引号、反斜杠和空串，以及各自的实际绝对／相对工作目录。Claude 来源变量及缺省值按源语义展开，Codex 来源中的字面变量保持原文，同时按源配置引入公开环境值。两端各显示两个正常工具。
- 两活动 MCP 的底层进程各自公布了额外探针工具，源定义中的禁用配置使它在两个执行器的实际模型工具目录中都缺席。另用真实纳管设置停用第三台服务器，两端均没有启动它或公布其工具。
- 两份原始配置的 SHA-256 在验收前、两轮后和退出后完全一致。App 退出 0，renderer 无报错，四个确定出生标记的 MCP PID 已退出。138 是原公共隔离守卫在启动前正确拒绝不匹配路径，改用已验证 G03 隔离入口后才进行 140，保留两次记录。

[Claude](attempt-140/10-claude.png) · [Codex](attempt-140/10-codex.png) · [真实工具与进程回执](attempt-140/result.json) · [140 证据哈希](attempt-140/SHA256SUMS.txt) · [138 原始守卫拒绝](attempt-138/result.json) · [驱动预检](driver/preflight.log)

HTTP、字面请求头、源认证和不支持字段分支已在前一候选分别验过；表单与 URL 已在同候选实包验证。软件与打包证据合并，覆盖 A09。[HTTP 与不等价字段](../../../M14-G02/25516433f/A09-managed-fields/README.md) · [表单和 URL](../../../M14-G02/4da61749f/A09-elicitation/README.md) · [软件回归](../../../build/candidate-4da61749f/README.md)

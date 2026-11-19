# A25 Codex 同树尝试 127

候选 `e779d4e1703b2de07789175422ddb3b3ceafe189`，ASAR `7ea76c07ef24e3baa9339e0436d564ca8b7230b8a7ec61357792fbcff55bf988`。本机隔离 App PID 31741 正常退出 0，无渲染错误。测试夹具以相同 Codex 工具和同一个供应商新建两个档案，第二个由产品 `agents.save` 的 `(toolId, source, providerId)` 唯一约束拒绝。私有数据库只有第一个测试档案及它所属的单一回环供应商，尚未创建任何任务或发出模型请求。原驱动和原失败独立留存。

[实际失败](attempt-127/result.json) · [私有配置](attempt-127/private-configuration.json) · [原驱动](driver/a25-codex-tree.mjs) · [证据 SHA-256](SHA256SUMS)

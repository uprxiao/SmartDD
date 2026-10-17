# Agent 运行时与数据实验 V1

2026-10-17，依据 M10 R1.2。均为隔离调研实验，不改生产代码／用户配置／真实业务数据。

| 产物 | 实际结果 | 边界 |
| --- | --- | --- |
| [cli-reuse-summary.json](cli-reuse-summary.json) | 原有测试31通过；Codex发现探针通过；Claude假API调用复验通过 | 初次Claude因本机监听沙箱限制失败，原报告保留；实际模型／第三方服务未执行 |
| [Codex直接MCP调用实验](Codex直接MCP调用实验说明.md)／[结果](codex-mcp-call-report.json) | 1个研究测试、18条断言通过，实际调用project_context并返回当前合成项目 | 无模型turn、无业务provider；首次断言误报与复验分别保留；不能证明模型选工具／真实第三方调用 |
| [existing-mcp-report.json](existing-mcp-report.json) | 9项观察满足实验断言，其中3项记录限制 | 不统计为9条M10验收通过 |
| [candidate-storage-report.json](candidate-storage-report.json) | 8项候选SQLite结构实验通过 | 不证明远端幂等、不代表正式DB迁移；初次占位符错误已修正并在上级调研记录 |

复现两个合成实验：

```sh
python3 docs/里程碑/M10_三方应用接入/技研/实验/agent-bridge/probe_existing_mcp.py --root /Users/liubu/Documents/ChatGPT/SmartDD --report /private/tmp/m10-existing-mcp-report.json
python3 docs/里程碑/M10_三方应用接入/技研/实验/agent-bridge/probe_candidate_storage.py --report /private/tmp/m10-candidate-storage-report.json
```

CLI探针使用已有 `pnpm probe:m4:cli` 对应测试；启动前先读脚本，确认仍为隔离项目／假服务。相关原始报告和447份schema在忽略目录 `release/m10-research/protocol-v1/`。不要把真实账号配置替换进实验。

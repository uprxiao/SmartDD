# M14 阶段 1 底座证据（2026-11-17）

范围与结论见[执行与缺陷记录](../../执行与缺陷记录.md#阶段-1-底座2026-11-17)与[实施计划与进度](../../../实施计划与进度.md)。

| 文件 | 内容 |
| --- | --- |
| `live/codex-app-server.json` | 真实 Codex 0.169.0（订阅）冒烟：新建一轮、恢复同一原生会话（代次 2）、越出工作区写入的审批请求与拒绝；运行、请求、事件序列与脱敏后的驱动事件 |
| `live/claude-sdk.json` | 真实 Claude Code 2.1.326＋SDK 0.3.321（DeepSeek 端点 deepseek-flash）同一冒烟 |
| `logs/full-regression-summary.log` | 全量回归摘要：7743 项，6 项失败（M13 旧文件超时） |
| `logs/rerun-modified-2.log` | 改动后工作区单独重跑同 4 个文件：154/154 通过 |
| `logs/rerun-baseline.log` | 未改动原版副本（`git worktree --detach HEAD`）同 4 个文件：154/154 通过 |
| `logs/migration-timing.json` | 0037 前后每次建库耗时（毫秒，20 次平均） |

复跑：`M14_LIVE=1 M14_LIVE_OUT=<目录> node scripts/run-tests.mjs src/main/core/agent/live.integration.test.ts`（需本机 codex、claude 与 `DEEPSEEK_API_KEY` 环境变量；Key 不写入任何文件）。第一次单独重跑（3 项失败、用例不同）的完整输出未落盘，结论以本表三份日志为准。

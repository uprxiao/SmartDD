# M14-D06-63 修复复验：Codex 限流（2026-11-19）

修复提交 `8c0b7d3f8`：Codex 在原生重试用尽后报 `responseTooManyFailedAttempts`（`httpStatusCode` 429），只在终态错误上标为限流。先补的失败测试用第 365 次的真实载荷，修复前失败、修复后通过；`src/main/core/agent` 与 `src/renderer/features/agent-tasks` 回归 398 项通过、7 项跳过，类型检查通过。新隔离包 `app.asar` `dbece4ec…642f2`。

用第 365 次的同一驱动 `a60-native-limits-packaged.mjs` 在新包上复验：

- **366 codex-rate 通过**：原生重试 6 次后，界面显示“请求过于频繁，已被限流”，本轮暂停，不显示重置时间；只有实点“继续”才开新一轮。M14-D06-63 关闭。[限流卡](attempt-366/02-explicit-new-turn-recovered.png)
- **368 codex-output 通过**：输出上限的显示没有受影响。
- **367 codex-usage 为 partial**：这个驱动用的是相对重置头，Codex 原生不把它解析成结构化时间，与第 162 次相同；界面仍标“额度”。额度重置时间的正式判据以第 168 次的绝对时间驱动为准，本次修复不涉及额度分支。

App 均正常退出 0，3425 已释放。

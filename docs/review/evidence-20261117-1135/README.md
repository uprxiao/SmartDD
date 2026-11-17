# M14 修复复核证据（2026-11-17 1135）

对应 [Review Report](../review-20261117-1135.md)。只新增评审文件，不代替阶段用例账或产品执行账。

- `input-baseline.json`：3172 个输入的 SHA-256；`changed-since-review.json` 区分共同输入修改与新增覆盖。`production-reference-baseline.json` 是具名只读核对的现有浏览器授权服务；`input-integrity.json` 是结束核验。
- `recheck-probes.cjs`：复用上轮合成组件／处理函数驱动，适配目标函数迁移到 m14-model 后的导出及 taskId 参数。使用相同文字、相同目标 id、不同 taskId 的任务 A/B；直接运行当前 GoalRow 处理函数、goalLock、ModelPicker 及权限函数。保留真实 JSX 与函数，仅在内存替换 hooks，不执行 effects，不操作浏览器／Provider。
- `check-recheck.cjs`：沿用上轮 14 条合同断言，当前全部通过；`cross-artifact-probes.json` 另保留新修订、B 暂停／清除、独立任务 C 的实际值。没有以接受原错误行为修改预期。
- `focused-regressions.cjs`、`focused-recheck.json`：当前输入上的旧五项定向回归。`home-menu-ssr.cjs` 及对应 JSON/HTML：实际首页菜单／附件静态渲染，不能代替浏览器输入。
- `test-*.log`、`prototype-tests.json`：四组原型测试 389 项通过；使用当前工作区依赖，没有另做 npm ci。环境见 `environment.json`。
- `private-run.json`：本轮私有临时副本；研究脚本、临时 Git 仓库和生成器的写入结果均与原证据隔离。`timeline-replay.json`（34）、`runtime-contract.json`（18）、`new-recordings.log`、`merge-check-cases.log`（9）是本轮复跑结果，无新模型调用。
- `ledger-check.json`：64 个唯一 Q 编号，无重复；新增 Q60–Q64 的原文与行号。
- `recordings-integrity.json`：V17/V18 原 native／summary 共 11 个文件与上轮哈希相等；没有改写真实记录或用当前机器状态补造历史依赖。
- `generator-replay.json`：实际生成器输出到私有目录，A1.7/E1.7 两份与现行文件逐字相等。`case-index.json` 仅为当前用例字段的评审抽取，不是新的权威来源。
- `manifest-check.json`：P0.18 的 15 个文件与源码包／当前工作区、1 张截图哈希一致。已查看归档图片，未新截图。
- `document-audit.json`：原 43 项审计，仅重定向输出位置，不改断言或覆盖原结果。
- `browser-availability.json`：CUA 浏览器连接服务不可用，本轮没有新浏览器交互、系统输入或真实 App 验收。

可从仓库根执行本目录 `recheck-probes.cjs`，随后执行 `check-recheck.cjs`；两者只写本目录。修复／补充 N01 后应另存新批次证据，不覆盖本轮与前轮记录。

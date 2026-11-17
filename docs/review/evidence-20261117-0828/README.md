# M14 RR01–RR11 再复核证据

对应[复核报告](../review-20261117-0828.md)。2026-11-17，分支 `feature/0.1.6`，HEAD `7c4ed737dfc03cb9b2b4509de996cdaa1af6f560`。本轮仅新增评审文档与证据，未改原型、方案、用例、研究脚本或生产代码。

| 文件 | 核对内容／层级 |
| --- | --- |
| `input-baseline.json`、`changed-since-review.json`、`input-integrity.json` | 本次输入哈希、相对上轮的变化及结束核对；不把未提交工作区当成 commit |
| `prototype-tests.json`、`test-*.log` | 原型模型回归：M14 27、M9 297、parity 5、M13 57 全通过；非浏览器操作 |
| `research-tests.json`、`*.test.mjs.log`、`timeline-replay.json`、`runtime-contract.json` | 外部副本运行原录制回放、候选合同、新录制与失败重试夹具；34／15 项及新增断言通过 |
| `merge-check-cases.log` | 原 9 项合并核对通过；预期冲突的 stderr 保留 |
| `worktree-negative-regression.mjs`、`worktree-merge-negative.json`、`original-negative-source.json` | 上轮精确 Git 操作步骤保留，只切换输出目录和预期；新 `hostCheck` 正确返回 `pass:false` |
| `v16-run3-audit.json` | 只读核对已存在的真实 Codex run3：孤立回合终态 interrupted、该轮无命令／文件／MCP 工作项，目标最终 complete；run2 summary 与上轮哈希一致。未新调用模型，子完成仍为桩／脚本 |
| `closed-items.cjs`、`closed-items.json` | 实际命令 helper、实际 Composer submit 闭包上的合成输入；命令过滤、手输与任务内附件准备／失败拦截通过，不代表首页路径通过 |
| `focused-recheck.cjs`、`focused-recheck.json` | 实际模型函数、实际 createTask／linkAction／resolveChild／childState 代码上的定向合成反例；不使用浏览器、DOM 或真实 Agent |
| `prototype-static-render.json`、`*-ssr.html` | 实际 React SSR：四类主请求均已有停止键。SSR 不执行 effect，不能验证点击后状态或系统输入法 |
| `generator-replay.json` | A1.4／E1.4 输出到私有目录，两份文件与现行正文逐字节一致；75／66／9 |
| `document-audit.json`、`document-audit.stdout` | 原审计只重定向结果到本目录；43 项通过、坏链接 0，旧结果未覆盖 |
| `manifest-check.json` | P0.15 15 项源码／配置的当前及 tar 哈希匹配；4 张截图哈希匹配 |
| `private-run.json` | 本次外部副本的位置；录制目录只读链接，结果写外部副本或本目录 |

浏览器工具本次仍返回 `browser access host unavailable`，未独立重新点击原型。查看了 P0.15 已保存的“审批时停止后请求作废”图：正文显示停止记录，左侧当前任务仍为“等待批准”；这是历史截图检查，不是本轮重拍。

可从仓库根复跑 `node docs/review/evidence-20261117-0828/closed-items.cjs` 和 `node docs/review/evidence-20261117-0828/focused-recheck.cjs`。Git 回归依赖 `private-run.json` 中的外部 probes 副本；换机器时复制 `merge-agents.mjs` 与 `lib/` 到新的私有目录再更新该回执，不在原录制目录导入带清理副作用的探针。

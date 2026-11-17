# M14 修复复核证据（2026-11-17 1101）

对应 [Review Report](../review-20261117-1101.md)。只读复核现行产物；本目录不是新的阶段用例账或生产执行账。

- `input-baseline.json`：2666 个输入文件 SHA-256；`changed-since-review.json` 区分与上一轮共同输入的修改和本轮新增覆盖范围，不能把新增覆盖的旧测试文件误计为 CC 本轮修改。
- `recheck-probes.cjs`：在内存编译当前真实组件，替换被评审模块的 React hooks 为可重复的合成状态，不执行 effects；保留实际 JSX、处理函数和纯模型。输出 `cross-artifact-probes.json`。不使用浏览器、原生驱动、Provider 或生产服务。
- `check-recheck.cjs`：按现行合同对上项输出断言；当前 12 通过、2 失败，失败为目标跨任务串用、研究 ask 参数仍旧。退出码 1 是已保留反例，不计作产品验收结果。
- `focused-regressions.cjs`：复用前轮的实际创建／链接／停止处理函数；新版本新增 `carryHomeExtensions`，夹具也加载了该实际 helper。当前通过，输出 `focused-recheck.json`。
- `recheck-probes-attempt1.log`：评审夹具局部变量重名导致语法失败，未运行产品；修正后先语法检查再执行。`focused-attempt1.log`：旧夹具未提供新 helper 的 ReferenceError；适配后原反例输入通过。两者均未当作产品缺陷。
- `home-menu-ssr.cjs`／`.json`／HTML：实际首页、模型菜单和附件卡片静态渲染；仅在内存展开模型菜单，验证非提交按钮，不能代替浏览器点击。
- `test-*.log`、`prototype-tests.json`：现有四组原型测试共 387 项通过。使用当前工作区依赖，没有另做 npm ci，实际版本在 `environment.json`。
- `private-run.json`：研究脚本的新临时副本和输出位置。`timeline-replay.json`（34）、`runtime-contract.json`（15）是本轮复跑结果；录制数据只读，不调用模型。`new-recordings.log` 包括 todo／goal 和 Codex plan 新断言。
- `merge-check-cases.log`：私有临时 Git 仓库内 9 项确定性正反例，无模型调用或权限提升。
- `V17-V18-readback.json`：读取 CC 留存的真实记录／摘要，摘取 init 的模型、CLI 版本、权限模式、计划工具及行号，记录原件 SHA 和 runClaude 环境构造。没有读取登录凭据，没有本轮新模型调用；原摘要与原始记录不改写。
- `ledger-duplicates.json`：当前验证账同一个 Q 编号的两组含义及行号。
- `document-audit.json`：复用现有 43 项审计，只重定向输出位置；`generator-replay.json`：实际生成器输出到临时目录，与现行两份文档逐字比较。
- `manifest-check.json`：P0.17 源码包中 15 个文件及当前工作区、3 张截图的哈希核对。只读查看已有目标锁定／子任务布局截图，不作为本轮新交互证据。
- `browser-availability.json`：CUA 连接服务不可用，未执行浏览器输入；系统 IME、深色／窄窗等没有补验。
- `input-integrity.json`：结束时输入哈希、分支／提交、生产目录差异和报告链接核对；首轮脚本沿用上轮 14 项的数量断言，返回 1，实际输入／链接核对已通过，结果保留为 `input-integrity-attempt1.json`。改为本轮 5 项后返回 0，不涉及产品或原输入修改。

可从仓库根运行 `node docs/review/evidence-20261117-1101/recheck-probes.cjs`，随后运行 `node docs/review/evidence-20261117-1101/check-recheck.cjs`。修复后另建新的评审目录，保留本轮红测和历史原件。

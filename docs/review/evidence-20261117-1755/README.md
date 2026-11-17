# M14 阶段 1、2 修复复核证据

对应[复核报告](../review-20261117-1755.md)。本轮只审核、补复核驱动与文档，没有修改生产实现、需求、原型或权威执行账，没有执行 commit／push。

## 基线与执行时段

- 2026-11-17 17:55 开始，HEAD `d418f69c9`，存在三个后端文件的未提交修改，见 [baseline.json](baseline.json)、[working-source.patch](working-source.patch)。
- 复核期间工作区新增 `7dc2a5a23d72aed2ee938a3c96018bbb27ab3519`，纳入了同一份后端修改及新的 Claude UI 证据。生产输入哈希未变化，见 [head-update.json](head-update.json)。baseline 与 patch 也被该工作区提交纳入；本助手没有执行这次提交。
- 原有测试于 17:59–18:16 执行；中断后 19:58 再次核对，生产源码仍一致。原测试会话句柄已过期，最终 39 项定向复验在恢复后重新执行，结果相同；中断前日志另存为 `recheck-and-boundaries-before-interruption.log`。结束状态与产物哈希见 [final-integrity.json](final-integrity.json)。
- macOS arm64；测试使用仓库 runner 启动 Electron Node，匹配 SQLite ABI；SDK 保持仓库锁定版本 0.3.321。本轮没有安装依赖、重建共享原生模块、构建或启动 App。

## 既有测试与旧反例复核

| 检查 | 结果 | 原始日志 |
| --- | --- | --- |
| TypeScript node／web | exit 0 | [typecheck.log](typecheck.log) |
| Agent、renderer、退出流程及整个 DB | 189 passed、2 skipped，exit 0 | [scoped-tests.log](scoped-tests.log) |
| 旧 20 个契约的等价复核 | 20 passed | [recheck-tests.log](recheck-tests.log) |

```sh
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-1755-scoped \
  node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks \
  src/main/db src/main/quit-flow.test.ts --pool=threads --maxWorkers=2 --reporter=verbose
```

完整范围获准使用本机临时 IPC 与测试子进程能力；真实模型冒烟关闭，所有数据库／进程夹具均独立，不连接日常实例。

旧反例在本目录副本中适配，不运行会覆盖旧观察值的原脚本：

- [recheck-probes.test.ts](recheck-probes.test.ts)、[适配差异](recheck-probes.test.ts.adaptation.diff)。补齐退出替身；不再等待已经修掉的错误发生；问答使用实际 requestForm；Claude full 通过真实任务服务的重开／恢复路径验证；关闭等待推进完整三段。
- [recheck-ui.test.tsx](recheck-ui.test.tsx)、[差异](recheck-ui.test.tsx.adaptation.diff)。数字键验证收在实际面板上，并补 Enter 后只回应一次；其余原发送／草稿断言保留。该文件后半也包含新增组件边界测试，名称为 N 项。
- [probe-observations.json](probe-observations.json)、[ui-observations.json](ui-observations.json) 为本轮观察值；原 `evidence-20261117-1620/` 未被本轮改写。

## 新边界验证

```sh
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-1755-final-verified \
  node scripts/run-tests.mjs --config docs/review/evidence-20261117-1755/review.vitest.config.mts \
  --reporter=verbose
```

最终结果：[recheck-and-boundaries-final.log](recheck-and-boundaries-final.log)，**20 passed（旧契约），19 failed（新边界），合计 39，exit 1**。红测均为产品契约断言，未出现夹具导入失败或超时；19 个反例归并为报告中的 13 项问题。新增服务测试见 [residual-core.test.ts](residual-core.test.ts)，观察值见 [residual-observations.json](residual-observations.json)。

| 报告编号 | 反例 | 实际观察 |
| --- | --- | --- |
| NR01 | N01 | 相同 inputId 返回 duplicate，但已冻结图片 A 变成 B |
| NR02 | N02 | open 失败，未观察 exit 的 owner 从内存移除、记录为 failed |
| NR03 | N03 | 终态先于 start 返回，第二条已接受输入未派发 |
| NR04 | N04 | 结束的 SDK query 被重用，显式 retry 留在 queued，状态 working |
| NR05 | N05、组件 N05b | A→B→默认实际为 A→B→A；选择器缺默认选项 |
| NR06 | N06a/b/c | 计划快照无正文但 SDK 获完整计划批准；snapshot/history 超出预算 |
| NR07 | 组件 N07 | 延迟初始快照覆盖新水位与本地草稿 |
| NR08 | 两个 N08 | Claude rate_limit、max_output_tokens 都归普通 failed |
| NR09 | N09a/b | reviewer 能力关闭仍发 ask 回合；未知必需请求生成通用批准 |
| NR10 | 组件 N10 | 原生命令未带附件，成功后附件卡片消失 |
| NR11 | N11 | 已完成子节点被迟到正文改回 running/null |
| NR12 | N12 | A 根准备的同名附件在 B 根被重新解释成 B 文件 |
| NR13 | N13a/b | 普通模型回答前缀可以创建或清除原生目标投影 |

[structured-test-results.json](structured-test-results.json) 保存日志提取的检查结果与哈希，便于按现有忽略规则保留结构化结果。原始日志也保留在本地；历史 `boundary-tests.log`、`boundary-tests-final.log` 是逐步补充反例的执行，不重复计数。

## 验证边界

测试导入实际工作区的生产类、函数和 React 组件。主进程使用内存 SQLite、合成目录、可控 SDK／ChildProcess 对端；组件使用 jsdom。没有改写生产判断，没有使用真实秘密、模型、日常数据库或 GUI，也未接触本人授权流程。

这些证据证明被测调用链在指定输入／时序下的行为，不代表真实系统进程排空、实际配额耗尽、打包 App 或 IME 已验收。NR03、NR07 明确为回执／通知交错的故障注入；NR09 未宣称发生了真实权限绕过；NR13 的假目标文字来自明确标为普通模型回答的合成 SDK 帧。

工作区新增的 Claude `ui-claude-1/2` 已有独立开发构建记录，本轮仅只读核对，不把它们算作本轮重复执行，也不扩大为所有异常路径通过。

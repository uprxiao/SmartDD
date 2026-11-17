# M14 阶段 1、2 第五轮代码复核证据

报告：[review-20261117-2327.md](../review-20261117-2327.md)。基线：`feature/0.1.6`／`f4541b93164130423451ee7892fd03ea1de0910f`。本目录为独立复核资料，不修改产品权威执行账。

## 结果与资料

- [baseline.json](baseline.json)：开始时 HEAD、Git 状态和 104 个相关文件哈希。
- [final-integrity.json](final-integrity.json)：结束时源码／HEAD、链接和产物哈希校验。
- [test-summary.json](test-summary.json)：现有测试、复核反例的统计和执行命令。
- 现有测试：227＋86＝**313 项通过、2 项真实模型冒烟跳过**；node／web 类型检查通过。
- [review-tests.vitest.json](review-tests.vitest.json)：最终 **65 项：原 63 项通过，新增 2 项失败**，对应报告 T01／T02。
- 原 63 个反例复制到本目录，观察值输出全部重定向。Q04ui 按原关闭合同改为“明确损坏提示、不自动保存空草稿”，不要求恢复旧版本已经丢失的正文；[适配差异](probe-adaptations.diff)保留。
- [adjacent-ui.test.tsx](adjacent-ui.test.tsx)将实际 React 组件连接到实际 AgentTaskService／AgentStore／内存 SQLite，只有 IPC 传输和执行器为替身。T01 使用真正的 CAS 保存；T02 通过实际 Claude 条目投影、正文存储及分段接口构造计划，未在 mock 中另写存储或 CAS 规则。
- 新观察值：[adjacent-ui-observations.json](adjacent-ui-observations.json)。最终日志为 `review-tests-final.log`；早先 `recheck-tests.log` 对应 63 项复验，`adjacent-tests.log` 对应新增 2 项。

本轮没有调用真实模型或启动打包 App。上轮 Codex 0.169.0 原生恢复实验仅按其原范围引用；没有重复运行，也不计本轮模型端到端通过。CC 留存的开发构建 JSON 仅作只读核对。

## 复跑

在仓库根执行，沿用现有安装与 Electron Node 测试入口；无需重建共享依赖。部分 DB 测试需要本机私有 IPC，按已授权的隔离测试方式执行。

```sh
pnpm typecheck
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2327-scoped node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks src/main/db src/main/quit-flow.test.ts --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2327-ui node scripts/run-tests.mjs src/renderer/features/agents --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2327-final node scripts/run-tests.mjs --config docs/review/evidence-20261117-2327/review.vitest.config.mts --reporter=verbose --reporter=json --outputFile=docs/review/evidence-20261117-2327/review-tests.vitest.json
```

**后续复验请复制到新目录，并更新测试内的观察值路径，避免覆盖本轮历史。** `.log` 按仓库忽略规则留在本地；报告、JSON、脚本可归档。全部结果均按其 U／I／jsdom 层级记录，不计产品打包验收通过。

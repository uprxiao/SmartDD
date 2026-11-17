# M14 阶段 1、2 第六轮代码复核证据

报告：[review-20261117-2354.md](../review-20261117-2354.md)。基线：`feature/0.1.6`／`068f5d2e3ee3017f9bc8943953afaaed247017e0`。本目录只记录复核，不修改产品权威执行账。

## 结果与资料

- [baseline.json](baseline.json)：开始时 HEAD、Git 状态、116 个相关文件哈希。
- [final-integrity.json](final-integrity.json)：结束时 HEAD／源码、产物哈希及链接检查。
- [test-summary.json](test-summary.json)：统计与命令。
- 现有测试：233＋86＝**319 项通过、2 项真实模型冒烟跳过**；node／web 类型检查通过。
- [review-tests.vitest.json](review-tests.vitest.json)：最终 **67 项：原 65 项通过、新增 2 项失败**。
- 历轮反例仅重定向输出，断言不变；[适配差异](probe-adaptations.diff)。
- [retention.test.tsx](retention.test.tsx)：U01a 对应报告 U01，验证新超限正文的可恢复性；U01b 对应报告 U02，验证工作过程的部分内容提示。均使用实际投影、AgentStore／AgentTaskService、内存 SQLite、正文读取 API 及实际组件，执行器／IPC 传输为替身。
- [retention-observations.json](retention-observations.json)：原文与读回字节、完整尾部、残缺标志／提示观察值。

没有执行真实模型超长输出或打包 App 验收。CC 的开发构建五组结果只读核对；错误模型名的失败没有被覆盖或追认为通过。

## 复跑

仓库根执行，沿用现有依赖与 Electron Node 测试入口。部分 DB 集成测试需要本机私有 IPC，按已授权的隔离测试方式执行。

```sh
pnpm typecheck
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2354-scoped node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks src/main/db src/main/quit-flow.test.ts --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2354-ui node scripts/run-tests.mjs src/renderer/features/agents --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2354-final node scripts/run-tests.mjs --config docs/review/evidence-20261117-2354/review.vitest.config.mts --reporter=verbose --reporter=json --outputFile=docs/review/evidence-20261117-2354/review-tests.vitest.json
```

**后续复验请复制到新目录，并更新所有观察值路径，避免覆盖历史。** 原始 `.log` 按仓库忽略规则保留本地；报告、JSON、源码可归档。`review-tests-final.log` 对应最终 67 项结果；`recheck-tests.log` 是原 65 项复验；`retention-tests.log` 是新增 2 项的单独运行。所有 U／I／jsdom 结果均不计产品打包验收通过。

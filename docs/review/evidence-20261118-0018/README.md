# M14 阶段 1、2 第七轮代码复核证据

报告：[review-20261118-0018.md](../review-20261118-0018.md)。基线：`feature/0.1.6`／`e90b1f0affcf48183be1883f924ef6aaf68a2f7c`。本目录只记录独立复核，不回写产品权威执行账。

## 结果与入口

- [baseline.json](baseline.json)：开始时 HEAD、Git 状态及 119 个相关文件哈希。
- [final-integrity.json](final-integrity.json)：结束时 HEAD／源码、链接和产物哈希检查。
- [test-summary.json](test-summary.json)：统计与执行命令。
- 现有测试：240＋86＝**326 项通过、2 项真实模型冒烟跳过**；node／web 类型检查通过。
- [review-tests.vitest.json](review-tests.vitest.json)：最终 **70 项：原 67 项通过、新增 3 项失败**，对应报告 V01–V03。
- 旧反例只重定向输出；`retention.test.tsx` 的 helper 补充独立 artifact 目录及夹具清理，断言不变，见[适配差异](probe-adaptations.diff)。历史证据目录没有改动。
- 新反例：[artifact-boundaries.test.ts](artifact-boundaries.test.ts)；[观察值](artifact-boundary-observations.json)。A01／A02／A03 分别对应报告 V01／V02／V03。

新增反例使用真实投影、AgentStore／AgentTaskService、内存 SQLite 和私有临时目录，执行器为替身，没有调用真实模型、操作日常 App 或写入真实用户数据目录。A03 在本轮临时目录制造改名失败；夹具的最终 rmSync 不计产品失败清理通过。

A01 的 MCP 夹具按固定 Codex 0.169.0 [McpToolCallResult](Codex-0.169.0-McpToolCallResult.txt)补齐 `content`、`_meta` 及条目的必要字段。较早源码保留为 `artifact-boundaries-initial.ts.txt`，初次定向结果在 `artifact-boundaries.log`；最终结论来自完整协议形状下的 `review-tests-final.log` 与对应 JSON，断言未变。

## 复跑

仓库根执行，沿用现有依赖与 Electron Node 测试入口。部分 DB 集成测试需要本机私有 IPC，按已授权的隔离测试方式执行。

```sh
pnpm typecheck
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-0018-scoped node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks src/main/db src/main/quit-flow.test.ts --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-0018-ui node scripts/run-tests.mjs src/renderer/features/agents --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-0018-final node scripts/run-tests.mjs --config docs/review/evidence-20261118-0018/review.vitest.config.mts --reporter=verbose --reporter=json --outputFile=docs/review/evidence-20261118-0018/review-tests.vitest.json
```

**后续复验请复制到新目录，并修改全部观察值路径，避免覆盖历史。** `.log` 按仓库忽略规则保留本地；报告、JSON、源码可归档。最终日志是 `review-tests-final.log`；`recheck-tests.log` 是原 67 项复验。所有结果按 U／I／jsdom 层级记录，不计产品打包验收通过。

# M14 阶段 1、2 第八轮代码复核证据

报告：[review-20261118-0049.md](../review-20261118-0049.md)。基线 `feature/0.1.6`／`eb1748fb135805cfcecd65a94c30228b3e4f6b79`，审查 `e90b1f0af..HEAD`。只记录独立复核，不回写产品执行账。

## 结果

- [baseline.json](baseline.json)：开始时 HEAD、状态及 155 个关联文件哈希。
- [final-integrity.json](final-integrity.json)：结束时源码／历史证据、链接及本轮产物检查。
- [test-summary.json](test-summary.json)：命令、退出码和测试统计。
- [existing-tests.log](existing-tests.log)：329 项通过、2 项真实模型冒烟跳过；[typecheck.log](typecheck.log)：node／web 通过。
- [recheck-tests.vitest.json](recheck-tests.vitest.json)：原 70 项全部通过；只把旧证据输出路径改成本目录，[差异](probe-adaptations.diff)不含断言变更。
- [artifact-lifecycle.test.ts](artifact-lifecycle.test.ts)、[结果](artifact-lifecycle.vitest.json)、[观察值](artifact-lifecycle-observations.json)：补充 4 项通过，覆盖实际部分写入后 EIO、用户消息接受回滚、更新回滚、真实数据库重开和幂等重试。
- [attachment-evidence-audit.json](attachment-evidence-audit.json)：三次附件图片哈希一致，实际是白底截图；第三次有 3 个点击记录，前两次没有。只读核对旧结果和源码，不将此次分析计作 App 操作。
- [attachment-fixture.png](attachment-fixture.png)：从第三次私有测试根归档的实际输入图；Pillow 本机读取统计，纯白像素占 66.8972%。没有修改图片。
- [dev-smoke-summary.json](dev-smoke-summary.json)：本次 Claude 回执中四类开发构建流程的原结果摘要，包含旧模型名失败。

生命周期补验的初次运行在前置失败：夹具 `continuation_hash='fixture'` 不满足迁移要求的 64 字符。已核对 `0037_agent_workspace.sql` 后仅改为 64 字符；原源码／日志／JSON 保存为 `artifact-lifecycle.*.initial.txt`。最终 4 项全部通过。故障注入只发生于本轮临时文件或私有数据库触发器；不改真实用户数据。

## 复跑

仓库根执行。现有依赖和 Electron Node 测试入口保持不变，部分集成夹具需要本机私有 IPC。

```sh
pnpm typecheck
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-0049-existing node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks src/renderer/features/agents src/main/db src/main/quit-flow.test.ts --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-0049-recheck node scripts/run-tests.mjs --config docs/review/evidence-20261118-0049/review.vitest.config.mts --reporter=verbose --reporter=json --outputFile=docs/review/evidence-20261118-0049/recheck-tests.vitest.json
```

原 70 项和新 4 项本轮是分别执行，命令详见 test-summary；上述配置现在包含两组，共 74 项。后续复验请复制到新目录并修改全部输出路径，避免覆盖本轮历史结果。`.log` 遵循仓库忽略规则保留本地；结构化结果、源码、图片及报告可归档。

本轮没有启动 App、调用真实模型、操作日常实例、构建或打包；未改变正式用例状态。

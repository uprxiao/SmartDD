# M14 阶段 1、2 修复第三轮代码复核证据

报告：[review-20261117-2127.md](../review-20261117-2127.md)。基线：`feature/0.1.6`／`440f6bccd4b2dba42c2f50add5d88e061edafc3e`。本目录归属 Codex 复核，不改产品权威执行账。

## 范围与结果

- [baseline.json](baseline.json)：开始时 Git 状态、HEAD、范围与 89 个相关文件的 SHA-256。
- [final-integrity.json](final-integrity.json)：结束时 HEAD／基线文件复核及本目录产物哈希。
- 现有测试：Agent／新任务区／退出／DB **201 通过、2 跳过**；旧 Agent 界面 **86 通过**；node／web 类型检查通过。
- [review-tests.vitest.json](review-tests.vitest.json)：最终 54 个复核反例，**39 通过、15 失败**。失败对应报告 8 类问题；不是测试驱动超时，也不是产品用例通过率。
- [test-summary.json](test-summary.json)：便于归档的现有测试／复核反例结果及执行命令。
- 原 39 个反例复制到本目录并重定向观察值输出；只适配 RC12 前置、N09b 的拒绝选项断言、N10 的等待条件，见 [probe-adaptations.diff](probe-adaptations.diff)。历史目录完全不改。
- 新增反例：[new-core.test.ts](new-core.test.ts)、[new-ui.test.tsx](new-ui.test.tsx)；观察值分别为 [new-core-observations.json](new-core-observations.json)、[new-ui-observations.json](new-ui-observations.json)。

这些是实际服务／驱动的隔离协议测试与实际组件的 jsdom 测试，使用临时目录、内存数据库、模拟 ChildProcess／SDK／RPC，不使用日常 App、数据库、凭据或真实模型。不可计作打包 App 或系统层验收。CC 的开发构建结果仍在原 `evidence-20261117-1755-fix/`，本轮仅只读核对，未重跑。

## 复跑

在仓库根执行。依赖沿用现有安装；`scripts/run-tests.mjs` 使用 Electron Node，避免 better-sqlite3 ABI 不匹配，不需要重建共享依赖。部分 DB 测试需要本机私有 IPC，受限环境应沿用已授权的隔离测试执行方式。

```sh
pnpm typecheck
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2127-scoped node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks src/main/db src/main/quit-flow.test.ts --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2127-ui node scripts/run-tests.mjs src/renderer/features/agents --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2127-final node scripts/run-tests.mjs --config docs/review/evidence-20261117-2127/review.vitest.config.mts --reporter=verbose --reporter=json --outputFile=docs/review/evidence-20261117-2127/review-tests.vitest.json
```

**后续复核请复制到新的证据目录并改写测试里的观察值路径，避免覆盖本轮历史。** 报告和 JSON 是入库证据；原始 `.log` 按仓库忽略规则保留本地。最终日志 `review-tests-final.log` 与 JSON 对应；较早的 `new-boundary-tests.log`（11 个红测）及 `new-boundary-tests-final.log`（14 个红测）是补充反例前的过程结果，最终结论以 54 项结果为准。

## 原生协议依据

本机 `codex-cli 0.169.0` 的 `app-server generate-ts --experimental`，使用独立临时 CODEX_HOME，仅生成协议、不启动真实模型或使用日常登录。留存 [TurnStartParams](Codex-0.169.0-TurnStartParams.txt) 与 [ThreadStartResponse](Codex-0.169.0-ThreadStartResponse.txt)。用于 F03 的模型粘滞语义；协议替身运行结果不冒充真实模型结果。

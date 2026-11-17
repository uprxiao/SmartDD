# M14 阶段 1、2 第四轮代码复核证据

报告：[review-20261117-2251.md](../review-20261117-2251.md)。基线：`feature/0.1.6`／`22b7722658d93519ac19ac1188d4376127506090`。本目录只承载复核证据，不回写产品权威执行账。

## 结果与入口

- [baseline.json](baseline.json)：开始时 HEAD、Git 状态与 94 个相关文件的哈希。
- [final-integrity.json](final-integrity.json)：结束时源码／HEAD 复核、链接检查和产物哈希。
- [test-summary.json](test-summary.json)：类型检查、现有测试及复核反例的归档统计与命令。
- 现有测试：216＋86＝**302 项通过、2 项真实模型冒烟跳过**；node／web 类型检查通过。
- [review-tests.vitest.json](review-tests.vitest.json)：最终 **63 项：原 54 项通过、新增 9 项失败**，新增失败归并为报告的 5 类问题。
- 旧反例复制到本目录，输出全部重定向；F06c 仅补 `itemBody` mock，预期不变，见[适配差异](probe-adaptations.diff)。
- 新反例：[boundary-core.test.ts](boundary-core.test.ts)、[boundary-ui.test.tsx](boundary-ui.test.tsx)；观察值为 [core](boundary-core-observations.json)、[UI](boundary-ui-observations.json)。

服务／驱动测试使用实际实现、内存 SQLite 和有状态执行器协议替身；组件测试使用实际 React 组件及 jsdom。这些结果不计打包 App 验收。报告中的本机原生实验另列如下，不与协议替身混称。

## 本机 Codex 协议实验

[native-resume-probe.mjs](native-resume-probe.mjs) 使用独立 HOME／CODEX_HOME／空测试项目，仅访问本机回环地址的合成 HTTP 401 后端，使用固定测试占位凭据。没有使用日常账号、会话、数据库或真实模型服务。

实验故意使显式模型回合失败，用于核对模型覆盖是否仍保留：初始默认 `gpt-5.1-codex`，显式选择 `explicit-other` 后，关闭进程再无模型覆盖地恢复旧线程，恢复响应仍为 `explicit-other`；`config/read` 默认仍为 `gpt-5.1-codex`。这是原生配置／恢复协议证据，不是成功模型回合或产品验收通过。

[原生观察值及退出状态](native-resume-observations.json)记录两个 ChildProcess 均 code 0、signal null；[CLI 版本](native-cli-version.txt)为 0.169.0。临时根只含合成数据，路径在结果中；监听已关闭。探针会创建新临时目录，重复执行应先复制到新证据目录并更改输出路径，避免覆盖历史。

## 复跑

仓库根执行，沿用现有依赖和 Electron Node 测试入口，不重建共享依赖。需要本机 IPC 的 DB 测试及回环监听，按已授权的隔离测试执行方式运行。

```sh
pnpm typecheck
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2251-scoped node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks src/main/db src/main/quit-flow.test.ts --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2251-ui node scripts/run-tests.mjs src/renderer/features/agents --pool=threads --maxWorkers=2 --reporter=verbose
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-2251-final node scripts/run-tests.mjs --config docs/review/evidence-20261117-2251/review.vitest.config.mts --reporter=verbose --reporter=json --outputFile=docs/review/evidence-20261117-2251/review-tests.vitest.json
node --check docs/review/evidence-20261117-2251/native-resume-probe.mjs
node docs/review/evidence-20261117-2251/native-resume-probe.mjs
```

**后续复核请复制到新目录并改写所有观察值路径，保留本轮历史。** 原始 `.log` 按仓库忽略规则保留本地，JSON、脚本和报告可归档。`review-tests-final.log` 对应最终 63 项 JSON。较早的 `recheck-tests.log` 是原 54 项复验；`boundary-core-tests.log` 的 Q01a 使用初版服务替身，源码保留为 `boundary-core-initial.ts.txt`；后续强化成真实 Codex 驱动的恢复＋查询＋停止路径，`boundaries-final.log` 和最终 JSON 对应现行反例源码。

# M14 阶段 1、2 代码复核证据

对应[评审报告](../review-20261117-1620.md)。日期 2026-11-17，分支 `feature/0.1.6`，HEAD `6e39ced908e126bbb3e4eb159b874603f4ac7fde`。范围 `36227ee0d..HEAD`；评审依据为需求 R2.0、设计 T1.5、用例 A1.8 和交接文档 §4。没有修改被评审生产代码，也没有推送、调用真实模型或操作日常 App。

## 输入与环境

- [baseline.json](baseline.json)：提交清单、开始时工作区状态、源文件与文档哈希。中文 Git 路径使用 `--name-only -z` 补齐，未把转义显示名当真实文件名。
- macOS arm64；系统 Node 22.23.1；测试使用仓库 `scripts/run-tests.mjs` 启动 Electron 的 Node 24.19.0，以匹配现有 SQLite 原生模块 ABI；Vitest 4.1.11。
- 本机 Codex CLI 0.169.0、Claude Code 2.1.326；锁定 Claude Agent SDK 0.3.321。未重装依赖或重编译共享原生模块。
- [sdk-contract-excerpts.json](sdk-contract-excerpts.json)：本机锁定 SDK 的模型、权限、子消息、目标和问答类型摘录及源 SHA256。
- [protocol/](protocol/)：本机 `codex app-server generate-ts --experimental` 生成的相关原生类型，输出初始位于本轮临时目录；未启动 app-server 模型回合。

## 原有检查

| 日志 | 结果 | 范围 |
| --- | --- | --- |
| [typecheck.log](typecheck.log) | 通过，exit 0 | 仓库 node/web 两份 TypeScript 配置 |
| [scoped-tests-verified.log](scoped-tests-verified.log) | 165 passed，2 skipped，21 文件通过、1 文件跳过，exit 0 | 交接指定 Agent、renderer 时间线、整个 DB 范围；真实模型冒烟关闭 |
| [agent-tests.log](agent-tests.log) | 76 passed，2 skipped | 完整范围之前的 Agent／时间线分组复跑，已包含在 165 项中，不重复统计 |
| [db-tests.log](db-tests.log) | 33 passed | 迁移分组复跑，已包含在 165 项中，不重复统计 |
| [pure-tests.log](pure-tests.log) | 8 passed | 能力／档位的小验证，已包含在 165 项中 |

完整范围命令：

```sh
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-1620-scope-verified \
  node scripts/run-tests.mjs src/main/core/agent src/renderer/features/agent-tasks src/main/db \
  --pool=threads --maxWorkers=2 --reporter=verbose
```

该次获准使用本机 IPC／测试进程能力，在隔离夹具中运行。初次沙箱运行未完成的 [scoped-tests.log](scoped-tests.log)、[scoped-tests-threads.log](scoped-tests-threads.log) 留作过程证据，不计产品失败；Electron codesign 的 stderr 提示本身也不能当作产品失败原因。

## 新增契约反例

这些测试**直接导入被评审生产类／函数／组件**，使用内存 SQLite、SDK／ChildProcess 对端替身及 jsdom，不以另写一个同义实现替代被测逻辑。退出验证通过 TypeScript AST 提取并编译 `index.ts` 中实际注册的两个回调，避免启动完整 App。所有反例采用既定合同作为预期，所以当前为红测。

```sh
M14_LIVE=0 WILLYOU_TEST_CACHE_DIR=/private/tmp/m14-review-1620-final-contract \
  node scripts/run-tests.mjs \
  --config docs/review/evidence-20261117-1620/review.vitest.config.mts \
  --reporter=verbose
```

- [review-probes.test.ts](review-probes.test.ts)：主进程／驱动／协议反例 17 项。
- [review-ui.test.tsx](review-ui.test.tsx)：实际任务组件的反例 3 项。
- [contract-probes-complete.log](contract-probes-complete.log)：最终 **20 failed / 20，exit 1**。均命中预定契约断言，没有夹具超时或导入错误。
- [probe-observations.json](probe-observations.json)、[ui-observations.json](ui-observations.json)：实际观察值；日志和 JSON 对应相同最终源码版本。

| 报告问题 | 反例 | 验证内容 |
| --- | --- | --- |
| CR01 | RC13 | 图片排队后软链换根，宿主读到根外合成内容 |
| CR02 | RC03 | 插话已消费但回执丢失，又派成普通回合 |
| CR03 | RC02a、RC02b | 启动期间停止、停止后目标孤立回合 |
| CR04 | RC11 | SIGTERM 未退出却释放 owner |
| CR05 | RC01 | 取消退出仍关闭 Agent |
| CR06 | RC04 | 36,000 字节输入变成字符串 undefined |
| CR07 | RC18 | SDK 未开始即失败，派发门闩不释放 |
| CR08 | RC15、RC16 | 发送后续草稿丢失、同一草稿两次入队 |
| CR09 | RC05 | 提问／elicitation 返回了审批类型的结果 |
| CR10 | RC17 | 只按数字键即发送批准 |
| CR11 | RC07 | Claude 第二轮未实际应用所选模型 |
| CR12 | RC08＋本机离线实验 | ask→full 缺启动许可 |
| CR13 | RC09 | Claude 子回答落到父任务顶层 |
| CR14 | RC10 | 原生目标清除后投影仍 active |
| CR15 | RC12 | 能力 disabled 未阻止命令调用 |
| CR16 | RC06 | UI 提供原生未公布的批准项 |
| CR17 | RC14 | 启动错误只有事件，快照看不到原因 |
| CR18 | RC19 | 用量受限归成普通失败 |

UI 层使用 jsdom；不计真实浏览器、系统输入法或打包 App 验收。SDK 和进程反例使用替身；不计真实模型消费、操作系统进程排空或生产业务认证证据。修复后应在产品测试目录补相应回归，并在所需层级实际复验。

## 本机 Claude 离线控制实验

[claude-permission-offline.mjs](claude-permission-offline.mjs) 导入锁定 SDK、使用本机 Claude CLI。每组使用独立临时 HOME、CLAUDE_CONFIG_DIR、空 settingSources；认证为固定无效合成字符串，端点指向本机未使用服务端口。**不向输入流提交任何用户消息，不发模型请求，不读取日常凭据。** 只发送 setPermissionMode 控制请求。

```sh
node docs/review/evidence-20261117-1620/claude-permission-offline.mjs
```

[结果 JSON](claude-permission-offline.json)、[stdout](claude-permission-offline.log)：

1. default 启动、不传 allowDangerouslySkipPermissions：bypass 切换被 CLI 拒绝。
2. default 启动、显式传 allowDangerouslySkipPermissions：同一切换成功。

两个新建的子进程均已关闭并观察到退出。这个实验只证明原生控制面约束，不证明真实模型、用户确认框或完全访问业务已经验收。

## 过程与范围保护

- `contract-probes.log` 是复核驱动初版误用 mergeConfig 合并 include 后带入范围外测试的中止记录；已修正为显式 include。未把其中本机私有通道失败作为被评审产品的新缺陷。
- `contract-probes-fixed.log`、`contract-probes-with-ui.log`、`contract-probes-final.log` 是逐步补反例的历史结果；最终统计只使用 `contract-probes-complete.log`。
- 每轮测试均在本轮缓存／临时夹具或内存数据库中运行；未构建、安装、运行日常 App，未改受评审源码或原验收证据。
- [final-integrity.json](final-integrity.json) 记录结束时 HEAD、输入哈希复核及工作区状态。评审报告和本目录是本轮新增产物；开始前已有用户改动不纳入本轮修改。
- 16:44 结束核对时，另外出现本轮未创建的 `src/main/core/agent/file-search.ts`、`src/renderer/features/agent-tasks/composer-menu.ts`、`composer-menu.test.ts`。这些并行增量保留，排除在本轮七提交基线与测试计数之外；最终完整性记录分别列出“原有状态保留”和“后来新增的状态”，不把新增文件误判为本轮改动。

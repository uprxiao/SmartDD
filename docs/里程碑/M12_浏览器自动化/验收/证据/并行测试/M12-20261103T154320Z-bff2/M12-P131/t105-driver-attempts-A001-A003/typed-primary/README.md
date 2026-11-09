# T105 typed-primary recorder

仅对已保存的本轮 Native journal 作文件取证。无 App、CLI、PTY、HTTP、模型、认证读取或生产修改；不增加正式通过数。A003 原 raw、原 parser、原 10 个业务 judge 保持原样。

```js
import {collectTypedPrimaryReceipts} from '/private/tmp/willyou-m12-t105-typed-primary-recorder-001/typed-primary-recorder.mjs';
const primary = await collectTypedPrimaryReceipts({
  journal: j,
  expected: {
    cwd, nativeSessionId, runId, taskId, projectId,
    turnId, // 本次实际 turn；多 turn journal 时必填，不能猜最近一条
    after  // 本次实际提交时间；可另传 before
  },
  hostInvocations: actualReadonlyHostRows,
  plan: actualHostRunPlan
});
// 先私有保存原 j、primary 和所有实际阶段证据，再由原 judge/Root 完整判定。
// primary.receipts 是独立 typed 来源，不能覆盖/伪装原 parser 结果。
```

`receipts[].childExitCodeObserved` 只来自实际 `item_completed.CommandExecution.exit_code` 的数值 0；同时要求 completed、同 thread/turn/cwd、唯一实际 operation/request、Host succeeded/attempt1/run/task/project/app/package/capability/effect、有效实际 CLI plan。完整 aggregated_output 必须直接是 v2 JSON，并校验实际直接 `willyou-app` argv 与 plan 的 capability CLI 前缀；不把 printf/复合 shell 的退出码当 CLI 子进程退出码。原始输出/typed row/Host row/plan entry 都绑定哈希。

模块不 import 旧 parser，不解释外层 JavaScript。`outerRecords` 保留完整原始 call/output 行，仅可私有落盘；可能有测试账号信息，禁止直接打印或安全归档。旧 parser 的 unsupported、credentialAccess、forbiddenEscalation 等在 `originalParserDiagnostics` 保留；Root 仍须保留明确危险门槛。未知外层载体仅诊断，不能据此中途关窗。未能证明的 v2 命令进 `failures` 并不生成 receipt；源文件身份/哈希/JSON 完整性错误仍抛出，调用者应先保留原始记录。

本次控制命令（已执行，纯文件）：

```sh
NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t105-typed-primary-recorder-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t105-typed-primary-recorder-001/controls.mjs
```

7/7：A003 原 line23 list、line28 create 两正控；wrong thread identity、numeric exit、status、duplicate operation、operation mismatch 五负控。负控只改内存副本。原 parser receipts=0、unsupported=2 均保留。`A003-typed-primary.safe.json` 是安全证明投影；完整 v2 数据及完整外层记录继续由原私有源 SHA 绑定。本次只补第一阶段的 producer 证据，不宣称 T105 已完成，不补造第二轮或 UI 判据。

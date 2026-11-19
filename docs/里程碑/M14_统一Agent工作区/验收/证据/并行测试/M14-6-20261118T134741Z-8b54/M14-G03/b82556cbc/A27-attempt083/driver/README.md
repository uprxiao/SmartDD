# A27 真实插件效果未知的实包复验

正式剩余判据为宿主崩溃后业务已跨效果边界但未回执。已完成的排队取消、单轮和子树停止，以及原进程、旧请求和真人队列的重启见 [021](../../../evidence-fef791bc6-local-collaboration/attempt-021/result.json)、[027](../../../evidence-a88ae2016-stop-native/attempt-027/result.json)、[035](../../../10b3190e3/attempt-035/result.json)。

本次由实际原生 Claude 2.1.326 通过生产 MCP 发起零连接本地插件写。使用 081 和 082 已验证的正式安装方法，私有种子同时核候选提交、ASAR、空连接、空凭据、空效果目录。插件只向本轮数据写一个固定凭证，以文件和目录 fsync 确认效果完成，保留真实原进程和 MCP 写入回执门闩。业务进入真实 UI，点击一次批准，其他操作未获得权限。

| 阶段 | 可判定结果 |
|---|---|
| 故障前 | 已有一条实际真人输入保留在队列，未进入模型。原父人工回合已获唯一原生标识并仍在进行。真实批准后，同一 operationId 的 agent_requests executing 和 application_invocations running/unknown 可见，attempt_count=1，私有文件存在且摘要已保存，原精确 App、Claude、桥及插件 PID/出生戳均核实仍在。 |
| 故障点 | 再核原 App 的 PID、HOME、userData、执行文件等身份，只通过该 App 的原 ChildProcess 故障接口终止本实例。原隔离 App 得到 SIGKILL 的指定回执。本试验不会结束日常 App 或子进程，无需系统对话框。 |
| 重启 | 在原隔离数据中启动新 App；实际核对旧原生、旧桥和插件运行都结束后再继续。原真人回合为 unknown/HOST_RESTARTED，原宿主业务提示结果未知、不自动重放；同 operationId 的效果状态仍 unknown，旧批准被拒，文件摘要和尝试账完全一致。应用调用账和具体展示状态分别取证。 |
| 等待和继续 | 观察不少于 3.5 秒，无动作时真人队列仍是原项，未到模型。真实点击该项立即发送，同一个 turnId 进入新 run 完成文字回答，没有再次申请插件或写入。新 App 正常退出。 |

只验证本地无连接插件的一般业务故障。SMTP 的钥匙串本人前置仍独立记录。此准备阶段未启动任何 App 或占用 3425；生产安装是否完成与真实预期只能在分配的打包时段执行。

从冻结源码目录，使用协调者指定的候选和唯一的独占资源，执行以下命令。此组包含故障原 App 和正常重启 App，只有这一专用私有路径发生预期故障。

```sh
M14_EXPECTED_SOURCE_COMMIT=<完整候选提交> \
M14_EXPECTED_ASAR_SHA256=<候选摘要> \
  /private/tmp/willyou-m14-stage6.WRvdST/g03/prep-next/a27-unknown-recheck/run-a27-unknown.sh attempt-<未用编号>
```

[驱动](a27-unknown-packaged.mjs) · [离线预检](preflight.log) · [SHA-256](SHA256SUMS)

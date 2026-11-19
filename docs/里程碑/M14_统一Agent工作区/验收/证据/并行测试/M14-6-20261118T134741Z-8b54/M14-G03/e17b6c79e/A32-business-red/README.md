# A32 081 业务批准使同面板原生审批不可操作

冻结候选 e17b6c79e1c6470f44c730aca85c2f76d02efa9d，ASAR SHA-256 ec923615e4703d6124fc85f3b13a9467940b087db809176d9a998ef1a85979ac。macOS arm64，原生 Claude 2.1.326 和 Codex 0.169.0。隔离用户数据与合成项目，模型仅走回环。插件无连接、无凭据，真实 App 将执行限在本批私有文件。077 的 ASAR 校验夹具故障已修，081 实际完成生产安装前置。

| UTC | 已观察 |
|---|---|
| 21:19:01.733 | 业务 f85d99a5… 的阶段为 executing。原 Claude PID 10748（出生标识 darwin-proc-v1:1795036740:234239），插件 PID 10857（darwin-proc-v1:1795036742:216859）。实际调用 025de39b… 与原父 run 3adc5c31… 一致，尝试计数 1。 |
| 21:19:02.833、02.926 | 两个共享写子通过真实原生 MCP 取得 queued 收据。 |
| 21:19:03.458 | 关系卡停止第二写子，其原排队取消，首个子仍排队。 |
| 21:19:03.850 | 同一 Claude 父的原生命令 06cbe4bd… 产生 command_approval。驱动真实切到 2/2，核精确命令和私有路径。批准控件未达到可交互条件，11 秒超时。此期间原父未写，原写子没有启动 native 会话。 |
| 21:19:15.164、15.173 | 驱动超时进入清场后，释放本地插件门闩，业务落 finished。随后任务清场使原命令 retired，不能计作用户操作或正向交槽。 |
| 21:19:15.335 | 原父实际结束。测试 App PID 10616 正常退出，无 renderer 错误，进程与 3425 端口核空。 |

原界面中同一个 RequestPanel 组件维护单一 busy 与 submitting；宿主批准 IPC 等业务执行结束才完成，所以切换到独立原生请求后仍带着前一业务的禁用态。源码复核位置为 agent-task-view.tsx 531、596–619 和 host-business-requests.ts 175–190。当前实包记录保留截图、实际动作和请求事件，未保留失败前 DOM disabled 属性的单独快照。待针对此状态补浏览器层或组件层红测。

[实际结果和动作](attempt-081/result.json) · [2/2 原生审批截图](attempt-081/99-failure.png) · [原排队与取消](attempt-081/10-queued-and-one-canceled.png) · [原生请求、队列与清场时序](attempt-081/readonly-before-cleanup-context.json) · [实际种子结果](attempt-081/seed.log) · [实际插件凭证](attempt-081/actual-plugin-effect.json) · [SHA-256](SHA256SUMS)

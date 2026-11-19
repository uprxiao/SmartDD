# A27 无凭据的本地持久写入故障

正式 A27 的末项检查宿主崩溃后的自有进程、桥与未知业务。通用未知写入可以由真实插件写能力触发。SMTP 单独保留在人工钥匙串前置，当前方案不修改其配置、系统弹窗或凭据。

## 准备与边界

[包生成器](build.mjs)的插件无 provider、无连接 slot、无网络权限。它只接受固定的合成 marker 和真实宿主提供的 agent operation/run/project 作用域。真实 Worker 写到本轮 plugin-data 目录，运行时校验目录、文件打开方式和重复尝试。插件显式声明写能力、retry=never、maxTier=ask。每次派发先追加并 fsync 本机计数账，然后以独占创建写入 effect.json。写完文件和目录的 fsync，才生成 effect-flushed.json 供外部观测。确认标记出来时，Worker 保持原进程且无 execute 响应。不存在 SMTP 收件人、服务 URL 或密码。

打包前置可经标准产品 PluginHostService.inspect/install 在一次性 userData 上安装到实际 ResourceStore 目录，再由打包 App 读取和核对插件 ID、包哈希及是否选入项目。也可以用实际设置页和已授权的原生路径选择器安装。安装只是 A27 夹具准备。若使用前置脚本，原生进程 helper 与运行 executable 取同一候选包，安装关闭后 SQLite 和资源树留给真实 App。项目未选中时可用现有项目设置保存空连接选择，留证当前 manifest 确实没有 provider / slot，并在打开原生回合前核对 launch snapshot 含唯一能力。

## 打包验证动作

1. 用实际打包 App、隔离 HOME/userData 和本机合成模型启动 Claude 或 Codex。通过真实输入让模型只调用该私有插件的输出通道。业务写进入 M14 请求面板，先确认文件和调用计数不存在。由 UI 明确批准一次。
2. 等候 effect-flushed.json 并核验实际包哈希、业务请求 ID、operationId、taskId、runId、项目与 Worker PID。该 operationId 在 agent_requests 和 application_invocations 应相同，原状态是 executing/running，effect_state 已为 unknown，并且应用还没显示成功。记录该轮原生进程、桥进程和插件 runtime 的生前身份。尝试计数必须为 1。
3. 用公共驱动只作用于经过身份校验的隔离 App 原 ChildProcess，在回执前故障中止。按 035 重启相同私有 userData，核对 App PID 已变且原归属的 Agent、桥与 Worker 没被当作新运行。检查原 operation 在账本进入 unknown 或保留待核实，并在可达界面显示未知。有效重复批准/旧响应必须失败；原处理结果不能写成成功或未开始。未知记录不能提前释放活着的工作所有者。
4. 待确定重启仍无重复副作用，核对私有文件摘要和尝试计数始终为 1。用独立走最小文本回合核对本次恢复后可安全重新工作，并确认不会自动重新调用写能力。App 按正常流程退出和释放所有私有监听。真实 SMTP 阻塞不追认为已通过，write 方法的通用崩溃验收独立入账。

## 现有证据

- 生产插件载入器及 MCP 冻结器接受这个零连接写能力。实际加载与冻结测试 1/1，必填 marker 及禁止额外路径的 Schema 生效。[生产载入测试](a27-package.test.ts) · [日志](production-schema.log)
- Node 协议前置 3/3。在本轮独立目录实测写后保持原进程、没有回包，重复输入能被计数但不能覆盖效果、错误来源或目录不写入。[Worker](runtime.mjs) · [运行前置](runtime.test.mjs) · [日志](runtime-tested.log)
- 产品现有 I 验证支持丢失结果的原生插件写入、原 operation 只执行一次，以及 unknown 维持不重放。 [插件失败 I](/Users/liubu/hx/4.uprxiao/SmartDD/src/main/core/applications/plugins/__tests__/session-tools.test.ts:193)
- 当前未安装到任何运行 App。实际审批、栈故障、重启和实际资产恢复仍需分配测试候选与槽位。

# P018 证据边界

仅实际 CLI/M11/BrowserService/SQLite/内核与合成 HTTP Basic 站点的 I。没有 App 用户点击、外站、真实账户或真实 Agent 模型。随机密码由冻结宿主内存创建，通过私有 IPC 仅供驱动内存持有，再经真实 CLI stdin 送入；不保存该 precondition 响应、stdin、密码或 Basic 编码。对原始 stdout/stderr、真实 ps args、现存证据文件使用内存 canary 检查，只输出布尔。若发现实际输出泄漏，仅保存 flags 和脱敏结果，不复制秘密。

真实进程参数核对使用明确的私有 stdin 投递门闩：现有 launchCli 增加默认 false 的 holdStdin 测试参数；新测试 IPC 只创建真实等待输入的 CLI，再在真实 ps -ww 采样后结束其 stdin。被测服务、认证处理器、权限、预算和业务返回不变。另加只读 CLI PID 通知以精确收尾。真实 s4-auth-cancel 和 s2-close-page 只作技术 I 的用户取消/关闭前置，不冒充 App A 或 Agent 代答。

原冻结1812文件字节保持，独立运行 SOURCE 补充恢复原 P016 带架构哈希的元数据。模式补充 df7fff8067c806769cf55703942a92d9e3dfb4e32c9510f48179fd1c2a06f2a6 仅在本 attempt 私有 work/resources 把三件真实原生产物恢复0755，字节不变；actual X_OK 和当前诊断 PID 的真实 identity probe 留 native-mode-preflight.json，probe child 已 exit0。静态预检中的 nativeStarted:false 指被验收 App/CLI 尚未启动；诊断原生 probe 已明确单列，不能理解成从未执行任何原生文件。

上一 attempt 于 ready 前身份核验失败，未发认证业务，已有303文件 manifest85c3ef94f3d04c5d744a86529ac2a87098b39990312e6708ca1f3af07ec9bb69，原始不改；本 attempt 是修复原生产物可执行位后的首次业务，不重放已发写操作。最终以 result.json 独立判定为准，脚本 exit0 不代表业务通过。

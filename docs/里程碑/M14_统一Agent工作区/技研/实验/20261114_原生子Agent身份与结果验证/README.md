# 原生子 Agent 身份与结果：独立技术验证

依据需求 R0.2 的 R05／R06／R11／R12、验证账 Q29。固定 macOS arm64 原生版本：Claude SDK 0.3.321／Claude 2.1.321、Codex 0.167.1。两条正常路径通过；模型仅本机受控 SSE 响应，隔离 HOME、工作目录与合成凭据，零付费模型请求。不是实际模型自主规划质量测试。

| 执行器 | 已观察并断言 |
| --- | --- |
| Claude | 真实 Agent 调用自定义 m14-child；实际异步启动。task_started 的 task_id／run_id／tool_use_id 与子 assistant 的 agent_id／parent_tool_use_id、最终 task_notification 关联。父子共享 native session_id；完成通知进入后续父模型请求，父输出最终标记；后台集合最终为空，原生进程 exit 0 |
| Codex | 真实 spawn_agent 创建不同 native child thread；collabAgentToolCall 保留 sender／receiver，wait_agent 收到真实子结果；父子 turn/completed 具有共同 rootTurnId，分别 completed；原生 app-server exit 0 |

成功批每端四次本机模型请求，父三次／子一次；各自父子请求 model 一致。仅验证此处继承路径，不泛化为跨账号、子模型 override 或 DeepSeek 服务兼容。没有建立 WillYou run、调用宿主委派接口或修改业务数据库。

T3 源码确实把两端原生子任务投影为带 childThreadId 的任务节点，origin 明确为 provider_native。不要误写成“原生子任务不能出现在宿主任务树”；也不能因有宿主投影 ID 就授予它独立宿主 run、跨 Provider 迁移或新的业务凭据。这部分是源码核对，未在本轮运行完整 T3。

失败记录完整保留：最初两端本机监听被环境 EPERM 拒绝，未启动原生进程；取得执行权限后，Claude 驱动误认为下一次父请求立即包含子结果，导致模拟服务 500／重试，watchdog 结束探针、捕获进程退出 143；子任务本身曾 completed。修正为接纳先返回等待消息、随后接收通知。Codex 驱动误用旧 wait 工具名，父回合 failed、子已执行、进程 exit 0；按实际 tools Schema 改为 wait_agent(targets)，成功。model 工具名 wait_agent 对应协议 item.tool 为 wait，不能直接混用。

范围限制：未验单 Agent 禁用强度、原生权限继承、子任务业务 MCP、递归停止、宿主退出／恢复、跨 Provider 改绑、最终 UI 或其他平台／版本。普通成功退出也不等于已证明任意子后代均能强制停止。Q29 从待验推进为部分。

复跑：在具有 localhost 监听权限的环境中分别执行 `node probe.mjs claude`、`node probe.mjs codex`；使用 native-inputs 中指定并校验的隔离依赖。`python3 prepare.py` 对原始帧做关联断言并生成归档，不写产品源码。原生运行参数、请求、帧、失败和成功脚本快照见原始证据。

[结果](result.json) · [源码基线](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。

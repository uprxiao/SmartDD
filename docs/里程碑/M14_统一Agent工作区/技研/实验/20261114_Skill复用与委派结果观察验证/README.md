# Skill 复用、真实委派与结果观察验证

日期：2026-11-14。对应 M14-R05／R06／R07，补 Q08／Q20／Q23／Q24。**只验证候选设计，未修改产品、共享原型或依赖文件。** 使用临时 HOME、合成凭据、本地模型端点及临时 SVN WC，没有真实供应商或业务调用。

## 本轮结果

Claude→Codex（attempt-z69hLe）和 Codex→Claude（attempt-1HpHtq）各三项，共六项通过：首次使用；重开宿主后复用并重复读取／确认结果；读取目录后目标停用，拒绝创建子委派。累计 14 次真实 native 运行、45 次本地模拟模型请求、28 次私有工具调用；六个捕获的 Node worker 正常退出。详见[结果](result.json)、[原始归档](raw-evidence.tar.gz)和[文件哈希](evidence-manifest.json)。没有把运行次数计作六项之外的新用例。

实际复用 SmartDD 的 syncAgentSkillLibrary、CapabilitySessionRegistry／RunRegistry、ResourceStore、PrivateApplicationBroker、AgentBridgeProcesses、ApplicationToolService 和内核 peer 检查；执行真实 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1。构建仅替换测试 runFixture 的 cwd、Codex runner／配置根及 Vite raw 资源导入，见[构建及源码哈希](build.json)。委派目录、SQLite 队列／目录租约／观察账以及工作写入是独立候选，不是产品服务。

## 关键断言与边界

| 场景 | 实际核对 |
| --- | --- |
| 一次安装、重复选择 | 每个父 HOME 只调用一次实际 Skill 库同步。三个新宿主 worker 使用相同正文摘要；后续输入仅选 Skill 并给本轮任务标识，没有重复粘贴规则 |
| 当前调用确实加载 | Claude 调用原生 Skill 工具并核对本轮新增的 tool_use／tool_result 和正文；Codex 使用 extraRoots/set、forceReload、typed skill，核对本轮输入后的 skill 块。没有用旧历史包含标记来冒充本次加载 |
| 同目录异步交棒 | 父经真实私有 MCP 接受 waiting_parent_release，父 run／登记进程及资源排空后子才取得目录；子完成并排空后恢复同一父 native ID。四次子合成文件写入各一次，没有 SVN 全库复制 |
| 通知与结果分离 | 首次恢复模型请求只有完成通知，没有当前子结果正文，观察行数量仍为零。随后通过真实 MCP 读取结果，下一次模型请求中出现该结果及本次观察 token，才发显式确认 |
| 重复操作 | 第二轮在同一恢复 run 内读两次、确认两次，返回同一 token、ack_count 始终为一；不是并发竞争或跨进程崩溃试验 |
| 目录读取后停用 | 目录返回可用目标后候选将其停用；实际 MCP 委派路径返回 TARGET_UNAVAILABLE，无子委派行、无子运行或文件、没有默认目标回退。停用开关在夹具内存中，不代表已接入实际配置服务 |
| 收尾 | 14 个实际 run 全部 stopped，运行资源租约 released；两个候选队列均无持有的目录租约。SQLite 完整性／外键检查见[审计](audit.json) |

本轮使用共享 Skill 库，没有测试 FrozenPluginSkills 的 owner 联动；相对脚本／资源执行沿用前批独立证据，不算本轮覆盖。父子 capability store 预创建、分库存储，没有同一全局事务创建子任务／receipt／outbox。测试包的 query／write 工具只是实验载体，不是正式编排 API；read_result 会写观察尝试账，因此使用 write 载体。原始 trace 的 private-write-entered 是沿用的通用进入标记，实际读写语义应以 invocation 表为准。

## T3 对照与候选差异

本地 T3 ProviderContinuationService 以 queue_after_active 发送完成通知，引导父 Agent 用 task_status 读取结果；OrchestratorMcpService.taskStatus 调用 readTask(..., false, true)，本地终态分支在返回响应前派发 completion-delivery.acknowledge，并记录当前可用的父 run。见[源码版本与哈希](t3-reference.json)。因此不能把 T3 的服务端读取确认描述成模型已收到正文的传输确认，更不能推导为真人授权。

本轮探索的是 WillYou **候选显式确认**：通知 accepted → 结果 offered → 当前 run 带 token／结果摘要确认 observed。它不是 T3 现有工具 API，也不证明模型理解了结果。本地模型被编程控制，主动读取与确认的行为是人为安排的；实验仅证明真实 Skill／MCP／原生上下文可以承载这条路径。正式选择独立确认还是由适配器提供可靠送达证据，仍需完成协议和故障验证，不能因本实验通过就固定新公共 API。

尚未验证结果读取回包前后断线、确认已提交但响应丢失、跨 run token 的实际攻击负例、父忙与主动读取／自动通知竞争、切换父 Provider、完整身份来源账或业务授权。也没有验证真实模型自主遵循规则、UI 选择入口、平台版本矩阵、10+GB 项目性能或任意进程写入隔离。共享目录单写入者仍依赖受管范围排空，不是操作系统独占。

正式产品验收仍为 **54 条、0 通过、54 未执行、0%**；Q08／Q20／Q23／Q24 继续为部分。

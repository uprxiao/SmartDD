# 结果观察回包中断与恢复验证

日期：2026-11-14。对应 M14-R05／R06；Q24。**本批为技术研究／隔离故障验证，不是产品验收，不修改业务代码、共享原型、依赖或用户数据。** 使用临时 HOME、本地模拟端点与合成凭据；终态子结果预置，没有本批真实子任务或业务执行。

## 结果与真实边界

Claude（attempt-u6KwKs）和 Codex（attempt-8wr9Ik）各两种中断，共四项通过、八次真实 native 运行、十八次本地模型请求、四次捕获实验宿主 PID 的 SIGKILL。[结果](result.json)、[原始记录](raw-evidence.tar.gz)、[文件摘要](evidence-manifest.json)、[数据库审计](audit.json)均保留。没有本批失败重跑。

复用前批实际 SmartDD owner／session／resource、私有 MCP／ToolService／内核 peer 及原生 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1。原构建产物按哈希复制，产品模块未改；测试 fixture 的 cwd／runner／配置根和 raw 资源导入替换沿用原[构建记录](build.json)。临时 native 驱动仅增加候选 execute 已提交后的等待点，停在 ToolService 保存成功及桥回包之前。SQLite 观察账为独立候选。

停止前用 kqueue 对实际捕获的 root／bridge PID 登记退出事件，登记成功才杀宿主；等待退出并核对进程起始身份后，用原数据库调用实际 run recovery。没有按名称杀进程，也没有直接把实际 run 行改成 stopped。故障只覆盖受控 root／登记 bridge，不证明所有可能逃逸的后代已结束。

## 两类窗口

| 窗口 | 故障前事实 | 恢复后行为 |
| --- | --- | --- |
| 结果已生成，回包被挂起 | 候选保存 offered／token，但正文未进入下一次模型请求；没有 ack。外层工具调用仍 running、effect_state=unknown | 旧观察标 delivery_unknown，保留旧 token。实际 owner 排空后，由显式恢复输入开启同一 native 会话的新 run，重新读取已存结果，不重跑子任务。新 token 与旧 token 不同；实际 MCP 用旧 token 确认被拒绝，再用新 token 确认，累计 ack_count=1 |
| 确认已提交，确认回包被挂起 | 正文及 token 已进入模型请求，模型发起确认，候选 observed／ack_count=1 已提交；外层确认工具仍 running、effect_state=unknown | 实际 owner 恢复不抹掉候选确认。新 run 只读持久状态及 observedByRun，不再 offer 或重复确认；确认仍归原 run，累计 ack_count=1。这个收据不等于新 run 已重新读取正文或任务目标完成 |

两类中断后候选目录租约都先保持 held；核实际旧 run、进程及资源排空后才释放并进入显式恢复。最终所有八个实际 run stopped、运行资源释放；两个回包缺失案例的旧观察继续 unknown，两个确认已提交案例保留 observed。结果不会因进程退出被统一标成成功，也不会因外层回包缺失被统一改成未发生。

## 对现有实现与设计的发现

实际 recoverCapabilityRuns 会将死亡 owner 的活动结束、运行停止并释放资源，但不改 application_invocations 的 running 行。四例都留下一个 running／effect_state=unknown 的旧调用。这是现有恢复职责的实证，不是本批修复的产品缺陷。M14 读取模型必须联查 run／owner：停止运行的遗留 running 不能继续展示为活动执行，也不能推断为成功或可重试；保留原记录，显示待核实，并查询对应业务／编排账。

候选观察已提交与通用工具回执未知可以同时成立。恢复需以结果 ID／修订／摘要／所属 task、binding、run 核对权威观察记录；完整作用域合同仍待接入，不能只看 UI 状态或模型自报已读。无可信业务记录时保持 unknown；发现精确确认时保留其原观察者，不重新执行外部工作。新 run 想读取内容，应显式读取，不能把旧 run 的 token 搬过去。

## T3 对照与未覆盖范围

T3 本地 task_status 在返回前派发 completion-delivery.acknowledge；DelegatedCompletionDelivery.test.ts 另包含不同 commandId 重复 acknowledge 的状态不变检查。本批只读这些源码／测试，没有运行 T3 故障用例。见[源码哈希](t3-reference.json)。T3 服务端读取确认与 WillYou 候选 token 确认不是相同 API，不能用候选通过声称 T3 存在或已修复网络问题。

本批中断发生在候选 commit 后、ToolService 成功与 socket 写入前。没有覆盖 socket 部分写入／已写但未被 native 消费、原生已接收却未进入模型请求、确认自身提交前崩溃、父忙／多结果竞争、跨 Provider 切换、完整 outbox 原子创建。模拟模型严格安排读取／确认，不证明真实模型遵循协议；输入来源账、业务授权、冻结 Skill、真实子树及 UI 仍不在本批内。

现行技术方案继续选择“分开记录通知、读取与确认并按事实恢复”的方向。独立确认工具与适配器送达证据的具体公共协议尚未最终定型。本批只为其故障语义提供证据，不提前实施产品。

后续产品用例清单仍为 54 条、已执行／通过 0、待执行 54（0%）；该清单仅是未来开发后的验证准备，不表示当前正在进行产品验收。

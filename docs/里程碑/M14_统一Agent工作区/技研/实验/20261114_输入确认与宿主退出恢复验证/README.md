# 输入确认与宿主退出：持久恢复验证

2026-11-14；R03／04／05／06／12，Q14–18／24–28／46–48／54–55；技术方案 §6.2、验证账 §4.56。技术研究，不修改产品或原型。

## 执行路径

临时输入账保存 commandId、inputId、文本／来源、完整目标 scope 摘要、派发状态与原宿主 PID／出生身份。回调用本进程私有句柄校验原 owner，再把原生 item/completed 用户输入事件写入独立 inbox；事件确认与输入 receipt 应用分开，使已持久事件可以在后续进程对账。scope 字段是实验生成的 task／binding／run／generation，并非本轮真实 CapabilityRunRegistry 记录。

初始 worker 启动真实 Codex 0.167.1 app-server，对本机合成模型服务发送输入。驱动只在已收到明确 checkpoint 后 SIGKILL 自己捕获的 worker；四个有 native 子进程的场景先注册 macOS kqueue NOTE_EXIT，再核对实际进程出生身份已 stopped。不是按名称查 PID 或等待固定时间猜退出。子进程原始退出码因父 worker 被杀而不可用，不能写成 native code 0。

恢复 worker 只读取原输入和 durable inbox，不创建 native 进程、不重发输入，也不建立业务桥或 live 授权。恢复前要求原 owner 已停止，锁内再次比较原行；存活和身份未知拒绝。

## C01–C08：attempt-GZUUOY

| 场景 | 实际结果 |
| --- | --- |
| C01 只登记 queued 后退出 | 没有 native 或模型请求；新进程判断 not-dispatched。原 owner 仍活或出生身份故障变成 unknown 时均拒绝恢复 |
| C02 dispatching 落库、尚未写 turn/start 时退出 | 已启动 app-server，但无模型请求。恢复仍为 unknown，不凭“实验知道没写”替代产品的持久未发送证明 |
| C03 原生实际完成、确认尚未记入 inbox | 模型服务有一次请求，驱动看到真实接受和终态；输入账没有这些持久证据。恢复 unknown，不重发 |
| C04 inbox 已提交、输入 receipt 尚未应用 | 新进程从固定 scope／frame 摘要和原生 thread／turn／item／clientId 补齐 accepted 审计回执；不会据此补写模型成功终态 |
| C05 receipt 已提交、回包前退出 | 返回原接受身份；重复恢复结果一致，没有第二次 native 调用 |
| C06 相同 commandId 重试／冲突 | 读取原 unknown 回执，不签发新的私有派发句柄；同命令不同文本拒绝 |
| C07 inbox 换 thread 并重算摘要 | 仍因原 scope 不匹配拒绝，原接受回执不改写；hash 正确不能替代归属校验 |
| C08 同 clientId 的两份真实接受 | 回放 §4.55 中实际 Codex 两个不同 turn／item 的接受帧，拒绝 AMBIGUOUS_NATIVE_ACCEPTANCE；不猜配一条回执，processed 标记一起回滚 |

五个切点每个都另起两次恢复 worker 验证回执稳定。共 17 个 worker：5 个计划内 SIGKILL、10 个恢复成功 code 0、2 个活／未知 owner 拒绝 code 1；另有 4 个 kqueue 观察 helper code 0。四个 native 均确认退出；总 3 次本机合成模型请求，恢复阶段零 native spawn／零模型请求。

首次 attempt-CaUUXd 在本机监听遭 EPERM，无 worker／native 执行，保留预检结果；在已批准隔离监听范围重跑，未改实验逻辑。全部最终脚本与真实源码输入 hash 已复核。

## 设计边界

C02 与 C03 的恢复结果同为 unknown，但外部事实分别是未发送和已完成，说明单靠 dispatching 行不可能推断外部执行。任何“失败就重发”的方案都可能重做已完成工作。Provider 切换、同 Provider 新 binding、委派 prompt 和子结果投递都不能绕开该未知状态。

inbox 有完整且唯一的接受证据，才能补原输入的 accepted 审计；原生接受、模型终态、业务副作用、父已观察仍是不同记录。本批仅持久化用户输入接受帧，即使驱动看到了 turn/completed，也没有擅自升级成功状态。

queued 的结果仅证明没有进入派发路径，不证明原空 native thread 可恢复或完整后续发送已验证；真正重试前仍须核原目标、配置、权限和执行资源。恢复回执不是自动恢复真人 live 来源，不能绕过原业务的 proof／claim。

当前 inbox 由临时单 owner 脚本写入；正式实现仍须接到真实 driver 通道、业务 run／generation、规范事件持久化、输入来源和 UI sender，补 Schema／预算及原子事件消费合同。没有覆盖主机断电、消息部分写入、子进程继续活着时的恢复、Claude、真实业务副作用或父子结果完整联合。C08 是真实旧帧回放，不冒充该次 live 回合。

T3 的 Orchestrator 在 command receipt 已存在时走 replay，并防止跨 thread 重用；可参考宿主命令幂等层，但不能把宿主 receipt 与 native 执行完成混为一谈。本批没有验证 T3 的 native 崩溃恢复策略。

## 证据

[结果](result.json)、[进程及恢复审计](runtime-audit.json)、[源码依据](source-review.json)、[文件哈希](archive-manifest.json)、[驱动、线帧与数据库](raw-evidence.tar.gz)。80 文件，15 份 SQLite 完整性和外键通过；370 个真实构建输入核对。完整 native HOME 未重复归档，关键线帧与数据库快照已保留。

复跑限新临时目录，需 macOS kqueue、已构建进程身份 helper、隔离依赖及 loopback 监听；脚本会终止自己捕获的 worker，不能换成用户进程。Python 仅是观察工具，不是产品依赖决策。

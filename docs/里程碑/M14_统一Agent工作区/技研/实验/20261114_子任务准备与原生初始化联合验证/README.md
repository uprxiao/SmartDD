# 子任务准备、运行预留与两端初始化：联合技术验证

日期：2026-11-14。对应 R02／06／08，Q04／06／13／19／24；技术方案 §3.2.13、§7.1，验证账 §4.45。仅临时目录中的技术实验，没有修改产品或共享原型。

## 补齐的链路

本批将之前分开的子任务原子创建、新能力来源／直接预留、执行配置修订、ExecutionPlan／delivery 和真实原生初始化接到同一数据库／运行注册器。父 Codex 先真实初始化并由实际 owner 判 active；候选宿主服务直接接受子请求，再产生 tasks／planned binding／turn／delegation／receipt／outbox，之后创建新 scoped 能力会话，直接预留实际 run，提交应用计划与宿主计划并初始化子 Claude 或 Codex。

父模型没有发出委派工具调用；这批通过宿主服务直接输入请求。未接 Skill／MCP 委派 transport、业务桥或真实对话。每个子任务使用独立的临时目录，未测试共享 SVN 写入协调。不能把上述初始化联合等同于完整多 Agent 功能。

## 最终结果与负对照

`attempt-OhDFnc` 的 K01–K11 通过。最终批次三个原生初始化：一个父 Codex、一个子 Claude、一个子 Codex；三个均取得实际退出。四个保存轮次共十个自有进程，均已核退出。没有模型 turn、thread/start 或真实业务写入。

| 项 | 实际证明 |
| --- | --- |
| K01／K11 | 子接受使用当前实际 owner；相同逻辑请求返回同一 child，改内容拒绝；接受事务末尾异常整体回滚 |
| K02 | 发布成功后注入回执失败，再次发布返回同 cap／scope；前批原样 publish 在同一重试上报 BINDING_NOT_PLANNED，作为负对照 |
| K03／K04 | 运行请求收据与 run／plan／资源／进程及 outbox reserved 状态同事务；回执异常后复用同一进程内私有句柄和 run；收据插入失败则全部回滚，代次不增加 |
| K05 | 宿主计划准备在 pins 后失败，计划／delivery 回滚；重试使用原 reserved run，只有一份 delivery |
| K06 | 子 Claude 真实初始化提交后注入回执异常；新候选 executor 查询同一 initialized 状态，无第二次 spawn |
| K07 | 同一进程两个重复派发请求共享子 Codex 初始化，只有一次 spawn |
| K08 | 另一个 registry 即使在同一进程读取到持久回执，也不能据此重建私有 owner；要求恢复对账 |
| K09／K10 | 接受后改配置在领取时阻塞；预留后再改配置在宿主计划事务中拒绝，保留原任务／回执，无新计划 |

两个早期全批 `attempt-d1lvDi`／`attempt-JKrpUh` 的 K01–K09 有效；K10 使用固定的轮换值，前一项已写入同值，故第二次未改变配置修订。该失败是无效故障注入，不能证明候选缺陷。修正为唯一合成值并断言修订确实增加后，以旧 execution 候选单跑 `attempt-4oGwlf`：接受修订 1，实际变为 2，旧候选仍生成修订 2 的计划，取得有效负对照。最终将接受时目标修订存入 outbox，并在计划提交事务复核后，全批通过。原始输入／失败／数据库均保留，不用早期绿项替代最终联合结论。

所谓回执丢失均为**同进程提交后抛错模拟**；不是网络断线或宿主 SIGKILL。K07 也不是多进程 worker 竞争。初始化确认只表示原生握手成功，不表示任务已开始执行模型指令或完成工作。

## 收口的设计约束

1. 逻辑请求键、能力发布收据、运行尝试与原生启动分别记账；任何一层的重复请求都不能自动建立另一层的新身份。
2. 新运行预留必须与对应 outbox／运行请求收据同事务。不能先提交 run，再单独写 effect→run 关联，留下恢复时无法判定的窗口。
3. 已接受的目标修订属于本次派发，随 effect 固定，不读取“最新默认项”来替换，也不长期借用 binding 的兼容修订含义。计划准备与启动门禁都核对本次明确选择。
4. 持久回执可以返回事实，不能恢复 WeakMap／私有句柄或授权另一个宿主控制进程。已 initialized 的重复查询不得再次 spawn；dispatching 无明确证明时保留待核实。

T3 EventSink.commitCommandEffect 先在事务中保留 command receipt，再写 events／projection／outbox，提交后通知；Orchestrator.replayCommandReceipt 校验原 thread 并读取原事件。WillYou 借鉴持久提交和作用域核验，不照搬全量事件溯源，也不从 T3 推导跨进程外部操作恰好一次。

## 仍未证明

实际宿主崩溃后新 worker 的接管与新运行尝试、真实 socket 丢包、多个 worker 竞争、提交与 fork 间停止及 native 首次 ID 回调仍需联合验证。本候选每 effect 只有一个 run 收据，未实现重启后可安全创建下一 attempt 的完整协议；不得用丢弃回执或改 claim token 绕过。能力发布的幂等复用覆盖首次 native ID 之前，当前 revision 已变化后的历史发布收据查询／执行分离仍需补。

执行器资源、能力包及密钥均为隔离夹具；配置服务和运行所有权使用实际组件，密文加密器是假实现。没有完整资源安装／版本迁移、SDK 参数映射、后代进程范围、业务来源授权、历史接续或 UI；旧实验格式没有升级迁移。保留所有这些边界，不能称为产品联调或验收。

## 证据与复跑

[最终结果](result.json)、[有效负对照](baseline-negative.json)、[运行审计](runtime-audit.json)、[源码依据](source-review.json)、[文件哈希](archive-manifest.json)、[全部轮次原始证据](raw-evidence.tar.gz)。归档 277 个文件、36 份 SQLite，完整性和外键通过；504 个构建输入已核当前哈希。

在新的临时目录恢复匹配依赖及源码基线，使用归档中已生成的最终 `.variant` 文件，依次成功执行 `node build.mjs`、`node profile-build.mjs`、`node probe.mjs`。`make-variants.py`／`extend.py` 是本次构造记录，不应向已经扩展的最终文件重复套用。原生程序／SDK／进程身份 helper 的版本和 hash 在运行审计中；仅使用独立 HOME、合成凭据及不可用 loopback 模型地址。不连接用户库，不将候选表当作产品迁移。

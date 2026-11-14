# F01 公共命令与共同数据事务验证

结论：F01 的逻辑提交合同收口，最终 12 项隔离检查通过。没有修改产品、运行原生 Agent、调用模型／业务写服务或执行正式验收。原型用真实 SQLite 与 P1 Schema，权限、目标解析及最终删除资格为显式依赖夹具，不能当作实际授权服务已接通。

## 解决的设计缺口

C1.1 的 m14_input 要求已有 runId／generation，P1 的 turn.state 也要求运行 scope；直接用于首次提交，会迫使宿主先启动进程再保存输入。P1 还没有可见任务删除的规范事件。

C1.2 候选增加不可变 m14_submission，保存逻辑输入／目标／来源／blocks，并关联允许尚无 run 的 turn。公共命令收据 m14_command_receipt 与草稿清空／版本、事件和序号同事务写入；m14_input 留作分配真实运行后的投递／证据记录，新记录必须匹配逻辑输入。旧证据保留，不自动补造可信 submission。内部历史／结果等来源仍是宿主私有通道，公开 input.submit 不能自报来源。

P1.1 补 input.queued（input／turn／binding 身份）及 task.record.changed 两类任务级事件，不伪造运行 scope。逻辑接受不等于原生 accepted、目标任务完成或业务授权。

通用命令收据是命令重放依据；现有委派 m14_receipt 保留为来源投影，两者必须同事务生成，不能分别重试、改变来源或各自决定结果。相同 clientInputId 的新 commandId 在原请求一致时关联原逻辑输入；目标／草稿后来改变不导致重发。冲突拒绝；调用权限在查重前复核。历史收据的 queued 只描述当时接受结果，当前状态另从投影读取。

## 三条事务与副作用边界

| 命令 | 事务内 | 事务后 |
| --- | --- | --- |
| input.submit | 可信入口／目标解析前置；复核 selection／draft；冻结 submission／queued turn；草稿清空并升版；事件／taskSeq／命令回执 | worker 在统一准入下分配 run，绑定原生投递身份；不在接受事务里 fork、发消息或授予 live grant |
| delegation.create | 复核 parent／目标；创建 child Task／planned binding／逻辑输入／turn、delegation／outbox、父子事件及两种收据 | 当前 owner／目录／资源规则准备并启动子任务；queued 不是已经启动 |
| task.delete | 在统一协调范围内复核实际删除资格；逻辑身份 retained、保留 hold／历史引用、移除可见 tasks、事件及回执 | 按已登记意图做可恢复清理；不是立即删除历史、原生目录、项目代码或插件数据 |

本轮删除候选仅在合成无活动任务上证明关系／回执事务，unknown turn 的拒绝为实际 SQL 判定。独立业务、后台、目录及资源最终资格必须由 F06／F08／F10 提供；接口要求在同一权威协调范围与提交事务复核，不接收 renderer 的 drained 布尔值。注入的 eligibility 拒绝不是实际业务恢复证据。将 fixture turn 改 completed 只为构造删除前置，不能复制到产品。

## 与当前实现的对应

核对当前 SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`；18 个写入口文件与 §4.110 清单摘要全部一致，复用其逐类责任映射及 118 个静态匹配，不把匹配数当用例或完整动态调用图。当前 TaskService.create 先 spawn 再插任务，不能用于新程序化逻辑接受；旧路径保留，新 TaskCommandService 先持久化再由 worker 执行。TaskService.delete 的 kill／watcher 清理不能放进数据库事务；程序化关闭／排空与记录删除分阶段。ProjectService 删除须先对涉及任务应用同一保留合同。SessionRegistry／RunRegistry、配置／Secrets、资源清理及业务恢复入口沿原映射迁移。

C1.2 自身安装回滚、重复安装、结构漂移／旧基线拒绝通过；这不是正式应用版本守卫。正式实现必须将共同表结构／数据迁移注册到现有 migration 目录、打包清单和维护协调器，Schema、水位、提交回执同事务；只写 m14_contract_baseline 不够。复用 §4.76 的实际前缀／水位拒绝和备份恢复证据，本轮其 166 个当前仓库引用摘要一致。最终产品迁移执行留 A13／A50；库外复制仍在 F14，不能据此声明所有降级路径已验。

## 检查与限制

最终 F01-01–12 分别验证：旧结构缺口；C1.2 安装回滚／漂移；无运行的冻结输入；命令与逻辑输入重放／冲突；输入四个事务异常窗口；委派共同提交；委派五个异常窗口；未知 turn 拒删与保留历史；删除四个异常窗口及资格拒绝；两个独立连接读取同一回执；三条命令的真实 SQLite 收据触发器拒绝／回滚；原生证据与逻辑输入关联及错误来源拒绝。

两个连接是先后执行，不冒充同时竞争 worker。故障为异常／数据库 ABORT，不是本轮 SIGKILL；进程崩溃窗口复用既有输入、委派和迁移实验，本轮不新增该覆盖。Native 关联检查使用原实验已 stopped 的 run 作为关系夹具，不提供真实运行许可。未验证 IPC sender、目标文件／凭据解析、引用解析、独立业务资格或最终 GC。

初轮 10 项通过，追加数据库存储失败与 native 关联两项后最终 12 项通过。归档含两次结果；计数只取最终 12，不累加成 22。打包时仅将旧合同／fixture 的引用改为归档内路径；解包复验另记，不增加检查数量。

材料：`evidence.tar.gz` 包含 C1.1 合成种子、P1／P1.1、SQL、命令候选、脚本、结果与各场景数据库；`manifest.json` 保存 SHA-256。复跑 `node probe.mjs`，需 Node、现有 better-sqlite3／zod（路径保留为本机研究依赖）。种子与 fixture 已本地携带，不再依赖原实验临时目录。路径内的数据全为合成实验数据，不能替换为用户数据库运行。

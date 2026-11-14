# 原生身份、发布回执与后续运行：隔离技术验证

2026-11-14；对应 R02／03／04／08／10，Q13／14／17／24／48，技术方案 §3.2.9、验证账 §4.47。当前是技术研究与临时验证，没有产品开发或正式验收。

## 发现与结论

程序化发布的原始快照没有 native ID。Codex 的真实 `thread/start` 返回身份后，首次绑定推进了当前 revision；此前候选重试发布时却要求原收据 hash 等于当前 hash，产生 `CURRENT_REVISION_CHANGED`。`attempt-MT5tb8` 保存真实失败及数据库。这是隔离候选的设计缺口，不是已证明的产品缺陷。

候选现在分开读取不可变发布事实、每次 run 的不可变启动来源和可推进的当前来源。同 attempt 重试仍用原始请求／来源并返回同一个私有 run；后续明确创建的新 run 才选用当前来源。历史收据查询不授权执行，执行仍必须经过实际 owner、活动能力、资源与当前政策检查。首次 native ID 回调核对实际私有 run、其固定来源及 runner／stateRoot／cwd；已停止的旧 run、复制的 handle、另一 run 的来源不能写入。

第二个实际反例是 `attempt-ScZDFK`：只建会话取得 ID、没有注入历史也没有模型回合，结束进程后以同 ID 恢复，原生返回 `no rollout found`。即使 start 回复带有 path，也不能直接把 ID／path 当成历史已经可恢复的证明。

最终实验显式写入一条合成 developer 上下文后结束旧进程，使用新 run／新原生进程恢复同一 thread ID 成功；保留的 rollout 确认 session_meta 身份一致且包含该记录。此结果只证明这一条件下的磁盘历史与原生恢复，不证明模型理解了上下文、用户输入已执行或整个 App 崩溃后自动恢复。不能用填充无意义消息来掩盖空会话不可恢复。

## 实验路径与结果

复用现有 PackageRegistry、ResourceStore、运行／能力服务和实际配置构建输入，改动的绑定／来源／计划逻辑仅在临时 variant。真实父 Codex 只完成初始化，宿主服务直接接受子请求，子端通过受控 launcher 启动 Codex 0.167.1。独立 HOME／状态目录、合成 Key、模型地址和代理固定为本机不可用地址；没有 `turn/start`、模型费用或业务写入。

最终 `attempt-7CqQ7n` N01–N10 通过：

| 项 | 核对的行为 |
| --- | --- |
| N01 | 真正取得首次 native ID 后，重复发布仍返回原始收据 |
| N02 | 原始发布／run 来源、当前 native revision 分离，v1 应用计划、ExecutionPlan、delivery 字节不变 |
| N03 | 同 native ID 重复回调幂等；不同 ID 拒绝，不增加修订 |
| N04 | 同 attempt 使用原来源复用原私有 run 与计划；擅用当前 hash 改写同请求则冲突 |
| N05 | 复制 handle、改变 stateRoot 均不能绑定 |
| N06 | 注入隔离上下文后旧进程退出，generation 2 的明确新 run／新进程恢复同 ID；旧 run 回调拒绝 |
| N07 | 能力 hold 后原发布事实仍可读，活动执行被拒绝 |
| N08 | 篡改历史发布收据被拒绝 |
| N09 | 后续 run 用自己的启动来源回调成功；借前一 run 的来源拒绝 |
| N10 | 真实首次 ID 写入中途故障，身份指针／修订／运行与计划整体回滚；同 ID 精确重试成功 |

`attempt-coa0LI` 是修正后的八项结果；随后新增 N09／N10，最终全批通过。保存四轮完整过程，不将第一次负对照或无历史恢复失败删除。四轮共十二个捕获原生进程均有正常退出回执，最终一轮四个；没有依据名称扫描或终止其他进程。

## T3 对照与适用边界

本地 T3 `CodexAdapterV2.ensureThread` 调用 thread/start；`resumeThread` 使用既有 native ID。所核对的 `resumeNativeThread` 对 archived 和 closing 分别处理，其余错误向上返回；此 helper 没有通用的“恢复失败就创建新身份”。这是所审阅方法的行为，不扩张为全部上层调用的结论。`restoreAdditionalContext` 的历史注入机制可参考，但 WillYou 必须保留输入来源、投递证据与业务授权。

新 run 是正常显式继续，不是上一批 outbox 的死亡宿主 attempt 2。尚未联合验证 native 已接受后的宿主中断、模型输入／业务在途、Claude 的真实 ID 回调、完整协议 Schema 或应用迁移器；首次 native 写入的通用合同不能由 Codex 一端实验直接证明其他 provider。没有修改产品、共享原型或 T3。

## 证据与复跑

[最终结果](result.json)、[发布收据负对照](receipt-negative.json)、[空会话恢复负对照](empty-native-negative.json)、[历史落盘证据](history-evidence.json)、[进程收尾](runtime-audit.json)、[源码依据](source-review.json)、[文件哈希](archive-manifest.json)、[全部轮次](raw-evidence.tar.gz)。归档 328 个文件、29 份通过完整性／外键检查的 SQLite；构建输入按解析后的路径去重为 503 个。

复跑需在新临时目录恢复归档的依赖版本与源码基线、调整绝对路径，执行 build.mjs、profile-build.mjs、probe.mjs，再运行 evidence-audit.py。生成的最终 variant 已含修正，不重复套用 refine-source.py。输入／环境必须隔离，不使用用户凭据、日常数据库或工作目录；观察超时应先核验原捕获进程，不盲目重启。

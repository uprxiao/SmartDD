# 宿主退出与独立运行尝试：隔离技术验证

日期：2026-11-14。对应 R02／06／08／10，Q04／13／24／48；技术方案 §7.1.2，验证账 §4.46。当前仍是设计和独立验证，不是产品开发或产品验收。

## 解决的问题

前批子创建→能力发布→直接预留→宿主计划→原生初始化只验证同进程重试，一 effect 一 run 的候选无法安全表达宿主退出后的下一运行。本批增加独立 attempt：稳定逻辑 child／delegation／effect 保持，尝试记录编号、owner、目标修订及原 run。当前队列只指向当前 attempt；历史 run 请求、计划和回执保留。实际 SmartDD run recovery 先处理旧 owner／进程／租约，再由候选根据是否确实未启动决定是否分配下一 attempt。

在同一临时 SQLite／资源根下，真实子宿主重新连接当前实际组件。各 worker 的 PID 和内核出生身份来自实际 MacProcessIdentityReader，主驱动只 SIGKILL 自己捕获的 ChildProcess。子目录均独立，不验证 SVN 共享写入策略。

## 结果

最终 `attempt-LiCuLm` 的 C01–C11 通过：十个宿主 worker 被 SIGKILL，两个并发恢复 worker 正常退出，一个真实父 Codex 和一个恢复后的子 Codex 完成初始化并退出，另有一个用于反例的无害 shell 子进程已退出。三轮留存合计二十个 SIGKILL、四个正常恢复 worker、五个原生初始化退出及两个 shell 退出；数量不作为产品或全局研究通过数。

| 项 | 真实执行与结论 |
| --- | --- |
| C01 | 能力发布 COMMIT 后终止 worker；无 run，重新领取同 attempt、同 child／cap，不重复发布 |
| C02 | run／请求收据 COMMIT 后终止；实际 recovery 取消 reserved 进程、停止旧 run 并释放租约，原子创建 attempt 2；旧 claim 拒绝，新 run generation 为 2，旧请求记录保留 |
| C03 | ExecutionPlan／delivery COMMIT 后终止；旧 delivery abandoned、旧计划字节保留；下一尝试真实 Codex 初始化成功 |
| C04 | arm 后、无 PID 时终止；实际 recovery 保留 orphaned／recovery-required，候选记 unknown，无第二 attempt |
| C05 | 两个真实恢复进程同时处理同一死亡宿主；只产生一个下一 attempt 和一份恢复决策 |
| C06 | 宿主退出后换 Key；允许旧资源收尾，但不以新配置自动派发，不创建下一尝试 |
| C07 | 下一 attempt 插入后注入事务异常；队列指针／恢复收据／新 attempt 回滚，已完成的旧 run recovery 保留；再次对账只产生一次推进 |
| C08 | 原 worker 仍活着时拒绝接管；捕获并确认其退出后才允许恢复 |
| C09 | 显式夹具模拟 owner 观察 unknown 时保留状态；换回实际 reader 证明 stopped 后才能推进 |
| C10 | 真正启动、attach 并结束一个无害 shell，旧 run 已 stopped，再终止宿主；候选仍保留 unknown，不将 run stopped 当成从未执行 |
| C11 | 复制 claim token 给另一个 registry 不能预留运行；还须核对 attempt owner 的实例／PID／出生身份 |

`attempt-RnhFMP` 的原十项通过，但不含新增的 C11。扩展检查后 `attempt-Jp30uP` 复现：仅比较 claim token 时，另一 registry 成功创建了与 attempt owner 不同的 run。原数据库保存两份实际 owner ID；候选补完整 owner 核验后最终全批通过。这是研究候选缺口，不是生产缺陷。另保留 profile-build 漏拷贝 throwing node-pty stub 的准备失败；修复拷贝前没有启动实验或原生进程。

## 约束与参考

T3 EffectOutbox.claimNext 通过条件 UPDATE 领取并增加 attempt_count、记录 workerId；succeed 仍要求原 lease_owner。ProviderRuntimeRecoveryService 还按原生是否接受及消息来源筛选可恢复项，不把通用重试次数等同于外部操作恰好一次。WillYou 参考领取归属和分类恢复原则，继续使用自己的进程出生身份、资源租约和业务证据，不能仅复制重试计数。

原 run／资源恢复和队列推进是两个可重入阶段。第二阶段失败不撤销已经完成的资源收尾；下一次读取当前持久状态再推进。新 attempt／恢复决策／当前指针同事务提交，原 run、计划和目标事实不覆盖。目标修订固定到每次 attempt，旧计划读取通过旧 attempt 核对，不能只联查已经指向新 run 的 outbox。

只有 owner 确认死亡、旧 run 终态且已撤权、所有进程均为未派发取消且无 PID、无活动／历史调用活动记录、租约已释放、准备交付已放弃等证据同时满足，候选才允许下一尝试。已 armed 而无 PID、曾有实际子进程、来源不明或 owner 仍活跃都不自动重试。当前尚未用业务调用回执替代这些保守判据，不能扩大到已发送模型输入／外部写入。

## 范围和未决项

本批是 worker 的真实进程退出，父主驱动保持运行；不是整个 Electron App／操作系统重启。恢复后只执行 Codex 初始化，没有 Claude 原生恢复、thread/start、模型回合、Skill／业务 MCP 或外部写入。能力包、业务资源、凭据及加密器仍为隔离夹具。C10 的 shell 只等待 stdin 后退出，不是 Agent 工具执行的完整替代。

每轮故意保留 C04 的 armed 无 PID 数据和资源占用作为 unknown 证据，不通过清表／改终态强行释放；所有捕获 OS 进程均确认已退出。实际原生派发后失联、后台后代范围、首次 native ID 修订后的来源复用、业务在途调用和结果投递仍须分别对账，不能凭本轮未启动恢复推定已解决。

新的 attempt 表和 outbox 指针只存在临时 Schema，未实施旧实验格式或应用版本升级。真实迁移器、生产启动协调及持久事件投影未接入；没有修改实际 run-recovery.ts。

## 证据与复跑

[最终结果](result.json)、[有效 owner 负对照](baseline-negative.json)、[进程收尾与保留未知状态](runtime-audit.json)、[源码依据](source-review.json)、[文件哈希](archive-manifest.json)、[全部轮次与数据库](raw-evidence.tar.gz)。归档 274 个文件、43 份 SQLite；完整性／外键通过，504 个构建输入复核。

在新临时目录恢复匹配依赖／源码与最终生成的 variant，依次成功运行 `node build.mjs`、`node profile-build.mjs`、`node probe.mjs`。最终 variant 已含 owner 修正，不重复套用 extend 脚本。使用归档的独立配置和合成凭据，不连接用户库；只管理本轮捕获的子进程。版本和程序 hash 见运行审计。

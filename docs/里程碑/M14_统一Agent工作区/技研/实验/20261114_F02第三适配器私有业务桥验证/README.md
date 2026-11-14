# F02 第三适配器与实际私有业务桥

2026-11-14。F02 的研究结论关闭：扩展 Agent 的协议差异可放在适配器，真实 owner、私有桥和实时业务授权可保持公共路径。没有接入新厂商 SDK，也没有实现产品 TaskService 或 UI。

## 本次执行

`scripted-test 真实 OS 进程 → 自有 stdio MCP 子进程 → 当前 bridge-runtime → 单次票据／Unix socket → 内核 peer 与祖先 → PrivateApplicationBroker → CurrentApplicationAuthorization → ApplicationToolService → 合成只读 handler`

| 检查 | 实际证据 |
| --- | --- |
| T01 主角色 | 真实宿主持有的 run 句柄与 PID／出生身份；独立桥完成一次读取，返回本主任务身份 |
| T02 子角色 | 不同 task／binding／run／PID／桥，同一个 start 函数与同一业务服务再完成一次读取；父仍活跃，回包属于子任务 |
| T03 实时政策 | 运行中停用应用，主、子各调用一次均返回 APP_NOT_ENABLED；handler 总执行次数保持 2 |
| T04 失效身份 | 子停止后父仍 active；旧子工具入口 SCOPE_DENIED，新建旧子桥 CANCELED；两次启动均拒绝复制的句柄 |
| T05 收束 | 两条实际 invocation succeeded／attempt_count=1；无重放，资源租约全部 released，两个原生根与两个桥均确认退出；SQLite 完整性和外键通过 |

最终 attempt-l2ozh2 五项通过。两个根进程受控 SIGTERM，桥先关闭；不把进程退出码作为工具成功依据，工具成功由实际回包和 invocation 账证明。未调用模型／真实业务账号。attempt-G8oV0i 在 broker 建立本机私有通道时失败，未启动根或桥；随后按隔离验证授权执行，失败原样保留。

父子关系在候选表中预置，仅用来验证角色和业务归属；没有执行 delegation.create、outbox 派发或结果回父。本次不用旧 joint.mjs 的双品牌工厂，也不把旧实验 SQL 作为 C1.2 替代方案。F01 已固定公共提交事务，§4.22 已验证通用九配对和第三适配器切换；F02 只补冻结的 owner／业务边界交界。完整产品组合按 A01／A19／A23 验收。

## 源码时效和候选边界

旧 §4.64 bundle 的输入有 15 处变化，不能当当前实现。本次重新构建当前业务服务／桥，build 474 项、bridge 205 项输入均逐项核验摘要，交集不累加为覆盖数。三个程序化研究变体是 run-registry、session-registry、run-plan；前两者沿用较新的 §4.108 研究版本，保留当前 bindingMode／R17 行为，session 增补既有 createProgrammatic 方法。没有修改仓库源码；研究变体未经产品类型检查，不是交付实现。

适配包选择、配置与角色创建是宿主夹具输入，不是模型获得的授权。业务 handler 只返回合成值；真实私有 broker、内核身份、ApplicationToolService 与实时应用停用判断来自当前源码。本批没有复验 SDK／版本、真实第三厂商、完整业务写入／来源、资源最终 GC、SVN 写者锁、C1.2 迁移或 UI；这些由原冻结项／产品验收承担，不扩大 F02。

T3 参考 packages/provider-core/src/server/driver.ts 的 ProviderDriver.create→ProviderInstance：定义与运行实例分离。ProviderRegistry.ts 仍有模型发现／认证缓存等 Provider 特例，因此本设计不声称“T3 宿主完全没有品牌判断”；WillYou 的要求是新增 Agent 不新增每对品牌的任务、委派或业务授权分支，厂商策略放在注册／适配边界。

## 复用证据与逐项关闭

[能力反例复用记录](reused-capabilities.json)保留 §4.22 G06／07／08／15／16 的原结果和脚本摘要，没有重跑或重复计数：缺 hostTools 可作为子目标但不能发起宿主委派；缺 turns 拒绝；没有历史路径保留旧会话；resume unavailable 阻止复用，明确 unsupported 才新建绑定并保留 lineage。它们是候选合同证据，不能宣称真实第三厂商恢复已验。

| Q | 可实施设计 | 关键与失败证据 | 后续产品验收 |
| --- | --- | --- | --- |
| Q01 | T0.1 §2／§2.4.1／§3.2.16／§4 的规范事件、实例隔离、公共命令 | §4.13／22 的规范化、请求及第三夹具；F01 共同事务；本批真实 owner／桥与旧身份拒绝 | A01 同一产品任务服务、规范投影和 UI；未执行 |
| Q19 | §2.4.1／§7.1 的目标目录、能力准入、独立子身份 | §4.5 真实双向／同执行器，§4.22 九配对；本批不同角色相同业务路径；配置修订见 F04 | A19 实际委派入口、任务树与回父；未执行 |
| Q23 | §5.1.1／§7／§7.3，Skill 不授予权限，宿主强制限制 | §4.4 深度／并发／目标反例，§4.30 真实 Skill 重用，F04 配置规则；本批当前政策越权拒绝 | A23 真实 Skill 两入口越权和重开复用；未执行 |

三项是研究关闭，不代表 UI、调度或全部业务完成；其他 Q 的共同依赖不因此解除。

## 证据与复跑

[结果](result.json)、[内核证明](proofs.json)、[实际执行](executions.json)、[退出记录](cleanup.json)、[运行环境与进程复核](runtime-audit.json)、[源码清单](source-review.json)、[归档](evidence.tar.gz)、[摘要](archive-manifest.json)。归档包含原始 SQLite、脚本、构建产物与所用源码快照，不含用户凭据、用户数据库或厂商 native 二进制。

复跑需 macOS arm64、记录的 Node／SQLite 依赖和 process-identity helper。原脚本保留环境绝对路径；迁移机器时须恢复并核对来源／依赖，执行 build.mjs、build-bridge.mjs 后运行 probe.mjs。不是任意机器一条命令可跑的产品工具。授权范围限本机 socket、自有脚本进程及合成只读数据。

# 交付资源接管与运行租约验证

日期：2026-11-14。补 R02／R08／R10、Q13／Q48。**仅技术研究，没有修改产品或共享原型代码。** [结果](result.json) attempt-WnDyD0 九项限定检查完成；[原始证据](raw-evidence.tar.gz)、[文件摘要](evidence-manifest.json)、[审计](audit.json)、[构建](build.json)、[源码基线](source-review.json)可复核。

## 问题与实际边界

前批已区分历史依赖和仍待消费的启动资源，本批验证后者如何交给现有运行租约。使用实际 ResourceStore.use、CapabilityRunRegistry、所有权句柄校验、资源锁、SQLite 事务和资源清理器；独立候选 adopt 将精确资源闭包写入既有 capability_lease_resources。临时运行使用实际注册器签发的句柄，但底层进程读取为 FixtureProcessReader，没有启动原生 Agent／SDK。已有 task／PTY 身份并未迁移为最终多绑定合同。

首次 attempt-Y9Zxdx 在 H01 失败：资源已登记为实际 run 租约成员，准备租约结束后，原清理计划仍认为可清理。源码确认计划和最终删除检查只读取 capability_resource_leases 的主资源，不读取 capability_lease_resources。普通旧来源可能由其他历史引用保护；本反例是新增交付资源的候选路径，不能宣称当前用户项目已经发生误删。

候选构建在内存替换两处 GC 读取器，增加成员 JOIN 未 released 主租约，核对资源状态、hash 和 generation，并纳入计划摘要和最终删除保护。attempt-gCxLMY 七项完成，之后新增只变成员的旧计划检查及删除末端注入，最终九项完成。全部尝试保留；失败没有被改写为成功。

## 九项证据

| 项目 | 已验证的限定结论 |
| --- | --- |
| H01 | 准备租约保持 active 时，实际 run 接管应用包及独立 runtime；准备结束后原 GC 仍允许、候选 GC 拒绝清理。实际 cancelBeforeFork 结束 run 后，候选执行实际文件删除，包和 runtime 均 removed |
| H02 | 复制准备 token、复制实际 run 句柄或使用过期 token 均不能接管；使用实际 WeakMap 所有权检查 |
| H03 | 插入成员后注入事务失败，成员回滚且准备租约仍保护；重试只登记一份成员。只验证失败重试，不等于任意重复请求幂等已覆盖 |
| H04 | 目的 run 已取消时拒绝接管，不复活运行；准备回调结束前仍由准备租约保护 |
| H05 | 用夹具制造 attach 身份未知，实际 run 保持 stopping、资源保留；迟到 attach 不恢复业务权限，夹具确认进程退出后才结束运行与租约 |
| H06 | 结束 run 不释放另一个实际 UI use 租约；另一消费者结束后才可清理 |
| H07 | raw SQL 改变 generation，接管拒绝；接管后再改代次，实际 bridgePreparation 同样拒绝。故障恢复由夹具重置，未验证真实损坏修复 |
| H08 | 接管前后全部未释放主租约行完全相同，只增加成员；候选仍使旧清理 planHash 失效并拒绝旧请求 |
| H09 | 删除 marked 检查点用 raw SQL 绕过正确写入口插入成员，最终保护拒绝物理删除，目录仍在；清理留待恢复，没有证明后续恢复完成 |

数据库备份在每项 finally 清场后保存；需连同驱动断言和结果阅读，不能把清场后的 stopped 行当作中途活动状态。物理删除均限合成夹具目录。H09 是单宿主受控检查点，不是双进程真实竞争；本批也没有 SIGKILL 接管恢复实验。

## 设计结论与尚未覆盖

接管可以采用安全重叠：同一协调边界内复核可信所有者与资源，先提交目的 run 成员，再结束准备租约；全程至少一种有效占用。无需强制把登记和释放写在同一个事务，但绝不先释放后登记。提交前失败仍有准备保护；提交后未释放存在双重保护，崩溃后何时释放须有持久收据和真实 owner 证据，不能凭时间推断。

最终实现须让预览、planHash、最终删除及恢复读取同一套完整保留理由：旧历史、新绑定历史、准备／交付、run 主租约与成员、实时业务和独立 UI 占用。本批成员读取器没有与前批完整新绑定读取器合并；实验中复用的 cap_id／snapshot_hash 字段只是临时接口形状，不代表把 run 租约变为历史快照。

准备 token 当前只核 task、store 和资源闭包；正式多绑定设计还须核 binding／source revision／准备代次／delivery plan／目标 run 的精确关系及当前政策。尚缺统一持久 Schema、接管中断恢复、完整投影和原生派发联合、SDK／native 等其他资源种类。不能把九项局部证据升级为完整生命周期完成。

T3 当前 ProviderInstallationGate 用 execute/update 协调执行与安装更新，是可参考的运行占用边界；它不是本实验的持久资源接管或 SmartDD 回收合同，不能照搬后宣称已覆盖既有资源体系。本批只读核对该文件，没有运行 T3 测试。

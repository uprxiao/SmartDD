# 启动来源与首次原生身份修订验证

日期：2026-11-14。补 R02／R03／R08／R10、Q13。[结果](result.json) attempt-0tc0YC 八项限定检查完成；[原件](raw-evidence.tar.gz)、[摘要](evidence-manifest.json)、[审计](audit.json)、[构建](build.json)和[源码／读取方清单](source-review.json)可复核。**本批只做技术研究，产品与共享原型代码未改。**

## 从计划读取路径发现的冲突

现有 CapabilitySessionRegistry.bindNativeSession 首次得到原生 sessionId 后，在同一事务写入新快照修订、原生身份，并更新 prepared／active／stopping run 的 snapshot_hash。固定 v1 ApplicationRunPlan 则保留最初 snapshotHash，assertRunPlanSnapshotSource 显式允许“仅补首次原生 ID”的变化。

前几批候选把 capability_runs.snapshot_hash 同时用作当前修订和不可变交付来源：一方面它引用新 m14_revision，实际旧写入口没有投影新修订；另一方面 delivery 的复合外键把它钉在最初值。这不是产品已有缺陷，而是候选多绑定迁移与现有首次绑定行为不兼容。若直接照前批 SQL 开发，会在初始化后的原生身份绑定处失败。

## 八项证据

| 项目 | 限定结论 |
| --- | --- |
| R01 | 对前批实际候选库及交付 receipt 调用未改的实际 bindNativeSession，得到 SQLITE_CONSTRAINT_FOREIGNKEY；旧身份／run／新修订整体回滚，证明此前初始化取消未覆盖首次 ID 绑定 |
| R02 | 用 raw 夹具预置合法下一修订，单独更新 run.snapshot_hash 仍被旧 delivery FK 拒绝；用于定位第二个阻挡，不是合法启动流程 |
| R03 | Claude runner 候选在实际绑定事务内投影新 revision／refs／native claim／current pointer，run.current hash 更新、source_snapshot_hash 固定；实际 v1 plan 源例外校验通过，交付 JSON 不变，真实 registry 继续提供 bridgePreparation 并接管资源 |
| R04 | Codex runner 夹具执行同样检查，重复同 ID 幂等，另一个 ID 被实际入口拒绝；没有启动 Codex native |
| R05 | 在候选新修订写入后注入异常，旧快照／原生身份／run 与候选新关系一同回滚；原交付占用仍在，去掉故障后重试成功 |
| R06 | 只允许 null→首次 native ID；同资源但改变 allowedOperations 的内容也拒绝，不把重算摘要视为同一来源 |
| R07 | 新绑定已声明同 runner／stateRoot／native ID 时，既有写守卫拒绝旧 first-bind，旧 run 和身份不变。其他绑定只是冲突 claim 夹具，不是完整可执行任务 |
| R08 | 第二次运行使用已经绑定的修订作为自己的启动来源，第一次运行仍保存最初未绑定来源；原 runId 与两份交付审计各自保留 |

候选 schema 将 run 的 source_snapshot_hash 与现有 snapshot_hash 分开，前者关联启动源修订，后者关联当前原生修订；delivery FK 改引用固定 source。绑定变更在实际 bindNativeSession 的同一个事务中、更新 run 当前 hash 前插入候选投影，不在 commit 后异步补写。保持旧源 revision／资源引用，首次绑定只改变 native ID；原生身份冲突检查继续跨旧记录与新绑定。

本批内存构建只增加该事务钩子及既有候选 GC 读取；源码文件未编辑。原生 ID 为合成 UUID；没有 SDK／app-server 回合、进程中断或业务调用。run 仍是 legacy reserve 加夹具关联，不能称已实现多绑定 programmatic reserve。候选迁移标记由实验 1 改为 2，读取器同步识别 2；只测试从现有产品旧库迁到本批候选，没有实现前一实验数据库 1→2 升级，更不改变产品迁移版本。

R01／R02 是预期风险复现，status=passed 表示断言复现成功，不表示旧方案正确。所引用旧候选的实际／GC 构建、输入脚本和 SQL 已一并冻结在原件的 legacy-* 文件，其原 403 份构建来源重新校验；本批实际／候选 406 份来源另有摘要。旧尝试未被覆盖。

## 完整计划的读取方要求

源码清单记录了九个直接定义／读写 v1 plan 的文件及五个间接消费者。除了 launcher／registry，还包括直接读数据库的 diagnostics、能力适配加载、当前业务授权、冻结 Skill、输入／Skill 来源、工具服务、CLI、插件调用与 ExecutionContexts。只改 readApplicationRunPlan 或只往旧 JSON 加 bindingId 都不能覆盖这些路径。

T3 本地基线将 provider instance 配置与 provider session／thread 绑定关系分开，支持参考这种职责划分；其表没有 SmartDD 的能力快照或首次绑定摘要合同，不能照搬表结构替代本批验证。

完整宿主 ExecutionPlan 可以独立关联已有 v1 ApplicationRunPlan 的摘要，使宿主身份／安装版本／续聊兼容身份与业务加载审计各有明确职责；这只是当前候选设计取舍，完整运行时 Schema、存储提交、加载和当前授权联动尚未实测。无论最终单记录还是两个强关联记录，都必须区分启动来源、当前原生修订、启动应用计划和每次调用的当前授权视图。

下一步须把分离后的合同接入正式候选 execution-plan 和 programmatic reserve，验证多绑定、两端真实首次 ID、完整 SDK／投影／业务读取及中断恢复；不能让旧写入口在未知迁移版本下直接得到裸外键错误。前批基于旧 schema 的恢复／取消证据需按最终共同 Schema 复核适用范围，不能自动全部继承。

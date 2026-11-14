# 程序化首次绑定与保留身份联合验证

日期：2026-11-14。D01，关联 Q13／Q46–50。将 §4.92–93 的历史身份占用投影与早批程序化首次 native ID 绑定候选放到同一隔离库，发现并修正两处候选缺口。最终 attempt-jqDtPY 六项通过，未改产品源码。

## 范围和来源

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`，当前实际服务重新构建，379 项输入摘要复核。实际服务建立合法 schema-3 会话、绑定合成 native ID、复制合成历史并提交 adoptLibrary，形成旧根／当前根；迁移候选在同库投影两种根的占用。程序化 prepared binding 和源修订通过夹具创建，首次回调参数为合成，没有 SDK、原生进程或模型。

复用 retained-claims 的 migration／SQL／claim／retained 模块，以及 business-mcp-joint 的 programmatic 首次绑定函数。新增 claims-joint 将原函数包在共享 claim 检查、来源写入和同一事务中。此为固定文件摘要的研究组合，不是最终产品 Schema 或完整 TaskService。

## 六项检查

| 检查 | 结论 |
| --- | --- |
| J01 旧候选反例 | 原 programmatic bindNativeLocked 只查当前 legacy identity；迁移复制后，另一 binding 可在旧根绑定仍由原历史占用的 native ID。原占用还在，因此是候选漏检，不是原产品错误 |
| J02 共享占用 | 新候选先查 canonical root／runner／native ID 的共享 claim，历史冲突拒绝且全库不变；非规范根明确拒绝，要求调用方先完成可信路径解析 |
| J03 来源与重放 | 首次绑定保存精确 cap／revision／task／binding 来源；同 ID 重复调用不增加记录；占用及被引用来源不可删除。扩展后的跨 binding 错配来源也由数据库拒绝 |
| J04 旧入口 | 新绑定建立占用后，实际旧 CapabilitySessionRegistry.create 无法认领该身份；原旧快照不变 |
| J05 原子回滚 | 新 revision 写入后、来源 claim 写入后分别注入异常，整个事务回滚；在未启动任何原生输入前可显式重试 |
| J06 新入口互斥 | 两个 prepared 程序化 binding 先后尝试同一身份，第二个被共享 claim 拒绝且保持原状态；不是跨进程竞争证明 |

## 保留的失败

attempt-QdauFs 的原六项通过，但当时 J03 未覆盖跨 binding 来源误关联。扩展用例后，attempt-nCn1ZW 的 J03 因缺少预期异常失败：来源表分别外键关联 claim 的身份三元组和 revision，却没有证明二者属于同一 task／binding。修正 claims-joint 的 SQL：为 claim 建立包含 task／binding 的唯一键，来源以对应复合外键关联，再复验得到 attempt-jqDtPY。三次原始脚本、SQL、结果和数据库全部保留。

这不是修改断言掩盖失败，也不是把当前产品标记为有此缺陷。J01 始终保留旧候选反例；实际产品的 session 创建仅用来验证共库守卫适用性。

## 设计影响与未验项

首次原生身份发布必须与历史占用读取使用同一冲突域；只检查 capability_session_identities 当前根或 binding 当前根不够。新 claim 同时保存来源 revision，其 task／binding／cap 的归属必须与 claim owner 在数据库关系上相等。旧历史来源与新程序化来源可分表，但不能凭两条独立外键推断两端 owner 一致。

准备 binding、正式原生回调、owner、run generation、准入和业务结果仍要联合；本轮没有把合成回调当可信原生来源。正式迁移版本、全写入口、合法后续根变化／释放／降级、GC 和崩溃恢复未关闭。受控同步异常只证明 SQLite 原子性，不替代 SIGKILL／多宿主接管。

所有保存数据库完整性／外键通过，没有活动 run 或未释放租约。复现：固定 build.mjs 依赖构建，执行 node probe.mjs；不需要网络或账号。见[结果](result.json)、[来源及清理审计](source-review.json)、[原始归档](raw-evidence.tar.gz)、[归档摘要](archive-manifest.json)。

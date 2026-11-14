# 原生身份占用投影与绑定原子迁移验证

日期：2026-11-14。关联 D01、Q13／Q49。实际 SmartDD 会话注册器和历史复制、合法 v3 内容、原生身份表及当前 SQLite；M14 关系表、占用投影和回调为临时候选。

## 六项证据

| 检查 | 结果 |
| --- | --- |
| P01 投影构建失败 | 在旧候选迁移事务内建立占用投影后注入异常；候选表全部回滚，旧表内容保持 |
| P02 成功迁移 | 当前根和原根映射同一 binding，并以外键保存旧快照来源；不同 selection 的保留历史也继续占用原身份 |
| P03 新绑定冲突 | 当前根、原根、原根别名各以同 task 和另一 task 认领，六种均拒绝；新 binding 插入整体回滚 |
| P04 旧入口约束 | 合成新 binding 切根后保留前根占用；实际 sessions.create 及实际 bindNativeSession 对前根的冲突均由新投影守卫拒绝，不留下半条快照或绑定 |
| P05 来源保留 | 删除被身份占用引用的旧 snapshot version 被外键拒绝 |
| P06 复制与新表原子更新 | 在实际 adoptLibrary 的同一提交回调更新 binding 根、claim、source、revision 和 current pointer；注入异常时与旧快照／身份整体回滚，重试成功后三个历史根仍属同一 binding |

六项通过，终态 SQLite 完整性与外键检查通过。P04 的新 binding 切根是合成合法 SQL 操作，未通过真实 Provider；P06 使用真实复制／注册器，但没有真实 TaskService 指针或完整业务 run。没有产品代码修改、Agent 启动或 SVN 代码复制。

## 候选数据约束

claim 主键为 runner／canonical identity_root／非空 native_id，owner 使用 binding_id／task_id／runner 复合外键；按 binding 建索引。来源关联指向原 snapshot_hash，迁移前验证旧内容 Schema、摘要和所属任务，再保存来源外键。空原生 ID 不产生虚构占用；新身份领取在规范化路径后与 binding 插入同事务完成。

旧身份 INSERT／UPDATE 同时查询该投影；历史占用不会因为 binding 当前根更新而删除，同逻辑任务的另一 binding 也不能重复认领。来源仍被引用时不允许普通清理删除；正式释放和恢复冲突应有独立流程，不能通过删约束或忽略来源解决。

本轮只证明合法历史的投影与同步事务联合。未知／hold／损坏来源、既有别名重定向、全部首次身份写入口、投影跨进程恢复、正式资源 GC、TaskService、运行准入及恢复 claim 尚未接为同一服务。新 Provider 首次身份的真实性仍须由原生回调证据合同提供，插入 claim 本身不证明 native 会话可恢复。

## 复现

固定依赖具备时执行 `node build.mjs`、`node probe.mjs`。候选 projection 在旧研究 migrate 的 before-drop 钩子中加入，其事务同时包含关系表、保留来源、占用和迁移回执。源代码与 379 条构建输入摘要、实际产物、失败注入断言及终态数据库均归档。

[结果](result.json) · [来源](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。

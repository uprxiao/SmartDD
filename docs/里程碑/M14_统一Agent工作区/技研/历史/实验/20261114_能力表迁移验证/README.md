# 现有能力表多绑定迁移实验

日期：2026-11-14。SmartDD 基线 `40ea344a930aec37e36a803b7c621d3632d2d75a`。关联 Q13／Q48；不提升 Q49／Q50 的通过状态。

## 方法与结果

在临时 SQLite 中按顺序执行项目现有 32 份 `drizzle/*.sql`，注入合成历史数据，再执行候选迁移。没有打开用户数据库，没有修改生产 SQL／服务。SQLite 3.54.0，Python 3.15.0。

- attempt-1：13 项均在夹具准备阶段报错，原因是资源表已增加字段，驱动仍按旧列数插入；没有进入迁移。原始驱动、结果与日志保留。
- attempt-2：修复资源插入为显式列名，并修正新能力会话 INSERT 的占位符数量后，13 项通过。不是生产实现由失败到修复的证明。

| 用例 | 实际验证 |
| --- | --- |
| M01–02 | 现有快照主键与 MCP 的 task／kind 唯一约束限制同 task 多绑定 |
| M03 | 另建运行表不能满足现有 application_invocations 的 run 外键 |
| M04–05 | 扩展原 capability_runs 后旧业务记录不变；新 task 无需伪造旧快照，新运行仍可被现有调用记录引用 |
| M06–07 | 候选复合外键拒绝跨 task／binding 错配；回填后的原生身份唯一性有效 |
| M08 | 实际 resource-gc-plan.ts 中旧引用查询看不到新增引用；合并引用查询可见。没有执行完整 GC／删除流程 |
| M09–10 | DROP 原表后的注入异常可事务回滚；重复迁移保持完整 SQL dump 一致 |
| M11 | 数据库中 unknown run、armed process、未释放 lease 各自阻断迁移 |
| M12 | 未匹配历史摘要与 hold 保留为 legacy，不猜关联；新程序化 run 缺能力会话被拒绝 |
| M13 | tombstone 保留；新旧引用的外键阻止直接删除被引用资源 |

## 对设计的影响

建议保留 `capability_runs.run_id` 及其业务外键，在原表增加绑定／能力会话关联；旧任务快照、资源引用和原生身份原样保留。新建独立运行表需要额外迁移全部业务关系，不能假设只改任务模块即可。候选通过重建原表移除旧 task→单快照外键，以复合外键约束新关系；这是数据库级方向验证，表名 `probe_*` 不能直接投入生产。

资源回收的读取与最终变更保护都要覆盖新增引用，至少涉及 `resource-gc-plan.ts`、`resource-graph-maintenance.ts`、`version-maintenance.ts`；不能仅改列表显示。现有 `plugins/project-policy.ts` 仍按 run 查询 pty_id，保留 runId 并不自动解决程序化运行所有权。

## 未验证边界

1. 快照 JSON／摘要是合成的不透明夹具，不是实际 v2／v3 Schema、校验摘要或真实文件资源；没有执行应用 TS migrator、session-registry 或 ResourceStore。
2. M09 为捕获异常后显式 rollback，不是进程崩溃、断电、磁盘不足或 SQLite 跨版本恢复；生产迁移须另验。
3. 预检只读数据库状态，不证明操作系统进程已退出。候选先检查后 BEGIN，不能对抗并发启动；生产必须先取得宿主启动排他权，再在事务中复核。
4. 只在新注册表验证原生身份唯一性；旧入口同时写入、跨注册表身份争抢、MCP 名称分配和旧路径新增运行尚未闭环。
5. 复合外键约束 task／binding／cap 关联，尚未约束所有 runner／snapshot_hash 语义一致性、历史多修订、权限撤销与可信运行句柄。
6. M08 是查询覆盖反例，M13 是引用外键检查；不等于完整回收会误删或已安全，也不是父子产物引用计数、真实归档／删除验收。
7. 清单按精确身份列及 capability 表外键选出 29 张表，不是穷尽所有 JSON 内引用或无外键语义依赖。
8. 新数据库不能据此交给旧版应用；SDK↔CLI 恢复、应用降级、生产接口与旧入口写入兼容仍待验证。

## 复验

在相同 SQL 基线与合适 Python／SQLite 环境执行：

```sh
python3 replay.py /Users/hx/projects/SmartDD
```

脚本先核对 SQL 文件哈希，另建临时库并结束后删除。`attempt-2/probe.py` 是执行时原件，内含原实验绝对路径；`replay.py` 通过导入后指定隔离路径复用它。`candidate.sql` 只含新增表定义，完整旧表重建逻辑在 probe.py。

归档不含数据库、凭据或用户数据；文件完整性见 `SHA256SUMS.json`。

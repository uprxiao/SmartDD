# 绑定身份、历史修订与旧入口迁移验证

日期：2026-11-14。对应 M14-R02／R03／R08／R10，补 Q13／Q48–50 的迁移边界。**仅临时目录中的候选合同和隔离验证，产品／共享原型／依赖配置未改。** 没有读取真实业务库或调用模型。

## 证据与实际范围

最终 attempt-MjnCG3，16 项通过，详见 [结果](result.json)。执行原 SmartDD v2／v3 Schema、会话／运行准备／ResourceStore、旧 reserve／bindNativeSession 及 GC 计划器，数据库来自 runFixture 执行全部 32 份现有迁移。适配器及包为既有测试夹具、进程 reader 为 FixtureProcessReader；准备／停止记录不代表真实 Agent 启动。业务调用表的两条历史记录是合成保留夹具，没有执行真实业务服务。

候选包括版本化绑定 scope、binding／capability session／精确 revision／resource ref／MCP claim 关系，原 capability_runs 表的保 ID 重建，旧入口写入守卫及单事务迁移。新绑定的 Skill 投影未生成、没有新 Driver 运行；结构校验与数据关联成功不等于可执行／获权。旧服务 reopen 使用原隔离资源目录与副本 SQLite；extra resource verifier 是未被 reserve／bind 触发的夹具，不据此声称资源准备通过。

## 检查结果

| 检查 | 限定结果 |
| --- | --- |
| I01 | 实际合法 v2 初始／首次原生绑定两修订、v3 tombstone 均关联；八张旧表与旧 run 列逐字保留。hold／未知历史不猜映射；未知 run 保留旧关联。重复迁移不再创建新 ID |
| I02 | 读取同时核 task、binding、capabilitySession、精确 hash、runner；错作用域、错摘要、额外字段及非正 generation 拒绝。正 generation 只是结构值，不是活 run 权限 |
| I03 | programmatic run 的关联必须完整，空 hash／空或非整数 generation、跨 task／runner／revision 拒绝，共九个负例 |
| I04 | 同一 task 保存第二份合法快照与独立 native／MCP 身份，旧快照原字节不被替换。只验证存储和读取，未物化投影或执行第二绑定 |
| I05 | 新 native／MCP claim 与旧登记冲突拒绝；旧 INSERT 也不能占用新路径登记的身份／名称 |
| I06 | 任务新入口启用后，实际旧 CapabilityRunRegistry.reserve 被拒绝且未留 preparing 行；旧会话读取仍可用 |
| I07 | 已启用新路径的 task，实际旧 bindNativeSession 更新被阻止，事务回滚保持原 null native ID |
| I08 | 保留旧 refs 时实际旧 GC 仍保留相应包；hold 另形成未知历史阻挡。没有证明新引用单独接管 GC 或实际删除器已兼容 |
| I09／I10 | 写事务内检查 orphaned run；错误精确 hash、缺必需 ref 都拒绝，没有留下半张新 schema。尚未连接真实内核退出／应用启动排他 |
| I12 | 即使另一 task 仍走 legacy，实际首次 native 绑定 UPDATE 也不能占用新 binding 已登记的 native 身份 |
| I13 | 合法但 selection 不同的历史修订保持原字节和独立 unresolved 记录；其 run 不借用当前 capabilitySession。只读历史保留，不声称该旧选择已可执行映射 |
| I14 | resource ref 的 task 与精确 revision 复合外键一致；跨 task 更新拒绝。scope 的正 generation 解析不会自动获得 run 权限 |
| I11，三个窗口 | 在 DROP 前、DROP 后但提交前、提交后 SIGKILL 实验捕获的 Node 宿主 PID；重新打开 SQLite，前两者回到完整旧库并可重新迁移，后者读取既有迁移回执。保留业务 run 外键，完整性／外键检查通过 |

所有批次 SQLite 检查见 [审计](audit.json)；源码哈希见 [构建记录](build.json)，驱动、SQL、各窗口数据库与前序失败见 [原始归档](raw-evidence.tar.gz)及[文件哈希](evidence-manifest.json)。

## T3 实现对照

本地 T3 的 ProviderInstance 将 instanceId、driverKind、continuationIdentity 分开；ProviderSessionBindings 迁移用 provider_session_id／thread_id 关系表保存关联，而不是给每个 thread 一个品牌字段。见[源码核对哈希](t3-reference.json)。这支持 WillYou 分离逻辑任务／配置实例／原生会话的方向，不意味着直接照搬 T3 的表结构：WillYou 还要保留自己的能力资源、run 外键及业务授权，新旧入口的原生占用范围须按这些约束验证。只读源码对照不计为本批运行检查。

## 两个实际发现与修正

1. attempt-Dl3WmD：I03 证明可空复合 FK 会放过 snapshot_hash=NULL；SQLite CHECK 对 NULL 的语义也不能用 `generation > 0` 单独兜底。候选补显式非空、整数及正值约束，再核精确复合 FK。attempt-UvIMDd 原 13 项通过，后续新增分支仍继续验证。
2. attempt-Epzit0：I12 调用实际旧 bindNativeSession，成功把旧 task 首次 native ID 更新成新 binding 已占用的身份。原因是候选只守 INSERT，没有守 UPDATE；补全旧 UPDATE 的统一冲突检查后，最终 16 项通过。

这些是临时迁移候选的缺口，不是本次修改或宣称修复了现有产品缺陷。未降低断言或把失败当历史替代。

## 设计落点与剩余边界

以保留原 runId／旧业务 FK、外层绑定关系、精确历史 hash 与显式旧入口关闭作为迁移路线。旧 JSON 不补默认值、不加 binding 字段；首次 native 绑定前后的 revision 均保留。相同 task 或 hash 不能代替完整作用域。

数据库 guard 是旧服务漏接时的最后阻挡，不代替 TaskService 的友好路由、应用版本门槛、真实 owner／启动锁或权限校验。迁移持有 BEGIN IMMEDIATE 的隔离结果不能证明另一宿主已停止；正式产品还需在同一启动排他协议中取得内核证据。

不同历史 selection 当前只按已知限制留在 legacy 只读并列出原因；若后续需要恢复执行，必须重建该选择的独立 capability session、原资源闭包、投影与当前政策，不能套当前 refs／run plan。完整历史选择分组、legacy 来源例外、外部插件／共享 Skill 更新、多绑定新投影及统一 GC 最终删除仍待验证。

本轮没有验证完整新运行计划、Driver 事件协议、同任务真实多绑定运行、配置兼容身份、旧 SDK／CLI 双向恢复、旧版本 App 打开新库或升级包。`scopeSchema` 只验证身份形状与持久关联；真实 run handle、generation／连接、策略和租约必须继续由现有所有权服务验证。正式产品验收仍 **54 条、0 通过、54 未执行、0%**。

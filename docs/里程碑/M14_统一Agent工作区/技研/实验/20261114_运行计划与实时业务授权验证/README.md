# 运行计划与实时业务授权验证

日期：2026-11-14。补 M14-R02／R08／R10、Q13 的实际运行计划语义。**仅技术研究；没有改产品代码、原型、用户配置或调用真实业务服务。**

[最终结果](result.json) attempt-ytcs8U 八项通过；[原始归档](raw-evidence.tar.gz)、[摘要](evidence-manifest.json)、[构建](build.json)、[审计](audit.json)和[源码复核](source-review.json)可追溯。此批不做新 Schema／SDK 接线，先确定既有业务不能被迁移改变的行为。

## 实际使用与替身

实际执行 runFixture 的 32 份迁移、包安装／激活、合法 v3 SessionRegistry、v1 运行计划创建／存取／来源验证、CurrentApplicationAuthorization、CapabilityRunRegistry 和 ApplicationToolService。运行进程身份为 FixtureProcessReader；应用开关使用隔离 SQL 行；BuiltinPackageRegistry 的元数据接口由实际 PackageRegistry.get 提供，未覆盖内置分发包信任链。业务执行器只是返回合成只读结果并计数，authorize 为夹具，无禅道请求、连接认证、外部写入、原生 Agent 或 UI。

使用受控包的受信旧工具名 smartdd_zentao_object_get_v1，真实模块将其映射为 zentao.object.get；参数／结果 Schema 和包字节仍是夹具。首次 attempt-Kxlt42 使用通用 runFixture 的 query／write 名称，实际 legacyPolicy 拒绝其未登记映射；这是夹具准备失败，零正式检查。改成模块已登记名称并通过 applicationBundle 提供单个只读工具后复跑，没有放宽真实服务的校验。

## 八项检查

| 项目 | 结果 |
| --- | --- |
| P01 | 给实际 v1 运行计划直接加 bindingId，或只把 schema 字面量改 v2，均被严格解析拒绝；原 v1 仍可读 |
| P02 | 历史快照有应用，但项目启动时已停用，启动计划可以没有应用且仍指向原 snapshotHash；工具列举为空，直接调用 APP_NOT_ENABLED |
| P03 | 活动 run 不变，项目启用后真实当前授权视图与工具目录出现该能力；合成只读执行成功，原启动计划不改 |
| P04 | 停用后重试同一已成功 requestId，仍返回 APP_NOT_ENABLED，不读取缓存绕过当前状态，也不再执行 |
| P05 | 重新启用并激活新包，当前视图及新调用使用新包 hash；recorded 快照和数据库原字节、原启动计划保持旧内容 |
| P06 | 项目仍启用但全局目录停用时，调用拒绝；目录与项目条件共同决定可用性 |
| P07 | 停止旧 run 后旧 ID 不能调用；重开 run 的启动计划记录当前新包，仍关联相同历史快照摘要；旧计划保留 |
| P08 | 当前视图沿用启动时入口可用性，本例 MCP 可用／CLI 不可用；启用应用不隐式打开 CLI，当前 plan 不创建共享 Skill 的逐 run 副本 |

P08 仅证明这个 MCP-only 分支，未穷举 CLI fallback。调用的真实 ToolService 会在选取当前能力之前检查运行；业务连接、审批、在途撤销和具体读取的授权仍由替身以外的既有业务服务处理，此批不能替代相关验证。

## 迁移含义

同一个历史 snapshotHash 可以对应不同启动计划；同一个活动 run 的当前授权视图也可以随项目设置变化而不同于已持久化的 launch plan。三者都叫“plan／snapshot”容易误迁移，必须分开表达：历史能力来源、启动时交付审计、调用时实时授权。

上批冻结准备内容解决的是异步准备期间内容被替换，不是把项目当前可用应用／权限冻结到整个会话。新运行计划需要精确关联 task／binding／capabilitySession／run／generation 与 runtime／配置身份，但不得取消 R17 的逐调用当前授权或 R16 的共享 Skill 语义。历史摘要不证明当前允许操作，读取 launch plan 也不签发活运行句柄。

源码还显示 AgentAdapterRegistry.planLibrary 仍消费 v1 planHash；加载请求及桥配置依据 snapshot 的 task/cwd/native，旧 CapabilityRunRegistry 按 task 查询 session refs。新版本需要适配这些读取方；不能仅加外层 JSON 或新表后宣布完整接线。实际两端 SDK、同 task 多绑定、完整投影／业务执行器、升级在途租约、原生恢复和产品界面尚未在本批验证。

# 现有写入口与保留身份、配置修订验证

结论：**14 项隔离检查通过**。调用当前 TaskService／ProjectService／AgentService，确认两处研究方案兼容缺口，并形成 C1.1 候选修正：可见任务删除与历史归属分离；执行修订覆盖实际智能体／供应商／工具及共享凭据关系。原产品代码未修改。本轮不宣称完整删除准入、全部写入口或第一收尾包已完成。

## 来源与证据

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`；T3 `f313d0a6cb843551fb60e57a454a71e71a3a8c04`。当前 TaskService／AgentService 的 344 个打包输入有哈希清单；ProjectService、SecretsStore 等沿用实际源码 bundle，681 个输入重新核验一致。Vite 资源 glob 以实际文件展开；只有合成密文 helper 与运行环境依赖接线，没有替换上述服务实现。

材料：[实验归档](evidence.tar.gz)、[哈希清单](evidence-manifest.json)、[静态写入口检索](writer-inventory.json)。归档包含脚本、C1 seed、实际源码 bundle、初轮八项和最终十四项结果及数据库。`probe.mjs` 可在具备记录中的 Node／better-sqlite3／node-pty 依赖环境中运行；种子与实际 bundle 已随包保存，但外部原生模块仍是环境依赖，不声称干净机器无需安装即可复跑。

## 实际检查

| 检查 | 结果与边界 |
| --- | --- |
| W01–02 | 实际 TaskService.delete 与 ProjectService.deleteProject 在 C1 下均因 FK 拒绝；C1 的 m14_task_state 直接引用可删除 tasks，阻碍原有业务。未挂载活动 PTY，没有停止真实进程 |
| W03–04 | C1.1 重建关系后的故障回滚保留原结构／外键；未适配旧删除入口得到 TASK_RETENTION_REQUIRED，不能自动绕过历史保留 |
| W05–08 | 候选事务拒绝未决结果／任务树；在明确合成结清条件下，可删除可见任务，或先保留全部任务身份再调用实际 ProjectService 删除项目。历史、能力、原生占用、输入、请求及邮件账计数不变；事务失败恢复可见记录与保留状态。未运行真实任务收束、业务未知核实或秘密删除 |
| W09 负对照 | 当前 AgentService.saveConfig 真正把 default_model 从 m1 改到 m2，但旧 profile-only 修订 SQL 不递增。不是产品自身修订功能的 bug，是研究候选漏接当前数据模型 |
| W10–11 | 候选额外触发器覆盖实际 saveConfig 模型／来源变化、实际 saveProvider 换 Key，以及 SecretsStore 直接换共享 Key；两份依赖配置一起失效 |
| W12–14 | Agent／供应商纯更名不递增执行修订；供应商、密文与修订随事务失败一并回滚；工具可用性改变只使依赖该工具的配置失效 |

初次打包发现未展开 import.meta.glob，修正为当前资源内容；首次模块加载因 node-pty 查找路径缺失而在实验开始前失败，改为记录现有实际模块绝对入口。两次准备问题留在 build-correction／preflight-missing-module 记录。最终十四项运行没有检查失败；没有启动 CLI、模型、邮件或访问供应商。

## 写入口映射：本轮范围

静态扫描覆盖 src/main 内 17 张指定表的字面 SQL 和具名 Drizzle 写操作，排除测试：**18 个文件、118 个匹配点**。这不是 118 个测试或完整动态调用图；SQL 级联、上层调用和读取消费者需要单列。原始匹配行、表和源码摘要在 JSON 中，以下是迁移责任，避免按文件复制第二套实现。

| 当前写入责任 | C1／C1.1 迁移约束 |
| --- | --- |
| TaskService create／open／绑定发现／runtime snapshot；rename／archive／delete | 新入口采用先持久任务／命令再派发；legacy 保持旧启动合同并受模式守卫。程序化原生身份与修订写绑定，不再覆写逻辑任务唯一 runner／native 字段。rename／archive 保持可见记录语义，删除经统一生命周期服务，不直调旧同步 delete |
| SessionRegistry create／bindNativeSession／adoptLibrary／refs／hold／repair／tombstone | 新旧模式显式路由，统一原生名称冲突域。历史保留与当前运行分别处理；迁移复制同时维护固定来源、当前修订、claim/source 和资源引用。按 task 更新旧表不能被当作新多绑定全量写入 |
| RunRegistry reserve／guard／prepare／attach／stop；run-recovery | 保留现有 runId 及业务外键，精确 binding／capability／generation。恢复可认定进程／活动结束，不自动恢复输入发送权、审批或删除历史占用；所有 pending 账由对应状态机对账 |
| ResourceStore；read/cache/mail recovery；旧资源退役 | 保留独立 owner_kind／owner_id，run stopped 不统一释放邮件或缓存等租约。原生历史、准备、启动 delivery 与成员资源都必须参与读取和最终回收守卫；不能仅扩充清理预览 |
| ProjectService／TransferService／CapabilityService | 项目级联删除先收束并保留涉及任务的身份，之后才移除可见记录。配置／目录与能力版本照旧失效；导入不得建立运行权限或凭据许可 |
| AiProfileService 与项目导入、SecretsStore | 保留旧 env 引用和密文事务；旧 profile 修订触发器继续适用，不能为新 AgentService 删除旧兼容路径 |
| AgentService／AgentMigration／AgentTransfer | 同时覆盖 ai_profiles、ai_run_configs、ai_tools、ai_providers 及引用凭据；新对象关联建立时也推进修订，配置迁移／导入不能绕过。当前服务模型／来源变化已有本轮证据，迁移／导入的整体联合仍未执行 |
| ProviderService 模型刷新／验证 | 这些入口直接更新 provider.models，不能只监听 saveProvider。C1.1 对整个目录 JSON 保守失效，包含检查时间或显示元数据变化时也可能递增；这是已知代价。未来可拆执行身份与可用性修订以减少无效刷新，但不能遗漏模型下线／协议不可用变化 |

读取消费者同时纳入：运行计划从固定 source revision 取执行内容；连接使用者／影响分析、插件连接读模型需按 execution_mode 选择精确新旧来源，不能继续只 LEFT JOIN 单快照。GC 的预览、最终删除及恢复均读统一引用。文件目录与业务引用继续要求真实可见 Task／Project 或明确历史只读入口，不能将保留身份行视为可执行任务。项目 controller 的 runningTasks 检查需调用统一服务，不能只覆盖旧 PTY。

## C1.1 的保留身份决定

m14_task_state 保留逻辑 ID／顺序与关系，增加 active／retained；其生命周期不再由可删除 tasks 外键决定。新增 active 状态必须对应可见任务；删除可见任务前，在同一事务将身份转 retained、解除 active binding、保留 hold 并标记其他能力 tombstone。新建任务仍应在同一事务创建可见记录和身份，retained 行不能自动激活或成为权限依据。该行不是第二份可见任务，也不恢复已删除 Task。

项目删除对所有涉及的新任务应用相同保留规则，再复用当前事务删除项目；原业务／原生历史不级联抹除。实际项目目录、远程数据、业务邮件均不在本轮删除范围。

**retireLocked 只是关系验证候选。** 它检查 run／进程／活动／run 租约和部分输入、请求、委派账；尚未接 D04 的全部独立业务账、原生后台范围、目录写入租约或真实关闭流程。生产准入不能直接复制此函数，也不能把 stopped 或本轮合成结清状态当作外部写已解决。当前副本中的“完成／not-sent”由夹具显式设置，并非执行器证明。

## 本次关闭与剩余

已解决 C1 阻碍现有删除语义、profile-only 漏掉当前 AgentService 修订两个设计子问题。写入口映射建立了可追踪基线，并非所有入口实测通过。仍需完成完整公共协议／运行时 Schema、各写服务实际适配及包 2 的关键 owner／输入／业务／恢复联合；未知外部配置来源、平台与 SDK 版本能力仍按原矩阵处理。

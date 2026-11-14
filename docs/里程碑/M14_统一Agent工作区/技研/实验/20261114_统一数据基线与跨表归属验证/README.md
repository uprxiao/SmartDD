# 统一数据基线与跨表归属验证

结论：**候选 C1 的 23 项隔离检查通过**，复现并修正了旧研究委派 Schema 允许跨任务拼接身份的缺口。此次关闭的是“同库任务图的跨表归属约束”这一设计子问题；第一收尾包及 M14 全局研究仍未关闭。没有修改 SmartDD／T3 产品代码，没有启动执行器、模型、邮件或界面。

## 基线与材料

- SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`；复用实际源码 bundle 前重新校验其 681 个输入哈希全部一致。T3 当前 `f313d0a6cb843551fb60e57a454a71e71a3a8c04`，本轮未运行 T3 服务。
- 从 §4.108 的**隔离合成实验库**只读备份，保留当时真实能力、run、来源与业务表。追加的 tasks、另三个绑定／已停止 run 是结构夹具，未声称它们经过真实 owner 准入。原 §4.108 实验没有 tasks 行，本轮显式补充合成任务；这不是对用户旧库的迁移策略。
- 合法快照通过当前 `storedCapabilitySessionSnapshotSchema` 校验，使用当前 canonicalJson／digest／selectionHash 生成；结构测试本身不验证额外运行的业务能力。
- C1 在同库共存既有能力会话、当前／启动修订、原生身份占用与来源表，复用此前 profile revision、资源 delivery／execution plan SQL；新增 task state、turn、delegation、receipt、outbox、input／inbox、runtime request／response、event、completion delivery 的联合归属。
- [完整脚本、Schema、结果及数据库](evidence.tar.gz)；[文件哈希](evidence-manifest.json)。解压后可在副本目录运行 `python3 check.py`，只使用 Python SQLite 与包内合成 seed，不访问项目或账号。`prepare.mjs` 记录最初材料生成方式，依赖当时工具环境；不是独立安装说明。

## 决定性结果

| 检查 | 实际证明 |
| --- | --- |
| C1-01 原 Schema 负对照 | 回合使用别的任务 binding、委派 parent_run 属于第三任务、outbox 使用父 run，三种错误组合均可写入，`foreign_key_check` 仍为空。只针对旧研究 `joint.sql`，不声称已交付产品存在同样缺陷 |
| C1-02–07、14–15 | 复合键约束 task／binding／run／generation；回合、委派、创建收据、outbox 及 run 收据不能各取一条合法但归属不同的记录。委派原始来源不可改写，循环被拒绝 |
| C1-08–11、16、18 | 输入的标量作用域与 JSON 一致，inbox 对应精确 scope hash；输入来源／正文／归属冻结；请求与回应保留精确运行。会话级请求允许 turn 为空，仍受 run 约束；accepted 必须有原生证据字段，但字段存在并不验证证据真实性 |
| C1-12、19 | 子结果可以投给同一父任务的新 binding；不能换父任务或借其他输入。一旦 dispatching／unknown，不能借 Provider 切换改投；pending／明确 not-sent 才允许重新选择合法目标，其他运行状态仍由服务判定 |
| C1-13、17 | 投影、事件和序号的同一事务在注入异常时一起回滚；事件不能混合 task 与外部 run。没有模拟进程崩溃、IPC 或执行器回调 |
| C1-20–23 | Schema 在 graph／delivery／提交前故障处回到精确原结构，重新安装与重复执行可判定；已记录 C1 但实际结构变化时拒绝。最终完整性、外键及重开检查通过 |

第一次扩展审计在 C1-22 失败：测试把 `install()` 放进 SAVEPOINT，而安装器明确要求事务外调用，断言先于 Schema 漂移检测触发。原失败脚本、结果和数据库已保留为 `failed-audit-*`；改为在独立已提交副本中删触发器后检查，最终 23 项通过。未修改安装器以放宽前置，不把失败描述为产品／供应商问题。随后将关键负例增强为直接 INSERT，避免下游引用阻止 UPDATE 掩盖目标约束；审计脚本一次误用含连字符的未引用 SAVEPOINT 名称而语法失败，保留 `failed-insert-audit-*`，改为合法标识后通过。没有放宽任何候选约束。此前 18 项及初轮 23 项结果保留为 `initial-*`。

## 开发约束与未证明内容

C1 是供下一轮服务联合使用的**研究数据基线**，不是可直接复制的最终产品迁移。`m14_` 命名为研究标识。复合外键检查归属一致性，不签发真实 owner、运行许可或真人来源；冻结 JSON 的内容哈希、协议 Schema、配置当前性、权限、目录写入排空、审批状态迁移和原生证明仍由既有对应服务检查。

此包包含 `combined-schema.sql` 的最终结构快照；重建程序使用原 seed 加 `install.py` 的有事务安装，不把该快照当产品升级脚本。旧研究 `joint.mjs`、input.mjs 和 request kernel 的字段／连接方式需要显式适配 C1，当前没有冒充它们已接入新表。没有运行第三适配器、真实混合链、生产旧库迁移或所有写入口。

任务与 binding 的历史保留不能通过补造用户 Task 解决。生产迁移需识别真实 Task、原生历史及无法映射记录：无法映射的历史继续保留／诊断，进入运行前显式解析归属；本轮合成 tasks 仅服务反例和约束测试。

已取得的关系约束证据可直接用于包 1；下一步必须把当前真实写入口与公共命令／事件 Schema 映射到 C1，再推进包 2 的 owner、输入、委派、业务和恢复联合。不能用这些 SQL 检查替代该工作，也不再为同一归属断言重复新增实验。

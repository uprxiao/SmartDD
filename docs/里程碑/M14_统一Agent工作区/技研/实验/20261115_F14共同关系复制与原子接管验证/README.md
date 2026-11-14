# F14 最终共同关系、历史复制与原子接管

2026-11-15。**F14／Q47、49、50研究关闭；不是产品迁移或正式验收通过。** 设计唯一正文为 [T0.1 §11.5](../../技术方案.md#115-最终共同关系上的复制与原子接管f14)，共同基线C1.9、公共命令P1.2。

本批共10个定向判据：1项预期反例、4项受控投影、4项复制恢复、1项完整关系保留。复用当前SmartDD真实copyClaudeSession、CapabilitySessionRegistry、资源锁、MacProcessIdentityReader及数据库；生产源码未改。仅在临时构建中给原注册器的一条identity SQL加同步包装，共享原模块的真实WeakSet收据校验，没有造收据或取消原校验。

| 判据组 | 结果 |
| --- | --- |
| NEGATIVE | 同task加入programmatic planned binding后，原注册器即使拿到真实copy receipt也因M14_LEGACY_IDENTITY_SEALED拒绝；元数据全回滚，源保持。复现拟议M14接线问题 |
| GATE01–04 | 普通adopt仍拒绝；受控窗口内提交异常使全部指针／claim回滚且窗口关闭；有效提交同时更新Task根、binding、cap和旧新claim，其他binding保持；窗口外旧写入仍拒绝。未完成copy的真实run INSERT拒绝，commit后只解除这项维护阻挡（插入试验随后ROLLBACK，无Agent启动） |
| C01 | 在真实copy函数首个stage文件复制完成后process.exit(73)，不执行finally；新进程重开看到旧指针，重新claim／核验并取得新的真实receipt后提交，源不变 |
| C02 | 上述退出后改动已记录目标stage文件，恢复在复制前拒绝TARGET_CHANGED，copy次数0，修改字节保留 |
| C03 | 恢复后在最终commit回调注入异常，Task／binding／cap仍旧根、只有旧claim；下一进程合法重试提交 |
| C04 | 成功提交后追加合成后续历史，恢复按committed不再复制，新增字节保留。此项不是新的真实Agent续写 |
| GRAPH | 完整F13 C1.8库副本追加C1.9后，153张既有表的数据摘要全部不变（不含合同版本标记，81张非空），包括Git／历史／业务数据；完整性／外键与F10原保留查询通过 |

[综合结果与审计](source-audit.json)连接各实际结果，6份最终库外键／完整性及F10保留查询无问题；当前原模块379输入、候选327输入均未变化。已有数据库版本探针460输入、双恢复者379输入、原生claim/resume383输入也全部摘要一致，原证据按其本来层级复用，不计本批执行次数。

## 两个修正与边界

接线反例的修正没有删除旧守卫。新增copy意图和最终run阻挡；受控窗口只在已核验事务内精确允许该task的同nativeId／cwd根更新，其他时间SQLite许可函数返回0。候选构建共享当前实际native-state模块的WeakSet收据，原注册器其余验证及事务原样保留。[copy.sql](copy.sql)是C1.9增量，不是已登记的产品迁移。

第一次最终审计发现新建夹具只复制Schema、漏初始化F08的business epoch行，导致F10 reader报Cannot read properties of undefined。完整C1.8图副本没有此问题。补齐原方案要求的epoch及发布代次初值后，重新执行负例、4项gate、4项copy和graph，最终审计通过；首失败说明与前轮结果保留，不计成产品缺陷，也不掩盖首次失败。

复制中途是实际子进程退出，位置为第一个stage文件之后，不是磁盘断电或文件写到一半。原stage残留保留，没有实现自动垃圾回收。文件清单观察仅用隔离合成根；原复制器实际只处理该session及同名子树，生产不得因此全量扫描配置目录或SVN项目。

两个程序化接点仍是候选：共同多binding投影及原注册器同步窗口。Task表根指针是真实SQL更新，未调用整个TaskService或UI；保留的Git／导入历史sentinel为合成资料，整图另以完整C1.8证据库验证未改动。没有真实业务发送、模型调用、真实产品安装／旧包回退、任意OS写者防护或全平台验收。

旧的hold、未知owner／竞争、原生格式往返／合法续写、版本规划／备份恢复证据继续有效；当前实验补冻结清单要求的复制中途和最终关系接点。正式A47／49／50保留真实服务接线、包与平台验收。产品验收仍0／54。

[归档](evidence.tar.gz)和[摘要](archive-manifest.json)保存当前原／候选构建、输入摘要、脚本、精确SQL、各进程退出、最终库、首失败与部分预跑结果。没有打包公司项目、真实账号或凭据；复放须按脚本映射本机Node依赖和Mac进程身份helper。

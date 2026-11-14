# F08 业务范围与最终准入验证

2026-11-14。**F08 研究关闭，生产功能未实现。** 当前 SmartDD 实际业务读服务及历史合成邮件结果，联合 C1.4 副本上的 C1.5 准入候选；八项检查通过。没有新模型请求、SMTP 发送、浏览器操作或用户批准。

| 检查 | 实际结果 |
| --- | --- |
| A01 邮件事实 | 复用实际 readDraftSendHistory／MailUnknownVerifications 校验两条人工 sent／not-sent；原 SMTP unknown 不变，无新 grant；部分接受不显示成全部成功 |
| A02 对象范围 | 复用实际活动 target／subject 解析；同项目连接 A 的 unknown 不挡受模块约束的连接 B 操作；无项目连接管理可用有效 subject 定位。归属缺失、冲突 target 拒绝；删除后的已知 target 范围保留；无效来源不会被人工核实覆盖成 resolved |
| A03 同一操作 | MCP invocation 与 Data API 同 operationId 只归并一次，但先比较 project／task／run／包／semantics，矛盾保持 unverified |
| A04 最终 prepare | 预览后插入、更新、删除匹配记录，原摘要均拒绝；新预览也不能把删除的 unknown 当空白；没有写出可消费回执 |
| A05 最终 consume | 第二个真实 SQLite 连接插入记录后，旧 prepared 回执不能执行 callback；伪造对象／重放拒绝；callback 失败时新操作与消费状态一起回滚，成功时一起提交 |
| A06 独立活动 | stopped run＋人工核实仍不能覆盖 active mail-send 租约；release 后允许。本批租约为明确夹具，真实 stopped／mail lease active 证据复用前批 |
| A07 核实修订 | 人工核实内容／摘要变化使 preview 失效，坏记录保持 unverified，原始 SMTP unknown 和零 active grants 保持 |
| A08 删除／覆盖 | unknown 阻止进入删除 callback，原 task／业务记录仍在；丢失 browser 表表现为覆盖不足，不是零结果 |

[最终结果](result.json)为 attempt-3OvkbR，全部数据库完整性及外键检查通过。没有执行完整任务删除／实际新 Agent 派发；F01 已有可见删除事务证据，本批只补最终业务资格，资源回收仍归 F10。

## 设计决定与限制

以各业务模块的完整未决事实为准，活动分页不是准入数据源。运行生命周期、业务活动、外部结果和执行权限分别判断。候选从十五张表及关联信息取得事实，45 个触发器记录源修订；删除保留旧行证据。schema／来源覆盖错误保持 unverified。C1.5 在 C1.4 上增加 epoch／gap／admission，P1.2 公共请求外形不变；[DDL](admission.sql)和完整候选在归档中。

prepare 只产生短期候选回执；consume 在共同资源锁及 immediate 写事务内重读，匹配修订后将业务预约／操作登记与消费原子提交。生产实现还必须联合 F06 执行范围、目录权和实时业务权限；此回执不能替代 owner、R17、实时 context、邮件 grant 或稍后 native spawn 的最终检查。所有生产者接入共同协调协议属于后续产品实施。本批用全量小夹具摘要说明语义，生产用按范围索引的未决账和来源修订，不能在每次输入扫描全业务历史。

对象级放行仅适用于执行端能强制目标的具体业务操作；任意 Agent／Shell 仍按项目／工作区交棒，不能用“只读”提示词缩小范围。known unrelated 在新预览中不受业务 unknown 阻挡；候选全局 epoch 可使无关变更导致旧回执失效，重新预览即可，不能据此称全部业务必须串行。无法验证范围时保守阻断，保留历史与对账入口。

已知对象的删除证据要保存原归属和 target／subject 解释，不应只剩一个全局 unknown。首次补充断言复现删除 data operation 后丢失 target、误挡无关连接，候选修正后同一八项通过；红测 attempt-9oxxDk 和结果均归档。候选对缺失关联而无法重建的 subject／草稿元数据保守标 unverified；正式模块须在删除事务保留规范化原关联，不能从当前新配置猜历史对象。保留索引须早于旧浏览器 TTL 清理安装；历史已经缺失只能声明覆盖缺口，不能补造未执行。F10 决定何时可清理这些保留依据。

人工核实通过原修订、内容／review／record hash 验证，保持原传输结果，不生成新批准。原结果 failed 只有业务模块的实际执行回执足够时才可解释；仅有 failed 标签而无 execution 的候选保持 unverified，不泛化成未发送。已知 stale／canceled、无执行且无 active grant 的准备阶段可解释为已结束。新的 not-sent 后续发送仍经原模块的新草稿、intent 和具体授权。

研究直接调用实际 bundle 中 TS-private 的 item／decode 只读解析，不伪造 UI actor。产品应从原模块提取共享只读校验接口并保留 UI 权限检查，不能把 private 方法或 policy noop 作为公开 API／授权方案。旧服务的写入口、实际发送和恢复在前批已验证，本次未重跑。

## 证据来源与夹具准备

486 个构建输入及原输出摘要与当前文件一致，见[源码清单](source-verification.json)。复用前批实际服务构建，不把自写候选称为产品服务。来源版本为 SmartDD 5a9e04382441e24624cb94635f9d902c543a03d7；T3 参考仍为 f313d0a6cb843551fb60e57a454a71e71a3a8c04，业务准入是 WillYou 既有业务所需，不声称 T3 有这四套业务账。

输入是 C1.4 隔离库副本与既有合成邮件实验库。为重用原邮件事实，补了明确的 stopped 历史 task／run 查找夹具；它们不是活的执行身份。原 C1.4 中与本场景无关且无归属的合成操作在安装 journal 之前替换，并将替换前全量行单独归档。初次未替换时被正确阻断；此操作只是测试准备，绝不是“迁移时清掉 unknown”的方案。最初漏拷 lookup／blob／project 依赖引发 FK 失败，补齐后检查通过，失败文件保留。

[输入摘要](input-manifest.json)、[归档](evidence.tar.gz)、[归档摘要](archive-manifest.json)保留候选、实际 bundle、来源快照、seed、红测和最终库。原输入文件未改，用户数据／真实 Key 不纳入；重放需要隔离依赖，不自动发请求。当前没有验证产品 UI、正式迁移注册、全生产者接线或真实资源 GC；后续按 A13／17／24／27／28／32／41／48／49 验收，产品仍 0／54。

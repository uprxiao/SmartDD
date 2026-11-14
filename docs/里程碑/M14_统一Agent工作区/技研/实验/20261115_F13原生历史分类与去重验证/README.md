# F13 原生历史分类、去重与来源验证

2026-11-15。**七项研究检查通过，F13／Q46研究关闭。** 本批无真实模型调用、无产品代码改动、无正式验收。设计唯一正文为 [T0.1 §11.4](../../技术方案.md#114-原生历史分类lineage-与只读导入f13)，共同关系增量为C1.8，公共命令保持P1.2。

复用此前固定版本原生进程生成的10份JSONL／wire录制：Claude native2.1.321／SDK0.3.321，Codex native0.167.1。原实验连接受控本机模型，不能称为真实供应商回答。包括两端工具往返、父子会话、Claude子状态、Codex子工具事件及已录制MCP elicitation。271条去重后记录；来源manifest仍保留原始每次出现，可以逐字节重建所有10份输入。输入清单、hash及其真实来源路径见[corpus](corpus.json)。没有重新运行T3或SDK历史API。

| 检查 | 实际结果 |
| --- | --- |
| I01 两端分类 | message／tool-call／tool-result／child-history／request-history／metadata／mirror分别建模；每个来源字节还原一致。Claude child stream两条未声明记录保留unknown，整体partial，未伪报全格式支持 |
| I02 重复与追加 | 再导入10份原文新增0条／0revision；追加同文不同UUID保留新消息，旧revision仍可读 |
| I03 同key冲突 | 同UUID不同字节两份均保留；回到旧文件内容仍partial；另一stream中相同ID不合并 |
| I04 未知／损坏／缺失 | 未知成功标记不转成功，非UTF8损坏行字节仍在；原文件及单独子文件删除后旧导入保留，父仍可读、来源集合partial |
| I05 来源与镜像 | user包裹工具结果不转真人；Codex item_completed镜像不再造气泡；历史请求不可回应，伪造liveReceipt无效。既有submission／run／task事件数量不变 |
| I06 事务中断 | 插入后、commit前注入异常，record／revision／指针全部回滚；重试仅导入一次。本项是显式事务异常，不称进程掉电 |
| I07 支持与身份 | 未知版本仅原文／诊断；Codex错误header使整流不映射为选定会话；错误binding身份拒绝；末级符号链接和超过16MiB来源拒绝，旧导入保留 |

## 首败与修正

补“冲突后又恢复旧字节”的反例时，attempt-q3vkt4r2的I03失败：相同revision的快速路径只读旧observation，把source误改回readable。修正为该路径也查询全部已存raw版本冲突；相同原判据最终通过，见[最终结果](result.json)。初跑及失败脚本／结果均留归档，不重复计数。最终attempt-2sw0dmwt为7项通过。

## 证据与边界

[SQL](contract.sql)在F12实际C1.7结果库副本追加三张只读历史表。具体driver来源校验binding.runner/nativeId；测试创建合成preparing binding承载不同录制ID，不启动执行器。host-request录制包含不同历史scope，作为辅助审计保留，未伪装为当前binding的实时请求。来源的原生root／文件授权由宿主先解析；本探针只验证末级非链接、文件读取时身份／元数据不变及预算，**没有重新执行产品原生文件定位／业务证据读取器**。

[审计](source-audit.json)记录当前SmartDD／T3 HEAD、七个相关源码摘要、全部录制hash、C1.8外键／完整性和原F10保留查询无问题。它是当前源码对照，不宣称重新执行全部旧构建。导入raw存历史表，不新增外部包／内容对象引用；物理删除binding受外键保护。

[归档](evidence.tar.gz)及[摘要](archive-manifest.json)保存最终候选／探针、原输入、SQL、结果库、首败和具名源码。候选的16MiB来源／1MiB单条解析预算用于隔离复放；未测成品长历史导入吞吐、流式游标、真实UI／IPC或源目录所有权。原始读写以只读来源和临时库进行，产品长历史有界接线按T0.1／F16和A46继续验收。

本次研究出口是已声明格式有分类、稳定关联、原文保留、增量／冲突／缺失处理及来源隔离。历史可读不等于native可恢复；辅助wire与主transcript的归属由宿主已核验lineage决定，不能按文本合并任意来源。正式产品验收仍0／54。

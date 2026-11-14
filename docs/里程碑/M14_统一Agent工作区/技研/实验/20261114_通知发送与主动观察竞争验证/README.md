# 通知实际发送与主动观察竞争

2026-11-14；R03／05／06／10／12，Q24／25／28。技术方案 §7.2.4，验证账 §4.62。研究与隔离候选修正，不是生产功能开发。

## 发现

§4.57 的 Results.ack 在任何通知状态下都写 disposed。之前只验证领取阶段竞争，没有覆盖实际发送之后的主动观察。本批 N01 在真实 Codex app-server turn/start 已接受通知、宿主尚未记录对应回执的窗口执行 read／ack，复现 sending 被覆盖；原 run 排空后 Provider 路由切换错误放行。

这是旧研究候选的缺陷，不是声称 SmartDD 或 T3 已有同一生产问题。负例和修正后的候选保留在同一归档，未修改两边仓库的产品源码。

## attempt-Z4hCZ1：4 项检查

| 检查 | 实际证据 |
| --- | --- |
| N01 负对照 | 原候选在真实通知接受后，结果 ack 抹掉 sending；停止原生 run 后 switch 通过。保留前后数据库行及真实 RPC 回执 |
| N02 修正 | 观察写入一次，但 sending 保留；停止实际 run 后仍阻止 switch，对账改 unknown 后仍阻止；仅夹具显式处置通知后才可继续 |
| N03 未发送 | 自动领取后主动读／ack 令旧 claim 失效；旧 markDispatch 拒绝，实际 turn/start 数不增加 |
| N04 回执后到 | 主动 ack 后才记录实际原生接受回执，通知记 delivered；回执同内容重放幂等、冲突及错误 token／复制句柄拒绝；再 ack 不覆盖回执，原 run 停止后允许切换 |

三个原生进程均为固定 Codex 0.167.1，经实际程序化 owner、冻结执行计划及 gated launcher 启动；全部捕获退出码 0，三个 run stopped。三个本机模拟模型请求被保持未完成后随自己的 run 结束；无外部模型、真实子任务或业务写入。结果正文是 seeded 合成数据，read／ack 由驱动经私有 owner 直接调用，不声称本批包含实际模型工具读取。

## 设计收口

结果 observed 和通知传输是两个事实。主动观察只可取消 pending／claimed 的未发送通知；sending／unknown／已接受的投递证据必须保留。迟到接受回执只能补充原通知 attempt 的精确证据，不能转给新 binding／generation，也不能当作业务完成或真人授权。

修正只缩小 ack 的更新条件，没有重建第二套结果正文或自动重新委派。N04 的 nativeAccepted 是研究用可信适配器入口，调用点持有原私有 run 和真实 RPC 回复；它不是可让 renderer／模型自由提交 JSON 的公共 API，最终入口仍须和不可伪造发送句柄／持久 inbox 合并设计。delivered 在此仅代表 turn/start 已被原生接受，不代表模型完成处理或任务树完成。

N02 的显式处置仍使用 fixture-explicit-stop-notification；它不是实际用户授权 UI。实际 socket 部分写入、宿主在回执落库中途退出、旧 owner 停止后迟到回执、父忙排队、Claude 对应竞争及完整私有业务 MCP 链尚未在本批执行。既有局部证据不合并宣称端到端通过。

## T3 对照和证据

本地 ProviderContinuationService 用 queue_after_active，并携带 parentRunId／generation／messageId；OrchestratorMcpService 的终态 task_status 在返回前派发 completion-delivery.acknowledge。WillYou 的独立观察 token 属于候选扩展，本批不把它说成 T3 的接口。

[结果](result.json)、[运行审计](runtime-audit.json)、[源码依据](source-review.json)、[摘要](archive-manifest.json)、[原始驱动／帧／数据库](raw-evidence.tar.gz)。归档 118 个文件，5 份 SQLite 完整性／外键通过，504 个构建输入核对当前源码；二进制按 native-inputs 固定 SHA 校验，未打入归档。

复跑：准备归档中的依赖路径与固定本机二进制后执行 node probe.mjs。只结束脚本自己捕获的子进程，不读取日常 HOME／凭据，不连接公网模型。

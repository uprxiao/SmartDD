# A19 真实模型通用委派

2026-11-19，macOS arm64，feature/0.1.6。三种组合在同一隔离包 9a6e95cdc，用真实 Claude Code／Codex 和已授权的 DeepSeek 官方 API。打开任务、发起真人输入走真实页面。供应商中继只收本次隔离 App 的合成请求。三次均以原生子任务读取独有标记，子绑定与父分别持有独立原生会话和 CLI／桥。父收到宿主的原结果通知后，用同一父绑定查询并报告标记。SQLite 校验子任务、attempt、通知与回合顺序。三个 App 均以代码 0 退出，原记录的 CLI／桥出生身份均核验归还。

| 组合 | 实际模型请求 | 证据 |
| --- | --- | --- |
| Claude 父、Codex 子 | 8 个 HTTP 200，双协议 | [结果](attempt-348/result.json) · [界面](attempt-348/10-real-delegation-result.png) · [SQLite 与进程](attempt-348/verified-ledger-and-identity.json) |
| Codex 父、Claude 子 | 8 个 HTTP 200，双协议 | [结果](attempt-349/result.json) · [界面](attempt-349/10-real-delegation-result.png) · [SQLite 与进程](attempt-349/verified-ledger-and-identity.json) |
| Codex 两个配置 | 8 个 HTTP 200，父与子使用不同的 profileId 和 providerId | [结果](attempt-352/result.json) · [界面](attempt-352/10-real-delegation-result.png) · [SQLite 与进程](attempt-352/verified-ledger-and-identity.json) |

350 两配置首试时旧中继报告 Premature close。已有委派收据落库，驱动过早中止，原记录不足以定位连接先由哪端关闭。调整中继后，独立标记下游关闭并保留供应商读取错误；3 项离线正反检查通过。352 在同一包、独立数据完整复验，7 个实际模型应答均读至尾端。保留首试日志和原判据。 [350 原结果](attempt-350/result.json) · [旧来源](driver/a19-d0662-before-http-close-check.mjs) · [新中继检查](driver/a19-forward-response.test.mjs)

本轮只使用合成项目和授权测试线路。日常 Codex 登录态未参与。A19 共用既有 U／I 和合成真实 App 证据，同一次用户输入、真实模型、原生桥和打包界面均已取得实证，整条通过。

# A60 Claude 普通失败后仍可批准宿主业务请求

2026-11-19，macOS 26.6.1 arm64，隔离的 WillYou 签名候选 `463155a0f4c2cc0fbd85ae65116f882ddb2a0a36`，`app.asar` SHA-256 `52c1841ced1aa0e340f660ba56e671aae08f354917b3fb25439708de8396f5ac`。使用本机 Claude 原生进程与 SDK、本机合成模型响应及实际 App 后台 CDP。邮件操作始终使用隔离数据里的本地草稿。

- 176 的原生回合自然以 400 失败。同一审批仍可点击，在本地生成一份草稿。后继回合的测试服务把历史 MCP 工具内容误认成再次调用，返回了 500。保留驱动失败证据。[176 原始结果](attempt-176/result.json)
- 177 修正服务判定后使用同一包。故障阶段的 Claude 回合自然失败，审批的 ID、修订 1 和发起任务、绑定、运行、代次与故障前一致。通过实际等待面板确认后，数据库只有一份修订 1 的本地草稿。发送意图、授权与执行均为零。宿主结果在同一 Claude 会话开启后继回合，原生收到了对应通知，回合完成。App PID 10460 以退出码 0 正常退出。[177 原始结果](attempt-177/result.json) · [独立核对](attempt-177/verified-177-host-400-complete.json) · [退出时序](attempt-177/quit-phase.jsonl)

[失败前审批](attempt-177/01-original-pending-before-failure.png) · [失败后审批仍可处理](attempt-177/02-failed-round-with-live-business-review.png) · [批准后仅生成一份草稿](attempt-177/03-only-explicit-approved-draft.png)。

此证据完成 A60 普通失败仍保留宿主请求的实包判据。原生 ACK 前停止、其他终态组合、模型默认与公布选项仍见 [A60 矩阵](../../A60-终态证据对照.md)。原生 401 重试待终态的早期观察见 [172／174](../../4f1d4c0a2/A60-host-failure/README.md)。

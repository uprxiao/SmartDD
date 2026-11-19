# M14-A16 发送故障、未知回执和重启

2026-11-19 在 macOS arm64 使用隔离 WillYou 包。源码 15be1a81ebd66740d252d5835a8bee7b971dcd2e，ASAR SHA-256 1bbfc724e8e4d3a88e77f4b63a57b2de5ea0548cb5bfb6a88d89dd6b40cab48d。用户动作由后台 CDP 触发真实输入框和按钮。主动故障只在本次数据库、隔离 Codex stdin/stdout 进程与本次窗口 IPC 回执注入。应用使用原生协议替身，测试不调用模型服务。

| 判据 | 实际结果 |
|---|---|
| 派发前失败 | 私有 SQLite 拒绝原始接受事务。草稿完整保留，查无回合和原生派发。移除触发器后用户真点重试，原生仅收到一次。[派发前失败](attempt-073/00-predispatch-safe.png) |
| 明确拒绝后重试 | 协议明确拒绝，宿主记录 failed、无原生回合标识；重启后原条目仍可操作，点击原条目“重试”形成一次独立尝试并完成。[失败消息](attempt-073/01-known-rejection.png) |
| 发送后无确认 | 执行器已收到 turn/start 后进程退出，重启后仍明示“接收未知”，之后其他输入完成也没有重发该指令。原生派发次数为 1。[重启后的未知状态](attempt-073/03-unknown-after-restart.png) |
| 接受后丢回执 | 原 handler 已持久接受才阻断首个界面回执。再次真点发送沿用同一 clientInputId，返回同一 turnId；重启后从原窗口调用公开 IPC 特意重放同一 ID，仍返回同一收据，仅一条时间线用户消息与一条原生派发。[原回执缺失](attempt-073/04-durable-send-receipt-lost.png) · [重启](attempt-073/05-same-intent-after-restart.png) |

四个隔离 App PID 均退出 0，没有强制结束或渲染异常。[073 完整记录](attempt-073/result.json) · [真实服务与界面 U/I，140 项](a16-ui-and-host.log)。

[070](attempt-070/result.json) 供应商准备使用了非预置本机端口，产品按规则拒绝；[071](attempt-071/result.json) 生成的替身脚本转义错误，真实版本检测拒绝；[072](attempt-072/result.json) 替身缺少历史注入方法，暖机未开始。保留前三次失败，最终驱动先单独过脚本及握手、历史注入、回合协议检查后重新执行。

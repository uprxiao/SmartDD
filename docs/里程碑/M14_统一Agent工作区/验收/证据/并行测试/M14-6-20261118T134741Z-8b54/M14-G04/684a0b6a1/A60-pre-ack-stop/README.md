# A60 原生开始回执前停止的实包复验

2026-11-19，macOS 26.6.1 arm64。新隔离签名候选 `684a0b6a1e1ba01c12f405b89087aebf9e357a5d`，`app.asar` SHA-256 `237e4b90eb22fbae9329bb475094ba99a397433fd9d0f30d52ec1c34e53379fc`。使用真实本机 Codex app-server、真实 App 后台 CDP 和回环合成模型响应。测试只暂扣本轮的原始开始回执和通知，在实际停止持久化后原样释放；驱动结束时还原观察器。

- 182 观察到一次正确中断，原请求关闭、原轮停止、下一条真实手动输入响应并结束。初版额外断言后继使用同一宿主运行 ID，故将本轮记为测试失败。独立检查隔离库确认，新运行代次接续同一任务、绑定与 Codex 原生会话，原进程正常收口。App 正常退出。 [原始结果](attempt-182/result.json) · [独立核对](attempt-182/verified-182-same-native-thread.json)
- 183 按绑定和原生会话重新核对。同一停止发生在宿主原生回合 ID 仍为空时。释放两个原始帧后，只向该原生轮发一次中断，实际模型请求关闭且原生终态为 `interrupted`。手动下一输入只发一次，原运行结束后以新代次恢复同一原生会话并完成。两个真 Codex 进程均确认退出，App PID 55325 正常退出（0）。 [原始结果、原生时序与关闭验证](attempt-183/result.json) · [退出时序](attempt-183/quit-phase.jsonl) · [已停止](attempt-183/01-before-start-ack-interrupted.png) · [手动续聊](attempt-183/02-next-input-after-stop.png)

D06-53 关闭。旧包反例和 U／I 回归见 [179 与源码](../../463155a0f/A60-pre-ack-stop/README.md)，新包见 [构建与哈希](../../../build/candidate-684a0b6a1/package-684a0b6a1-sha256.txt)。本项计入 A60 的一个判据。

# A60 原生开始回执前停止（D06-53）

2026-11-19，macOS 26.6.1 arm64。旧签名候选 `463155a0f4c2cc0fbd85ae65116f882ddb2a0a36`，`app.asar` SHA-256 `52c1841ced1aa0e340f660ba56e671aae08f354917b3fb25439708de8396f5ac`。真 Codex 原生 app-server、回环合成模型响应和真实 App 后台 CDP。

- 179 暂扣这一输入的真实原生 `turn/started` 与同一 `turn/start` 回执。真实点击停止，宿主先持久记录停止。随后向产品释放原字节，驱动实测拦到两次中断请求，进程最终结束原回合，App 以 0 正常退出。旧脚本在首次核对数量时中止，保留观察结果和退出证据。 [原始结果](attempt-179/result.json) · [退出与清理](attempt-179/cleanup.json)
- 根因是 Codex 驱动收到开始信号时派发中断，同时宿主在派发异步完成时为同一次停止调用中断。原生回合现在共用同一中断请求，收到原生回执后至终态仍保留它。明确失败后允许重试。前一轮提前停止不会传到后继轮。修复本地提交 `684a0b6a1e1ba01c12f405b89087aebf9e357a5d`。
- 新回归用旧驱动复现相同原生轮的重复中断。Electron 运行器复验 agent 与相关渲染端 385 项通过、7 项按既有前置跳过，类型检查退出 0。首次用普通 Node 运行完整套件时，原生 SQLite ABI 与 Node 不匹配，该次日志作为环境误用保留。[回归失败](driver-regression-before.log) · [Electron 回归](electron-regression-after.log) · [类型检查](typecheck.log) · [运行器不匹配记录](driver-regression-after.log)

D06-53 已在新签名包复验关闭。182 测试对续聊使用了错误的宿主运行条件，183 按真实原生会话检查后完整复验通过。[新包复验](../../684a0b6a1/A60-pre-ack-stop/README.md)

# A04 Claude 原生会话两代及实际身份拒绝

2026-11-19，macOS arm64，Claude CLI 2.1.326 和锁定 SDK 0.3.321。签名候选 `4f1d4c0a215820ce9256fce8bdd529986dc0d17b`，ASAR `0116ddf8720e421e00f6e3d8d48dbede8a493400eda18ccda34faf45f29fe6f0`。本机隔离 App、实际桥、本机合成模型。所有短效句柄仅在隔离 App 内存中使用，未写入报告。

170 用实际 UI 发送、停止、恢复。两次 SDK 原生启动分别使用 `--session-id` 和 `--resume`，对同一个原生会话。宿主同一个任务及绑定从 generation 1 到 2。两代实际已认证连接均有合法只读正例。复制句柄和旧代次返回 `AUTH_REQUIRED`，同一已认证桥自报调用方字段返回 `INVALID_INPUT`，业务执行状态均为未开始，真实审计匹配原身份。两代真实 CLI 和桥均已退出，租约释放，业务执行和自动重发均为零。观察器已恢复，App PID 52778 正常退出，无界面报错。[原生启动、回执和清场](attempt-170/result.json) · [独立核验](attempt-170/verified.json)。

本条同时包含 [Codex 身份](../../703ec066f/A04-authority/README.md)、[启动准备时停止](../../1da88d8f8/A04-prepare-stop/README.md) 与[进程出生和桥握手时停止](../../1da88d8f8/A04-post-fork/README.md)。受影响运行、桥与诊断检验见[软件回归](../../../build/candidate-703ec066f/README.md)。

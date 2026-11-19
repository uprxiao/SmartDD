# A39 实包与文件标签修复 D06-46

2026-11-19 07:16 新加坡时间。macOS arm64，候选 `e779d4e1703b2de07789175422ddb3b3ceafe189`，ASAR SHA-256 `7ea76c07ef24e3baa9339e0436d564ca8b7230b8a7ec61357792fbcff55bf988`。本机真实 Claude 和文件查看器 provider，模型与文件仅使用隔离合成夹具。后台 CDP 点击实际控件，使用原 IPC 透传观察及只读旧作用域查询。

- 同场运行 Agent MCP、业务 MCP、宿主委派 MCP 和独立文件查看器 MCP。实际停止 Agent 后原查看器 ID、代际、进程仍相同，读回原文。[同场](attempt-119/01-four-live-scopes.png) · [停止后的原查看器](attempt-119/02-same-viewer-after-agent-stop.png)
- D06-46 复验通过。内嵌文件面板的偏移为 0，标签与关闭控件的中心实际命中；外层 M9 保持 44 px。真点关闭后，文档与查看器分别收到真实关闭回执、原 provider 退出、旧查看器返回 `UNTRUSTED`，后继 Agent 的同一个运行继续真实调用业务和委派。[关闭后](attempt-119/03-new-agent-retains-mcp-after-doc-close.png)
- 主 frame 实际重载之后，原 provider 退出、旧引用拒绝，新打开的查看器获取新 ID 并读回原文。这一项观察的是 renderer 换代。另由 123 验证真实窗口销毁。App 退出码 0，记录的九个其他进程和私有 3425 监听均已退出。[新 renderer](attempt-119/04-trusted-new-renderer-new-scope.png) · [退出回执](attempt-119/quit-phase.jsonl)

[原始结果](attempt-119/result.json) · [证据哈希](attempt-119/SHA256SUMS.txt) · [旧包重现](../../25516433f/A39-mcp-and-file-tabs/README.md)

123 在实际文档查看器仍活动时正常退出，记录 `BrowserWindow.closed` 和 `webContents.destroyed`，原 provider 随后退出。在相同隔离数据用新进程启动，旧引用在打开文件前、后均返回 `UNTRUSTED`，新 viewer 实际打开同文件并读回完整 35 字节。两次 App 都正常退出，未进行 macOS 红键隐藏。[销毁前](attempt-123/01-real-file-still-open-before-quit.png) · [重开后的新查看器](attempt-123/02-new-app-same-data-new-file-viewer.png) · [窗口生命周期与旧引用](attempt-123/result.json) · [初次退出回执](attempt-123/quit-first-phase.jsonl) · [复开退出回执](attempt-123/quit-second-phase.jsonl) · [证据哈希](attempt-123/SHA256SUMS.txt)

同冻结源按文件 owner、控制器、桥进程、业务请求和 renderer 透传补验 18 项通过。[U／I 日志](a39-owner-and-source-tests.log)

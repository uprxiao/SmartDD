# 候选 4f1d4c0a2 构建和 Codex 额度回归

2026-11-19，macOS arm64，WillYou 0.1.5 隔离候选。冻结源码 `4f1d4c0a215820ce9256fce8bdd529986dc0d17b`，ASAR `0116ddf8720e421e00f6e3d8d48dbede8a493400eda18ccda34faf45f29fe6f0`。

D06-51 消费 Codex 当前轮的原生额度通知，只在原生额度耗尽终态显示可用的真实结构化时间。过期、其他额度、非耗尽窗口及跨轮时间不会混用。Agent 与任务渲染端 382 项通过，7 项条件跳过。类型检查通过。包内 SQLite、PTY、语音桥、文件代理、Office 渲染和文件监听六项通过。

[构建日志](package-4f1d4c0a2.log) · [组件 SHA-256](package-4f1d4c0a2-sha256.txt) · [修复前回归](a60-codex-structured-reset-red.log) · [受影响软件回归](a60-codex-structured-reset-green.log) · [类型检查](a60-codex-structured-reset-typecheck.log)。

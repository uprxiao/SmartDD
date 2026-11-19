# 候选 463155a0f 构建和目标清除回归

2026-11-19，macOS arm64，WillYou 0.1.5 隔离候选。冻结源码 `463155a0f4c2cc0fbd85ae65116f882ddb2a0a36`，ASAR `52c1841ced1aa0e340f660ba56e671aae08f354917b3fb25439708de8396f5ac`。

D06-52 使派发与目标操作复用同一次原生会话打开，等待打开完成后才使用。在档案解析和宿主管理资源准备两处对照旧代码，两条均复现，修复后均通过。Agent 与任务渲染端 384 项通过，7 项按条件跳过。类型检查通过。包内 SQLite、PTY、语音桥、文件代理、Office 渲染与文件监听六项通过。

[构建记录](package-463155a0f.log) · [组件 SHA-256](package-463155a0f-sha256.txt) · [修复前回归](a14-goal-clear-race-red.log) · [受影响软件回归](a14-goal-clear-race-final.log) · [类型检查](a14-goal-clear-race-typecheck-final.log)。

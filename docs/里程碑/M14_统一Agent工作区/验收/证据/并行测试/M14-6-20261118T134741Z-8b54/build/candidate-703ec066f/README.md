# 候选 703ec066f 构建和业务桥回归

2026-11-19，WillYou 0.1.5 隔离候选，macOS arm64。冻结源码 `703ec066f36e10ffb490b19f818b385641de19ad`，ASAR `cb65cbeb53d8145a8dd80972ecb76ec3a09425ad0926808bdb61cdaa7c2b078b`。

D06-50 将当前运行的启动停止检查接入原业务桥授权。运行打开后，该启动检查不影响普通的回合停止。Agent 与任务渲染端 381 项通过，7 项按环境跳过。原业务桥、运行登记和会话诊断 111 项通过，类型检查通过。包内 SQLite、PTY、语音桥、文件代理、Office 渲染和文件监听六项通过。

[构建日志](package-703ec066f.log) · [组件 SHA-256](package-703ec066f-sha256.txt) · [修复前测试](a04-attach-software-red.log) · [Agent 和渲染回归](a04-attach-software-green.log) · [业务桥回归](a04-attach-bridge-regressions.log) · [类型检查](a04-attach-typecheck.log)。

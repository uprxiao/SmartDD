# M14-D06-62 实包复验

2026-11-19，macOS arm64，修复候选 9a6e95cdc。两条反例均在新包上完成实包复验，缺陷关闭。用本机合成服务触发实际原生执行器与审批。包与源码、原生核对见[构建证据](../../../build/candidate-9a6e95cdc/README.md)。

- **345 停止**。真实 Codex 命令正等待批准时点停止。原生收到实际中断，原审批退役，之后两次旧批准均被拒绝，未写入测试文件。同一个命令条目及原文修订和字节保持，界面显示“未收到工具结果”。此前已完成的 pwd 保留真实输出和退出码 0。App 正常退出并确认进程归还。[停止界面](attempt-345/02-original-request-retired-after-real-stop.png) · [结果](attempt-345/result.json) · [只读数据库与进程核对](attempt-345/verified-terminal-and-release.json)
- **346 驱动失败**。故障重启后数据库中的同一 AskUserQuestion 已正确收口，驱动把只等待条件的函数返回值误当界面结果。修复等待后另行读取同一控件，再独立复验。保留原失败与截图。[原结果](attempt-346/result.json) · [原失败画面](attempt-346/99-failure.png)
- **347 故障重启**。实际 Claude 提问、排队输入以及旧 owner 持久化后，让本次隔离 App 故障退出并用同一数据重启。原回合为接收未知，审批退役，同一问题工具显示“未收到工具结果”，正文哈希与修订一致。随后显式派发排队输入一次。重启后的 App 退出 0，SQLite 和原生进程身份核对完成。[重启界面](attempt-347/81-a27-crash-reopened-queue.png) · [结果](attempt-347/result.json) · [冷态复核](attempt-347/verified-terminal-and-release.json)

A60 整条仍需要终态组合的其他实包证据、默认模型与设置、短期限流及过期子结果。

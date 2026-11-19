# A59 工作与审批等待实包复验

2026-11-19，macOS 26.6.1 arm64。当前签名候选 `1b1680eeab910d29a5e86dbe73698f27c93b4bdf`，`app.asar` SHA-256 `46ec40fcc1743fc83ee689c608ab4ea1e100cfd24bf2bfce483065f27a22e025`。真实本机 Codex、真实隔离 App 后台 CDP、本机合成模型响应。

190 使用与 189 同一驱动。真实审批保持 4,611ms 后从产品面板拒绝，实际原生回合完成、测试命令没有写入。回合共 4,661ms，前台工作 50ms，界面显示“已工作 0 秒”和“等待用户处理 5 秒”。用不可变数据库只读核对同一回合的请求起止与拒绝身份，App PID 94881 和原生 PID 95032 都已退出，App 退出码 0。

[实际结果及原生身份](attempt-190/result.json) · [开始等待](attempt-190/01-native-command-wait-opening.png) · [同一请求仍待处理](attempt-190/02-same-native-request-after-hold.png) · [实际耗时分列](attempt-190/03-same-completed-turn-timing.png)。

D06-54 已关闭。审批重叠区间归并、原生子等待／宿主业务过滤和历史页保留由对应 U／I 覆盖。另有已通过的旧版 App 无请求工作场景作基础对照。 [旧包 189 与红绿回归](../../684a0b6a1/A59-work-timing/README.md) · [新包哈希](../../../build/candidate-1b1680eea/package-1b1680eea-sha256.txt)

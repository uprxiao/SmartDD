# M14-A27 打包复验 085

macOS arm64，候选 `b82556cbc74646ec7ab2dfe9defc70a4e305ebac`，ASAR `898f908c7b2340262358d2adab2f1ade01eb14da46c796352bc668d7a59792fd`。真实 Claude 2.1.326 用私有回环模型驱动，私有合成插件无连接和凭据，只写本轮隔离目录。

- A27 的通用业务判据实际覆盖。待批准时无效果。真实点击批准后，原 host 请求为 pending/executing，调用账 running/unknown，工作进程执行一次文件及目录 fsync，原业务回执未返。同一原运行的 Claude 和 MCP 桥经 PID、出生戳及 kernel peer 证据核实。然后只对原隔离 App 37340 施加预期 SIGKILL。
- 同数据重启后，旧 Claude 37489、MCP 桥 37535、插件进程 37623 均已核停，旧输入为 unknown/HOST_RESTARTED，原操作显示结果未知、不自动重放，旧批准被拒。3.544 秒内原真人排队不派发。真实点击立即发送后，同一个历史 turnId 在新 run 获得一条原生回复并完成，原效果和调用次数一直是一次且摘要不变。新 App 37648 正常退出 0，无渲染错误，测试监听已释放。
- 额外真实缺陷。应用活动详情仍为 `state=running, effectState=unknown, attemptCount=1`，页面的对应状态文案为「调用未结束 · 待核对」。重启后新回合完成并正常退出，最终已 checkpoint 的 SQLite 该调用仍是 `running/unknown`，`ended_at` 和 `error_code` 仍为空。旧 run、旧桥和实际插件进程早已关闭。本次覆盖并通过 A27 原流程及防重放断言，额外调用账缺陷应独立跟踪。

[原始结果](attempt-085/result.json) · [批准前截图](attempt-085/100-local-effect-waiting-approval.png) · [重启后截图](attempt-085/101-local-effect-unknown-after-restart.png) · [落盘效果](attempt-085/effect.json) · [最终台账只读结果](attempt-085/checkpointed-ledgers.json) · [校验清单](SHA256SUMS)

前次驱动错误完整保留在 [083](../A27-attempt083/README.md)。

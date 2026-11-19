# A70 相同 Codex 目标重开后恢复

2026-11-19，macOS arm64，隔离实包 `fc61d9dcd`，ASAR `3fe7e5cb995ffed2de34ec9fc393b6450e2feb414fee0e5c2ff44a85ba7a1427`，ad-hoc 签名和包内原生冒烟已验证。修复仅在同一绑定、目标正文与有限原生创建／更新时间完全吻合时保留待子任务暂停原因。用户 Stop 或不同原生版本继续由原守卫拒绝自动恢复。对照 [548 原反例](../../e66f5a85b/A70-codex-paused-goal-red/README.md)。

552 真实 Codex 父任务，真实 Git 合成仓库、真实 Claude 写入角色和 Codex 只读角色，模型响应由回环合成服务提供。父等待时写入型受目录写入槽控制，可信只读并行；同仓另一个 Codex 的活动目标、原运行与原回合无变化。同一原生 thread 收到两个结果通知且均正常完成，恢复意图和原生 RPC 确认目标真实 active，目标绑定及修订保持。先取证才停止持续目标并清理，App 正常退出 0，无渲染错误或端口残留。该组只证明 A／I 层。[等待](01-waiting-goal-after-own-drain.png) · [恢复](03-goal-and-current-native-child-results.png)

受影响回归 404 项通过、7 项跳过，类型通过。[回归](a70-goal-regression.log) · [类型](a70-goal-typecheck.log) · [SHA256SUMS](SHA256SUMS)。D06-71 关闭，整条 A70 其余组合保留。

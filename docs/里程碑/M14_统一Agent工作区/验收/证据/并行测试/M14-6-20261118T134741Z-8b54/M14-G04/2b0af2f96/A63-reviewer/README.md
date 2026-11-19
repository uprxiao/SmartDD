# A63 请求批准覆盖 Codex 原生自动审核

2026-11-19，macOS 26.6.1 arm64，隔离签名候选 `2b0af2f9604db03d8e8062e72517f4a9fb68b92e`，`app.asar` SHA-256 `a755c7c5f6e6415d69037ceca630e29e9804d3fa98ddcfd917333b146201fea1`，Codex 0.169.0。

- A 层 197。批准与拒绝均由隔离 App 的实际面板操作，模型响应走本机回环。独立原生 `config/read` 在前后均确认隔离 TOML 顶层 `auto_review`，来源为这个私有文件。两个 Apps 中实际 `config/read` 显示生效 `user`，来自 sessionFlags。生效后没有改写隔离文件的 reviewer。原 App 真拒绝，正常退出；重启同数据后用真实 `thread/resume` 恢复同一原生线程，在新代次连续两轮分别真批准和真拒绝。三次 `turn/start` 与 `thread/start`／`thread/resume` 都显式带 `approvalsReviewer: user`。批准创建唯一合成文件，两次拒绝均无文件。两 App 和对应原生与桥进程均结束，两 App 退出码为 0。 [原生时序、操作和账本](attempt-197/result.json) · [首轮拒绝](attempt-197/A63_INITIAL_DENIED-request.png) · [恢复后批准](attempt-197/A63_RESUMED_APPROVED-request.png) · [恢复后拒绝](attempt-197/A63_RESUMED_DENIED-request.png)
- R 层复用同版本独立研究。V08 实际留存的正、负对照中，不覆盖原始 reviewer 时没有客户端请求，实际文件已写；请求交宿主时，批准创建文件、拒绝不创建。V09 的实际订阅模型在新进程恢复同一原生会话，重做逐轮覆盖的拒绝和批准。R 证据对应原生能力，197 则直接证明本候选的产品路径。 [V08 原始回执](../../../../../../../技研/实验/20261116_复核修订验证/fixtures/approval-evidence.json) · [V09 实验](../../../../../../../技研/复核_20261116/二次复核.md#3-本次补充的真实验证-v09)
- U／I 阶段 1 和后续驱动回归覆盖显式线程参数、逐轮参数和恢复策略。 [阶段 1 记录](../../../../../阶段1_底座_20261117/README.md) · [受影响回归](../../../M14-G03/1b1680eea/A59-late-delta/a59-late-delta-regression.log)
- 195 先通过真正的首轮拒绝。驱动用整文件哈希作额外断言，原生追加隔离项目的信任元数据后提前结束；reviewer 语义未变。 [失败和原生独立检查](../../1b1680eea/A63-reviewer/README.md)

[独立核对原生方向、文件结果与进程退出](attempt-197/verified-197.json)。

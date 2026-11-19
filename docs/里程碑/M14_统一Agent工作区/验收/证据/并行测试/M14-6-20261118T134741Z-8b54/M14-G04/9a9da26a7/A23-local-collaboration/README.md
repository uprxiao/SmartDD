# A23 实际协作 Skill 及委派

2026-11-19，macOS arm64，隔离包 `9a9da26a7`。真实 App、Codex 与本机 Qwen3-Coder 30B，只用合成测试数据。

571 的模型实际按选中的 Skill 运行相对脚本，调用 `wy_targets` 后用有效修订提交 `wy_delegate`，真实委派已持久化且进入队列。驱动在读取真实成功回执前就读取了 SQLite，把早一时刻零行配给晚一时刻的成功回执，误判并取消了已排队的任务。保留原失败以及当时的实际队列。[原界面](571-observed-queued-child.png) · [同 ID 的只读对照](571-original-race-proof.json)

V2 只修改取样顺序，以原 SQLite 帧和原生回执执行新旧检查，仍要求单次委派、真实子任务及唯一结果。复验结果待归档。 [SHA256SUMS](SHA256SUMS)

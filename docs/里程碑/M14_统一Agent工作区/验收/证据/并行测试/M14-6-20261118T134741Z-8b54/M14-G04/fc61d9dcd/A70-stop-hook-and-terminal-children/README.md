# A70 原生 Stop、长等待和子任务终态

2026-11-19，macOS arm64，隔离包 `fc61d9dcd`，ASAR `3fe7e5cb995ffed2de34ec9fc393b6450e2feb414fee0e5c2ff44a85ba7a1427`。App、Claude、Codex、Git／SVN 为实物，模型回复为本机合成数据。

- 562、563 分别为 Claude SVN、Git。宿主向准确原生 Stop 返回 `continue:false`，写入型子任务取得目录槽，父收到两个结果并完成通知。旧探针没解析包内 SDK 的 `--resume=<UUID>`，两轮 runner 保留未通过。真实原生 `system/init`／结果都报原会话 ID，原 JSONL 和唯一 SQLite 绑定一致，已独立复核。[身份核对](562-563-verdict.json)
- 564 从真实请求创建起等待 61,070 毫秒，同一个请求仍在面板，后实际批准。父任务两个通知都完成，原目标恢复。退出阶段仍出现上述探针误判。原组记录保留失败。[待处理请求](564-approval-after-61s.png) · [独立冷态核对](564-verdict.json)
- 565 原生写入子任务被取消，566 写入子任务真实失败。两边均将结果送到原 Codex 目标并恢复。正式脚本通过。[取消](565-goal.png) · [失败](566-goal.png)

全部 App 退出 0，回环释放，相关原生进程已退出。A70 仍缺目标暂停后宿主冷启动专项及真实模型端到端，不计整条通过。原脚本与结果见 [SHA256SUMS](SHA256SUMS)。

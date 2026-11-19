# M14-A27 和 D06-42 实包复验 087

macOS arm64。候选 `2521f1b41e07dcde0d28331f0e04fda127d80feb`，ASAR `ded471b0d9bb9ea4ea2fc7601b9d86c8bf6bda8f03571e091eb5a46f0830a55d`。仍使用真实本机 Claude 2.1.326、回环合成模型和无连接插件。原 [083 驱动失败](../../b82556cbc/A27-attempt083/README.md) 和 [085 实包缺陷](../../b82556cbc/A27-attempt085/README.md) 独立保留。

| 判据 | 观察 |
|---|---|
| 原业务确实在效果边界内 | 真实点击审批前无效果。审批后，原 agent 请求 pending/executing，原调用 `running/unknown`，工作进程完成文件和目录 fsync，尚未返回。仅同一原隔离宿主 63474 获得预期 SIGKILL。 |
| 原宿主及桥退出 | 重启使用同一隔离数据。宿主 63474、Claude 63617、MCP 桥 63650、插件工作进程 63790 均按各自 PID 和出生戳核停，登记的旧运行已停止、插件租约关闭。 |
| 真实活动及两次数据库读一致 | 原操作 `d960d586-0711-4ece-a1d7-ad62957b6183` 保留原 runId，以 `state=unknown, effectState=unknown, errorCode=HOST_INTERRUPTED, endedAt=2026-11-18T21:42:57.425Z, attemptCount=1` 收口。Activity API、在线 SQLite 和正常退出后的 checkpointed SQLite 一致。 |
| 队列和不重放 | 任务时间线显示结果未知且不会自动重放，旧批准被拒。观察 3.504 秒，原真人排队消息未自动发出。真实点击后同一 turnId 在新 run 完成，私有效果与尝试账 SHA-256 完全一致，实际写入仍只有 1 次。 |
| 测试资源正常收尾 | 重启 App 63819 正常退出 0，前后渲染错误均为 0，3425 无监听且包无持有进程。 |

[原始结果](attempt-087/result.json) · [批准前截图](attempt-087/100-local-effect-waiting-approval.png) · [重启后截图](attempt-087/101-local-effect-unknown-after-restart.png) · [最终数据库核对](attempt-087/checkpointed-ledgers.json) · [证据 SHA-256](SHA256SUMS)

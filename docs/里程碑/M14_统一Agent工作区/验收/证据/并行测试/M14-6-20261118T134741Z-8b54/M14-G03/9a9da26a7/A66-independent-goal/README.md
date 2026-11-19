# A66 同仓独立 Codex 目标与工作副本并发复验

2026-11-19，macOS arm64，隔离包 `9a9da26a7`，ASAR `3f8d39d0458accff2138e7e9a2c0309c8d47f1fb51437daf4f32dfe38857d357`。本机合成提供商，真实 App、Claude、Codex 与 Git。

530 在原生 Codex 目标持续运行时，另一 Claude 父任务建立并启动独立工作副本子任务。原目标、运行身份和原生回合不被工作副本影响。登记普通输入，随后真实插话得到原回合确认。模型请求实际看见插话后，原生 `update_goal` 完成原目标，队列输入仍在同一原生会话继续下一轮，且此时工作副本子任务还被测试门闩保留。[原回合插话](01-original-goal-and-real-steer.png) · [新输入先完成](02-new-input-delivered-before-child-release.png)

释放门闩后，真实子工作副本只生成一次宿主提交，父收到一次结果。原主工作目录都未改写，App 退出 0、回环释放。[实际父任务结果](02-a-real-parent-result.png)

529 的原始夹具在尚未看到原生插话时就响应了 `update_goal`，误读重发请求为工具回执。530 针对相同真实原生输入形态改进夹具，旧证据保留。[529 历史反例](../../fc61d9dcd/A66-independent-goal/README.md) 该分支通过，完全访问与其余要求的真实档位矩阵仍待验。正式 A66 未计通过。[SHA256SUMS](SHA256SUMS)

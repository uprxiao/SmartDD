# A23 实包并发槽

2026-11-19，macOS arm64，隔离包 `9a9da26a7`，ASAR `3f8d39d0458accff2138e7e9a2c0309c8d47f1fb51437daf4f32dfe38857d357`。真实 Codex 及五个可信只读子任务，本机合成模型提供商。

569 从真实 MCP 发起五个合法委派。前四个同时运行时，第五个持久为排队且没有 native run。放开一个后，同 ID 的第五个任务才启动。五个任务最终各运行一次、各交付一次结果，App 正常退出。[四运行一等待](01-actual-capacity-queued.png) · [放行后收口](02-fifth-started-after-release-and-settled.png)

实测达到并发上限时拒绝立即启动，委派本身已经受理。正式用例“超限由宿主拒绝”的数量口径仍需与 R07 的并发限制确认。[用例口径对照](../A23-skill-host-boundaries/README.md) A23 仍保持未执行（部分判据完成）。[SHA256SUMS](SHA256SUMS)

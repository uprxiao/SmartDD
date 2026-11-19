# A08 双执行器真实模型、资源更新与删除

2026-11-19，macOS arm64，隔离包 `9a9da26a785ef3b4bb35ad1d757bfb0cdbcad030`，ASAR `3f8d39d0458accff2138e7e9a2c0309c8d47f1fb51437daf4f32dfe38857d357`。签名、SQLite／PTY 等包内原生检查通过。App、Claude 2.1.326、Codex 0.169.0 为实物，Ollama 0.40.15 加载已缓存的 Qwen3-Coder 30B，云关闭。Responses 回环转发只过滤此场无关且 Ollama 不支持的 freeform `apply_patch` 声明，真实原生 `exec_command` 审批与结果均保留。没有外部 API 或订阅凭据。

| 执行器 | 实际从 `$` 选择并执行相对脚本 | 再开原生任务确认原件删除 |
| --- | --- | --- |
| Codex 433 | [原版](433-codex-0-result.png) · [修改版](433-codex-1-result.png) | [目录与实际选择器](433-codex-removed.png) |
| Claude 434 | [原版](434-claude-0-result.png) · [修改版](434-claude-1-result.png) | [目录与实际选择器](434-claude-removed.png) |

各轮工具记录、返回模型的工具结果及用户可见回答核对同一标记。两端数据库目录均不再公布删除项。除夹具明确更新、删除外，来源两文件 SHA-256 始终保持。两次 App 和本机模型均退出 0，渲染端无错误。D06-73 的旧包启动反例与失败原因保留。[旧包复现和 609 项相关回归](../../fc61d9dcd/A08-real-local-update-and-removal/README.md)

435 用合成模型回应补查两个真实执行器的六个运行。删除时原投影链接依然存在，未重新扫描纳管列表。两端都保留同时纳管的另一个 Skill，新原生运行均正常。[Claude 选择器](435-removed-claude-picker.png) · [Codex 选择器](435-removed-codex-picker.png) · [补充 A 层](435-result.json.gz)

旧运行的冻结插件目录不随更新／卸载改写，沿用同一能力交付机制的打包证据。新运行按当前启用状态重新发现。 [A40 冻结版本、卸载与停用](../../../M14-G04/1214412aa/A40-lifecycle/README.md)

正式 A08 通过（U／I／A／R）。驱动、结构化回执及截图见 [SHA256SUMS](SHA256SUMS)。

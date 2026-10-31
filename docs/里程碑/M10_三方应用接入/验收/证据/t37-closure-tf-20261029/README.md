# TF 证据入口

T37原四步分层通过；正式53/72、剩余19、73.61%。本批仅新增T37，M10仍验收中。

- [最终当前实包8项](final-native-green/result.json)、[当前P9项](final-prototype-green/result.json)、[原四步映射](original-step-mapping.json)。
- [软件113产品＋49P模型＝162](software-receipt.json)、[两份P模型stdout](prototype-reference-model.log)、[独立核验及原72账](independent-audit.json)。产品stdout计数来自回执内工具会话；不是单独保存的完整stdout文件。额外不存在的执行上下文测试过滤器不计作执行文件。
- [旧Mail/新PTY原件及来源范围核对](mail-and-scope-evidence-reuse.json)、[上下文差异](context-diff.patch)。旧Mail实包是沿用证据，当前P邮件是明确合成演示；均非本轮新真实回复创建。
- [当前1513选定源](current-source-baseline.json)、[恢复链](source-recovery.json)、[19包pin](reused-package-pins.json)。1512既有源保持，新源仅外部引用驱动；不冒充完整依赖图。
- 所有驱动失败按目录保留。尤其[早期PTY观察失败](pty-observer-failure/result.json)及[原App恢复结果](pty-observer-failure/startup-recovery.json)：原run已撤销且登记CLI退出，但armed无PID桥／1份recovery-required租约仍保留，未手清、不称成功清理，不与历史T53 NK根混同。最终绿根的正常停止不能倒推该失败根。
- [完整所选原件哈希](manifest.json)。原始SQLite、HOME、native历史、随机token、密文输入及完整argv未归档。26登记PID已独立核对退出；空PID不代表未知桥退出。

[结论与边界](../../TF_T37原四步终端引用与目标隔离整例收口_20261029.md)。

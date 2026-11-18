# M14 P0.22 原型增量

2026-11-18 用户确认 OpenCode（含 ACP）移出 M14。以下截图为隔离 Chrome 中的共享原型，使用 1440 × 900 视口与合成数据。

| 场景 | 浅色 | 深色 |
| --- | --- | --- |
| 首页智能体选择器 | [浅色](light-picker-home.png) | [深色](dark-picker-home.png) |
| 任务页智能体选择器 | [浅色](light-picker-task.png) | [深色](dark-picker-task.png) |
| Git 共用目录协作 `team` | [浅色](light-team.png) | [深色](dark-team.png) |
| 目标等待子任务 `goal-wait` | [浅色](light-goal-wait.png) | [深色](dark-goal-wait.png) |

CDP 对首页和任务页分别验证“后续接入”被禁用、点击后不切换模型列表、现有模型仍可选。另核对 5 个复用子任务的场景在两种主题下都显示 Codex·订阅，并检查 `team`、`goal-wait` 的用户消息。14 项场景与主题检查通过，页面错误 0。见 [CDP 结果](cdp-result.json)。

[源码覆盖包](source-snapshot.tar.gz)与[校验清单](manifest.json)可用于复现。以清单的 Git 提交为基线，覆盖包内三个共享原型文件。

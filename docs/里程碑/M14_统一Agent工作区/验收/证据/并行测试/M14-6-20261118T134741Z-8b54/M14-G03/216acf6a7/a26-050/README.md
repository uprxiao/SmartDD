# A26 第 050 次初始档位组合实包验证

2026-11-19，macOS arm64，候选源码 `216acf6a7bf486f9031a836dea957f94ccf7d76b`，ASAR SHA-256 `5f088304047e4db029346b69b594d226a98082a690916de7d6bd1c26733d3821`。每个 Codex 父任务从真实 UI 下拉选档，提供可信事件。通过真实 MCP 各委派两个只返回合成文本的本机子任务。四个委派是真实独立收据，四个子原生回合全部完成，子任务选档控件均禁用且 Tab 不可选中。各工作副本不使用外部依赖，验证 Git 内容、状态和 HEAD 无修改。

| 父档位 | 执行器 | 结果和原生证据 | 界面 |
|---|---|---|---|
| 帮我批准 | Codex | 继承帮我批准，原生 `on-request / workspace-write / auto_review` | [截图](attempt-050/matrix-auto-codex.png) |
| 帮我批准 | Claude | 继承请求批准，原生 `permissionMode=default`，实际展示“帮我批准不适用于该执行器，已按请求批准运行” | [截图](attempt-050/matrix-auto-claude.png) |
| 完全访问 | Codex | 继承完全访问，原生 `never / danger-full-access / user` | [截图](attempt-050/matrix-full-codex.png) |
| 完全访问 | Claude | 继承完全访问，原生 `permissionMode=bypassPermissions` | [截图](attempt-050/matrix-full-claude.png) |

Codex 通过每个实际 turn ID 匹配原生 `turn_context`，Claude 通过实际 turn ID 中的会话 ID 匹配原生 JSONL 的 `permissionMode`。摘要核对真实项目数据库四条子任务回合全部完成。模型仅回环，不使用日常数据、账号、外部服务。App PID 31752 正常退出 0，无渲染错误和测试后补停任务，3425 及本包进程核空。

该批与 [049 当前与下一轮权限证据](../a26-049/README.md) 共同覆盖 A26 权限。四类请求并存、取消其中一个后继续回答另一条和拒绝旧应答仍未执行。

[实包结果](attempt-050/result.json) · [原生权限摘要](attempt-050/native-verified-summary.json) · [SHA-256](SHA256SUMS)

# A07／A54 订阅路径实包验收（2026-11-20）

- 执行：Claude Code，后台 CDP，未占用系统前台。
- 包：隔离包 `15a8ea3ff`（app.asar `006dd741a95a1b901245bea68a816dd2545ae31d81d4a92dd2dc777485649efe`），macOS 26.6.1 arm64，feature/0.1.6。
- 执行器：真实订阅 Claude Code（显式路径 2.1.326／自动发现 `~/.local/bin/claude` → 2.1.329），真实订阅 Codex 0.169.0；托管 Claude 使用本机合成 Messages 服务。
- 登录：用户本人在隔离测试 HOME 内用 `/login` 登录，凭据只进该 HOME 的测试钥匙串（`willyou-test.keychain-db`）和 `.codex/auth.json`；用户真实 `~/.claude`、`~/.codex` 文件指纹登录前后一致，用户默认钥匙串不变。提示词只发合成内容。
- 合成个人扩展：Claude `settings.json`（SessionStart hook 写标记，`permissions.defaultMode: bypassPermissions`）、`.claude.json` 的 stdio MCP `a07user`、个人 Skill `a07-user-skill`；Codex `config.toml` 的 `[mcp_servers.a07user]` 与 `~/.agents/skills` Skill。

## 第 588 次结果：13/13 通过

| 判据 | 实际 |
| --- | --- |
| 订阅 Claude 沿用开：加载个人 hook 与 MCP | hook 0→1，MCP 0→1 |
| 订阅 Claude 沿用开：使用个人 Skill | 调用 Skill 1 次，回答 `A07_USER_SKILL_OK` |
| 请求批准档的 Bash 不被用户默认 bypassPermissions 覆盖 | 弹出 command_approval；界面拒绝后文件未创建 |
| 首页关闭“沿用我的扩展”后新任务仍为关闭 | 首页开关 false，新任务 selection false |
| 关闭时不加载个人 hook／MCP／Skill | 计数不变；模型回答找不到该 Skill |
| 任务之间不串 | 先前任务仍为开启 |
| 订阅 Codex：开启启动个人 MCP，关闭不启动 | 开 0→1（并答出 Skill 句）；关 计数不变 |
| 显式 Claude 路径 2.1.326 跑订阅会话 | 回答 `A54_EXPLICIT_OK` |
| 修改个人 Skill 后新会话采用新内容 | 回答 `A54_CHANGED_OK`（此时走自动发现 2.1.329） |
| 托管 Claude 不加载个人 hook／MCP | 计数不变 |
| 重启后恢复原任务：同一原生会话与原设置 | 原生会话 `ba03c1e8…` 前后相同，回答 `A54_RESUMED_OK`，沿用仍为开启 |
| WillYou 未改写个人配置 | settings、两份 Skill、Codex config 与 Claude MCP 列表哈希与本测试自身修改后一致 |

- 路径来源离线补核：[driver-probes.json](attempt-588/driver-probes.json) 显示显式阶段 `claude-sdk` 为 `versions/2.1.326`，恢复自动发现后为 `~/.local/bin/claude` → `versions/2.1.329`；Codex 为自动发现 `~/.local/bin/codex`。托管＋显式组合沿用 [第 578 次私有 HOME 复验](../../../M14-G04/bcc6e9a77/A07-managed-private-home/README.md)（显式 2.1.326）；Codex 显式路径保存识别见 A55 第 068 次。
- 截图：[沿用开](attempt-588/10-claude-carry-on.png)、[首页开关关闭](attempt-588/20-home-toggle-off.png)。

## 失败与驱动修正（保留）

- 581：harness 只允许本 attempt 下的 HOME 使用启动前钩子 → 改为把登录过的测试 HOME 复制进 attempt。
- 582／583／586：复制后钥匙串断言路径写错、复制件锁定弹出钥匙串密码框（用户取消后测试 App 按失败收尾）→ 驱动先用测试密码解锁复制件。
- 584：原 `login.keychain-db` 不接受测试密码（被系统按登录钥匙串处理）→ 改建 `willyou-test.keychain-db`，用户重新登录 Claude 一次。
- 585：Claude 按配置目录路径区分钥匙串凭据，复制后的配置目录识别为未登录 → `CLAUDE_CONFIG_DIR` 保持在登录位置。
- 587：[订阅 5 小时额度用尽](attempt-587/result.json)，权限一步模型未响应（环境阻塞，非产品缺陷）；前两项虽绿但 Skill 判据过宽。588 改为 Skill 必须答出指定句，并在出现额度提示时立即按环境阻塞停止。
- 驱动：[driver/](driver/)。

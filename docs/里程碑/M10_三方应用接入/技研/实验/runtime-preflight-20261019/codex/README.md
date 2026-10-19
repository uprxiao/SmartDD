# Codex 开发前真实机制探针（2026-10-19）

范围：M10 A19 第一阶段、macOS arm64、当前安装的 `codex-cli 0.162.1`。只验证合成 Skill／MCP 与原生会话机制，不属于 M10 正式业务开发或打包应用验收。

## 结论与证据层级

| 问题 | 观察结果 | 证据 |
| --- | --- | --- |
| `skills.config.path` 应填文件还是目录 | **当前二进制实测须填完整 `SKILL.md` 文件路径。** 填目录不会报错，但要关闭的 v2 仍显示 `enabled=true` | `result.json` 的 file-path／directory-path 用例 |
| 两个进程能否选择不同版本 | 同一隔离 HOME、同一隔离 CODEX_HOME、同一项目下，两个同时存活的 app-server 分别选择 v1／v2，另一版本为 false | `result.json` 的两个 concurrent 用例 |
| 未启用应用的其他项目 | 项目 B 的两个受管版本均为 false；合成的用户自有 Skill 仍为 true | `result.json` 的 project-b 用例 |
| 直接 MCP 执行 | 两个真实 app-server 新建原生 thread，分别调用本地 MCP 标记工具并取得正确项目／版本 | `result.json` 的 direct-mcp 用例；**此层不代表模型读取或调用** |
| 模型是否读到了正文 | 真实 `gpt-6.1-sol` turn 分别返回 Skill 正文中的 `M10_SKILL_BODY_v1`／`…_v2`。由 `turn/start` 的显式 Skill 输入提供路径，非自动意图触发实验 | `real-attempt-04-v1-resume-passed.json`、最终 `real-model-result.json` |
| 模型是否真正调用工具 | 保留 `approvalPolicy=never`；工具准确声明只读／无破坏／幂等／非开放世界后，真实 turn 产生 `mcpToolCall completed` 并返回 `M10_TOOL_v1` | 同上 |
| 两版本同时存活时的真实模型调用 | v1 进程仍存活时，第二个进程新建 v2 会话，模型返回 v2 正文标记并完成 v2 MCP 调用。两个版本在首个启动前均已准备 | `real-model-result.json` 的 new-conversation-v2 用例 |
| 原生 resume | 已发生 turn 的原生 thread，关闭 app-server 后用同一 threadId 恢复，仍返回 v1 正文标记并完成新的 v1 工具调用 | 同上 |
| 空 thread 是否可恢复 | 只执行 `thread/start` 与直接 MCP RPC、没有 turn 时，恢复返回 `no rollout found`；不能用这种空 thread 验证历史会话恢复 | `result.json` 的 resume 用例 |

`result.json` 总状态保留 `has-failures`，因为目录路径备选确实失败，空 thread 恢复也受阻；不能为取得绿色状态删除负面结果。正确文件路径方案的发现测试、直接 MCP 测试单独标为通过。最终真实模型测试 `real-model-result.json` 于 2026-10-19 07:33–07:34 UTC 执行，四个判定项（新建 v1、新建 v2、原生同 ID resume、恢复后 v1 模型调用）均通过，状态为 `passed-with-boundaries`。不能用直接 RPC 替代真实模型结果。

本实验通过输出正文标记确认模型获得并使用了对应正文，不是文件系统 I/O 跟踪；恢复会话本身已带有 v1 历史，不能仅凭重复的正文标记证明每轮重新打开了同一个文件。恢复后新产生的 MCP 调用事件与返回值提供了独立工具执行证据。

## 真实路径与运行方式

实验每次创建并最终删除独立 `/private/tmp/m10-codex-…/`。该目录里的 `home/.agents/skills/willyou-fixture-v1/SKILL.md`、`…-v2/SKILL.md` 模拟同一个用户发现根；`codex/` 是隔离的原生 CODEX_HOME；`project/` 或 `project-a/`、`project-b/` 是不同工作目录。

两个版本在首个进程启动前都已经存在，测试期间未替换正文。每次启动的受管配置类似：

```toml
skills.config = [
  { path = "<fixture>/home/.agents/skills/willyou-fixture-v1/SKILL.md", enabled = true },
  { path = "<fixture>/home/.agents/skills/willyou-fixture-v2/SKILL.md", enabled = false },
]
```

真实模型实验明确关闭 `apps`、`remote_plugin`、`multi_agent`、`shell_tool` 和 `shell_snapshot`，关闭 web search，仅配置一个返回合成标记的本地 stdio MCP。使用 `read-only` sandbox 和 `approvalPolicy=never`。每个模型 turn 外层最多 45 秒，超时发送 interrupt 并结束子进程。内置 provider 不允许覆盖重试配置，因此不能声称 CLI 内部完全不重试；总时限由探针控制。

原认证文件只读。仅把现有认证的临时副本放在隔离 CODEX_HOME，权限 `0600`，移除 refresh token，既不复制用户 config／聊天，也不写回原认证。最终核对原文件内容哈希相同；所有临时认证与实验目录在 `finally` 删除。证据只记录核对结果，不保存令牌或真实账户数据。

运行入口（真实模型命令会使用现有账号完成至多三个合成 turn）：

```sh
node docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/codex/probe.mjs
node docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/codex/real-model-probe.mjs
```

真实模型运行先在受限网络下观察失败，再经工具权限批准以同一合成范围运行。权限批准不意味着所有网络／真实业务用例通过。

## 失败尝试与设计影响

1. `attempt-01-concurrent-cold-start.json`：两个进程同时初始化全新的隔离 CODEX_HOME，其中一个报告 SQLite 状态初始化失败。先完成一次初始化，再同时存活运行通过。此处只保留一次冷启动失败的观察，尚未多轮独立复验，不能泛化为全部多进程启动失败。开发应处理首次初始化串行化／失败重试，不直接共享一棵正在初始化的目录。
2. `attempt-02-file-directory-discovery.json`：文件／目录路径差异及无 turn 的 resume 失败。生产适配器必须按被验证的 CLI 版本输出 `SKILL.md` 完整路径，不能仅凭文档文字改成目录；不能从参数被接受推断筛选有效。
3. `real-attempt-01-config-rejected.json`：试图用 `model_providers.openai.*` 修改内置 provider 重试配置被 CLI 拒绝。改为保留内置配置、外层总时限。
4. `real-attempt-02-network-failed.json`：受限网络报 `workspace routing discovery failed`。turn 已落入原生历史，因此 resume 同 ID 成功，但模型未读取 Skill、未调用 MCP。
5. `real-attempt-03-tool-approval-required.json`：联网后模型正确读取正文并尝试工具，但未声明只读属性的工具在 never 审批策略下被拒绝。**直接 MCP RPC 成功不等于模型路径下成功。**
6. `real-attempt-04-v1-resume-passed.json`：合成工具增加准确只读注解，保留原审批策略，新建与 resume 两个真实 turn 都通过。注解只描述工具语义，不能替代 WillYou 后端的项目／连接／权限校验。

## 尚未证明的事项

- 真实用户 HOME／CODEX_HOME 中现有配置、profile、全部用户 Skill／MCP 的合并与冲突处理；本次只验证隔离根中的合成用户 Skill 不被全量禁用。
- 各 Agent 间同时运行及 Claude Code 等程序额外发现同一个全局目录时的边界。
- 终端 TUI 交互、打包 WillYou 启动链和内置运行时路径；本次使用真实 CLI 的 app-server 协议。
- 无显式 Skill 输入时模型能否自动挑选正确 Skill。本次显式给定 Skill 名称与路径，验证其正文进入并被模型使用。
- 原生历史中完整业务对话、长上下文压缩及未知版本恢复；本次仅三个合成短 turn。
- 真正应用包安装／升级、引用表与 GC、真实项目切换授权、数据库迁移、SMTP、禅道与 Foxmail。
- 其他 Codex 版本、其他系统／架构。`binary-evidence.json` 固定本次二进制与 schema 哈希，不能沿用为未来版本通过证明。

这些边界仍需后续专门验证和正式开发后的打包应用验收。本报告不能被概括成“Codex 全部适配完成”或“M10 验收通过”。

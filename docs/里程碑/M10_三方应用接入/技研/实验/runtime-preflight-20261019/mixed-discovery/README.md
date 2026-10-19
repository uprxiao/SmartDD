# CC／Codex 共享 HOME 与混合运行探针

2026-10-19，在 macOS arm64 使用 Codex `0.162.1`、Claude Code `2.1.303`。本目录新增独立实验，没有修改既有 Codex／Claude 探针、设计文档或生产代码。

## 1. 无模型的原生发现

脚本：[probe.mjs](probe.mjs)；结构化证据：[result.json](result.json)。13 个断言通过，状态为 `passed-with-boundaries`。

两个受管版本先准备，再依次启动、同时保持四个原生进程存活：

| 进程 | 应用 Skill | 用户 Skill | MCP |
| --- | --- | --- | --- |
| Codex／项目 A | v1 启用、v2 禁用 | 合成 `.agents/skills` 用户 Skill 保留 | 用户 MCP＋动态应用 MCP 均发现且返回工具元数据 |
| CC／项目 A | 显式 `--plugin-dir` 的 v2 | 合成 `.claude/skills` 用户 Skill 保留 | 用户 MCP＋动态应用 MCP 均 `connected` |
| Codex／项目 B | v1／v2 均禁用 | 用户 Skill 保留 | 仅用户 MCP |
| CC／项目 B | 不提供应用插件，因此没有应用 Skill | 用户 Skill 保留 | 仅用户 MCP，`connected` |

本次 CC 的原生 `initialize.commands` **没有发现同一合成 HOME 中 `.agents/skills` 的 Codex v1、v2 或共享用户 Skill**。原生用户 `.claude/skills` 与显式插件则正常出现。这是当前二进制、当前合成配置下的观察，不是“所有 CC 版本永远不会读 `.agents/skills`”的保证。

没有使用 `--setting-sources ''`、`--strict-mcp-config`、`--bare` 或 `--safe-mode`；最终脚本也未用 `--tools ''` 关闭全部内置工具。保留正常设置来源，只在合成配置中关闭 hooks。用户 settings／Codex config 文件哈希不变，CC 用户 MCP 定义不变。CLI 自己可更新合成 `.claude.json` 的其他本地状态，因此不把整个该状态文件宣称为逐字未变。

实验只发送初始化、发现、MCP 状态查询，无用户 turn、无模型调用。使用假 API key，模型地址与代理均指向本机不可用端口。MCP `pending` 后在有限次数状态查询内转为 `connected`，未通过真实模型执行这些用户工具。

## 2. 两个同时就绪的 Agent 各执行一个真实 turn

脚本：[real-mixed-probe.py](real-mixed-probe.py)；结构化证据：[real-mixed-result.json](real-mixed-result.json)。于 07:41:17–07:41:31 UTC 执行，仅一轮、两条用户 turn，两个判定项均通过。

- **CC v1**：显式会话插件；真实执行 `Skill → Read` 独立 nonce 文件 → 本地 `app_version` MCP，工具验证 `nonceMatch=true`、返回 v1。
- **Codex v2**：过滤关闭 v1，显式 Skill 输入提供 v2 路径；nonce 只在该 Skill 正文中。真实模型调用本地 `app_version` MCP，工具验证 `nonceMatch=true`、返回 v2。
- 两个进程在任一 turn 开始前均已初始化并同时存活；两条 turn 结束后仍同时存活。未重复 resume 实验。
- 两侧合成用户 Skill／MCP 在发现结果中保留，用户 MCP 未被调用。真实轮的 CC MCP 状态抓取于初始化早期，记录为 `pending`；其应用 MCP 随后实际调用成功。用户 MCP 的 `connected` 证据来自上面的独立无模型实验，不把这两层混为同一次调用证明。

Codex 使用 `gpt-6.1-sol`，保持只读 sandbox、`approvalPolicy=never`。只读现有认证，复制到临时目录时使用 `0600` 并移除 refresh token，结束核对原认证哈希未变。

CC 使用用户已授权的 `cdsh` 静态配置，模型为本轮配置的 `deepseek-flash`。只调用既有 Claude 探针的 `apply_cdsh()` 读取明确分支，没有执行 shell 函数；凭据只放子进程环境，不输出或归档配置值。CC 发出 `unrecognized_model` 警告，但本轮实际 `Skill`、`Read`、MCP 和成功结果均已取得。此结果证明的是 **Claude Code harness＋该兼容模型配置** 的路径，不等于 Anthropic 原生模型验证。

每条用户 turn 最长等待 75 秒；没有真实禅道、邮件或其他业务资源。临时 HOME、认证和日志最终全部删除，子进程全部退出。凭据、真实聊天和 `.zshrc` 内容均不在报告中。

## 路径及证据边界

两个实验都使用同一棵合成 HOME，并显式设置：

```text
HOME=<fixture>/home
CODEX_HOME=<fixture>/home/.codex
CLAUDE_CONFIG_DIR=<fixture>/home/.claude

Codex Skill：<fixture>/home/.agents/skills/<名称>/SKILL.md
Codex 用户 MCP：<fixture>/home/.codex/config.toml
CC 用户 Skill：<fixture>/home/.claude/skills/<名称>/SKILL.md
CC 用户 MCP：<fixture>/home/.claude/.claude.json
CC 应用 Skill：<fixture>/packages/<版本>/plugin/skills/<名称>/SKILL.md
```

CC 用户 MCP 路径是此次 **显式 `CLAUDE_CONFIG_DIR` 环境**下的实测路径，不能把它直接写成用户未设置该变量时的默认路径。虽然保留了正常 setting sources，本次仍隔离了原生状态目录；不能宣称真实用户根、profile、所有现有插件／MCP 冲突合并已验证。

这些结果支持所测版本中的“应用版本先准备、各适配器选择本会话版本、用户能力保留、混合进程可并存”机制。尚未覆盖 TUI、WillYou 打包启动链、自动 Skill 意图选择、全局 catalog 变化、运行中热安装、真实应用升级／GC、真实业务权限或其他 Agent／平台。

## 复现与失败记录

```sh
# 无模型、无真实凭据
node docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/mixed-discovery/probe.mjs

# 两条真实合成 turn，需要本次已授权的认证／cdsh 配置及网络
python3 -B docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/mixed-discovery/real-mixed-probe.py
```

- `attempt-01-response-envelope.json`：探针最初错误读取 CC SDK 响应包层级，控制响应已经到达却被记为 timeout；属于探针解析错误，不是 CC 发现失败。同轮项目 B 错误注入了受管 MCP，随后修正为未选应用不注入。
- `attempt-02-discovery-mcp-pending.json`：解析修正后已能看到 Skill 与 MCP 定义，但立即取状态只有 `pending`；最终版本通过有限状态查询确认连接。该轮保留了原始 SDK 初始化响应，最终 `result.json` 仅保留所需字段。

结果包含执行源文件哈希。真实模型成功不能覆盖上述负面记录，也不能替代后续正式开发后的打包业务验收。

# T-CFG／T-MODEL：Claude Code 配置载体、模型切换与恢复实验

日期：2026-11-10。依据：[需求 R0.3](../需求.md) T-CFG／T-MODEL。环境：macOS arm64，Claude Code `2.1.321`（`/Users/liubu/.local/bin/claude`），分支 `feature/0.1.4`。对照：[Codex 实验](T-CFG_T-MODEL_Codex实验_20261110.md)。

## 用户约束与保护措施

用户要求：订阅登录不纳入测试（订阅用户极少）；**不得使用其 Claude 订阅发送任何真实请求**（担心封号）。本轮全部运行：

1. 使用临时 `CLAUDE_CONFIG_DIR`（保留真实 `HOME`，避免钥匙串错误弹窗）；
2. 只以 `ANTHROPIC_AUTH_TOKEN` 传测试令牌或 Magpie 本机令牌，模拟服务器／守卫记录每个请求的鉴权头；
3. 代理指向失效端口，仅放行 127.0.0.1；`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`；
4. 真实请求只经 Magpie，且在 Claude Code 与 Magpie 之间加本机守卫，只放行 `deepseek/`、`ultrapwor/` 开头的模型；所有档位、后台小模型、子 Agent 均映射到 `deepseek/deepseek-flash`；开跑前核对 Magpie 列表无 `claude/*`（Claude Pro 由用户关闭）；`ultrapwor/claude-haiku-5-5` 保守起见不测；
5. 不读取任何凭据内容；前后核对 `~/.claude/settings.json`、`~/.claude/.credentials.json` SHA256 一致。

结果：所有经模拟服务器的请求均为测试令牌、无 OAuth 令牌形态；守卫拦截 0 次，所有 `/v1/messages` 均为 Magpie 本机令牌；`~/.claude` 两文件前后一致；无残留进程。

证据：[实验目录](实验/T-CFG_ClaudeCode_20261110/)（驱动、结果 JSON、`SHA256SUMS`；临时路径与测试令牌已替换）。

## 本机现状（只读）

订阅登录存于 macOS 钥匙串条目 “Claude Code-credentials”（只读取条目元数据，未读内容）；`~/.claude/settings.json` 含 `model: "opus"`，无 env。WillYou 现有 CC-work／CC-rj／CC-deepseek 为“默认配置目录＋环境变量注入”。

## 结果

| 编号 | 操作 | 实际结果 |
| --- | --- | --- |
| C2 | 临时 `CLAUDE_CONFIG_DIR` 下 `claude auth status`（断网） | `loggedIn:false`、`authMethod:none`，**认不到用户订阅** |
| C1a | 配置目录 `settings.json` 为 `model:"opus"`，仅注入 `ANTHROPIC_BASE_URL`＋`ANTHROPIC_AUTH_TOKEN` | 请求 `claude-opus-5-5` 发往模拟服务器（按配置目录默认档位），鉴权为测试令牌 |
| C1b | 另加 `ANTHROPIC_MODEL=model-a` | 请求 `model-a`（覆盖 settings 的 opus） |
| C1c | `--settings <文件>`（含 `model` 与 env `ANTHROPIC_BASE_URL`），令牌走环境变量 | 请求 `model-b`，baseURL 生效；settings 文件 env 可用 |
| C1d | `--model model-c` | 请求 `model-c` |
| C1 | 配置目录 `settings.json` | `-p` 模式下未被改写 |
| C3-启动 | TUI 首次启动 | `settings.json` 由 `opus` 改写为 `opus[1m]`（Claude Code 自带一次性迁移）；界面显示 “API Usage Billing” |
| C5 | 注入 `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` 与 `ANTHROPIC_CUSTOM_MODEL_OPTION`，打开 `/model` | 列出 Default、三档映射名、`custom-kimi` 一项自定义，另混有原生 Fable、Opus (1M)；提示 “Enter to set as default · s to use this session only” |
| C3-Enter | 选择 Sonnet 档后 Enter | **写入配置目录 `settings.json`：`model:"sonnet"`**，下一轮请求 `map-sonnet-y` |
| C3-s | 选择后按 s | 不写文件，下一轮请求 `map-sonnet-y` |
| C5-任意名 | `/model my-free-model` | 不写文件，下一轮请求 `my-free-model`；随后另有一条按默认档位 `map-opus-x` 的请求（用途未查） |
| C4 | 模拟：`--model model-c` 起会话 → `--resume` 不带模型 → `--resume --model model-d` → `--resume` 不带模型 | 依次 model-c、model-c、model-d、model-d；会话 jsonl 每条 assistant 记录 `message.model` |
| C6-工具 | 经守卫→Magpie，`-p --allowedTools Bash(ls…)`，6 个模型执行 ls | deepseek-flash、deepseek-v4-pro、ultrapwor/deepseek-v4-pro-0813、glm-5.3-flash、kimi-k2.5、glm-5 **全部实际执行 ls 并回复 FILES=3**（5–10 s） |
| C6-会话 | 同一会话 deepseek-flash 记 BLUE-42 → `--resume --model ultrapwor/kimi-k2.5` 加 1 → `--resume --model ultrapwor/glm-5.3-flash` 执行 ls | 依次 OK、BLUE-43、`BLUE-43 FILES=3`，跨供应商上下文延续 |
| C6-恢复 | 再 `--resume` 不带 `--model` | 回复 BLUE-43，但**使用默认档位映射的 deepseek-flash**，未沿用最后的 glm-5.3-flash；会话 jsonl 中三段 `message.model` 均正确记录 |

## 结论（Claude Code）

1. **第三方 Provider 必须使用独立 `CLAUDE_CONFIG_DIR`。** 独立目录下认不到订阅登录（C2），Key 缺失或失效时只会报错，不会退回订阅；默认目录下存在订阅登录，误配置时有用订阅发请求的风险。独立目录同时把 `/model` Enter 写入、`opus[1m]` 迁移等改写限制在 WillYou 管理的目录内，用户 `~/.claude` 不受影响。这与 Codex（默认目录＋按次 `-c`）不同，原因是两者登录与模型选择机制不同。
2. **注入方式：** 环境变量（`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`／三档映射）与 `--settings` 均有效，令牌只经进程环境传入，不写入 settings 文件。WillYou 现有环境变量机制可直接沿用，配置目录改为每个运行配置（或每个 Provider）一个 WillYou 管理的目录。
3. **模型列表：** Claude Code 没有 Codex 那样的完整目录注入；`/model` 只能显示三档映射＋1 个自定义项，且混有原生模型名。多模型 Provider（如 Magpie 15 个模型）在 Claude Code 里的呈现方式需设计：可用 `/model <名字>` 任意指定（C5 已证实可用），三档映射到常用模型；原生 Fable／Opus (1M) 选项在第三方 Provider 下会发出 Anthropic 原生模型名，经 Magpie 时可能被路由到 Claude 订阅，需在设计中规避（例如四档全部映射）。
4. **后台请求：** 存在按默认档位发出的附加请求（C5），因此所有档位（Opus／Sonnet／Haiku／Fable、small-fast、subagent）都必须映射到该 Provider 允许的模型，不能留空。
5. **T-MODEL：Claude Code 自行恢复的模型不稳定**（C4 沿用最后模型，C6 回到默认档位），但会话 jsonl 每条 assistant 消息可靠记录 `message.model`，`--resume --model` 每次生效。方案与 Codex 一致：WillYou 恢复时读取最后一条 assistant 的 `message.model`，显式以 `--model` 传入。
6. **能力同步影响：** 独立配置目录不会加载用户 `~/.claude` 中的 Skill、MCP、插件，会话也不在 `~/.claude/projects`（终端 `claude --resume` 看不到）。需由 M13-R03 能力统一管理负责把已纳管能力配置到这些目录；这使 R03 成为第三方 Provider 场景的前置。

## 未覆盖

订阅登录（用户决定不测）；DeepSeek 官方 `/anthropic` 端点（无 Key，未测）；`--settings` 中 `model` 与 `ANTHROPIC_MODEL` 同时存在时的优先级；C5 附加请求的具体用途；`ultrapwor/claude-haiku-5-5`；Claude Code 多版本差异。

## 更正（2026-11-10，技研审核 R02／R09／R11）

- 结论 1 “Key 缺失或失效时只会报错，不会退回订阅”超出证据：C2 只证明独立目录未识别订阅，C1／C6 均使用有效令牌。负例（缺 Key、401、冲突环境变量、残留配置）见补验 A3。
- 结论 5 中“会话 jsonl 可靠记录 `message.model`”为服务端报告值，是否可原样再请求、别名与前缀、后台／子 Agent 消息、失败轮次的处理见补验 A3。
- 归档主要为摘要；“C6 三段 message.model 均正确记录”的原始会话 jsonl 未入档，后续补验先保存原始输出再判定。

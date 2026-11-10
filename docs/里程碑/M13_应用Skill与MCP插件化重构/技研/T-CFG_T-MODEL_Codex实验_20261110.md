# T-CFG／T-MODEL：Codex 配置载体、订阅登录与模型恢复实验

日期：2026-11-10。依据：[需求 R0.3](../需求.md) 第二章第 3 节 T-CFG／T-MODEL。环境：macOS arm64，`codex-cli 0.166.0`（`/Users/liubu/.local/bin/codex`），分支 `feature/0.1.4`。本记录只覆盖 Codex；Claude Code 待用户空闲后另做（用户当前在用 Claude，要求先测 Codex）。

## 方法与边界

- 全部运行使用临时 `HOME`／`CODEX_HOME`／项目目录；API 路径用本机模拟 Responses 服务器（不访问外网，外部代理指向失效端口）。没有向真实模型发请求。
- 订阅登录只执行 `codex login status`；E2b 用指向日常 `~/.codex/auth.json` 的符号链接，事后核对原文件 SHA256 与 mtime 均未变化。未读取 auth.json 内容，只记录键名。
- TUI `/model` 用 PTY 真实按键驱动（`--no-alt-screen`，140×40）。
- 证据：[实验目录](实验/T-CFG_Codex_20261110/)（驱动、`exec-result.json`、`SHA256SUMS`）。测试 Key 为随机串，结果文件中已核对不含该值。

本机现状（只读）：日常 Codex 使用 ChatGPT 订阅登录，凭据存于 `~/.codex/auth.json` 文件（非钥匙串）；`config.toml` 另有 5 个指向本机 Magpie 网关的 `model_providers`。WillYou 现有 “Codex” 配置只指定可执行路径，使用默认 `CODEX_HOME`。

## 结果

| 编号 | 操作 | 实际结果 |
| --- | --- | --- |
| E1 | `exec -c model_provider="wy" -c model_providers.wy={base_url,wire_api="responses",env_key="WY_T_KEY"} -m model-a` | 请求到达模拟服务器，`model=model-a`，`Authorization` 为环境变量中的 Key；退出码 0；`config.toml` 哈希不变 |
| E3a | 同一会话 `exec resume`，不带 `-m` | 使用 `config.toml` 默认 `cfg-default`，并提示“会话记录为 model-a，正以 cfg-default 恢复” |
| E3b | `resume -m model-b` | 使用 model-b |
| E3c | 再次 `resume` 不带 `-m` | 又回到 `cfg-default`，**不沿用上次的 model-b** |
| E3 | rollout 文件 | `session_meta.model_provider=wy`；每轮 `turn_context.model` 依次为 model-a、cfg-default、model-b、cfg-default |
| E4 | `resume` 不再注入 Provider | 明确失败：“This chat uses model provider “wy”, which is no longer configured”，退出码 1，无请求 |
| E2a | 空 `CODEX_HOME` 下 `login status` | `Not logged in`（退出码 1） |
| E2b | 独立 `CODEX_HOME`，`auth.json` 符号链接到日常文件 | `Logged in using ChatGPT`（退出码 0）；日常 auth.json 未变 |
| E5 | TUI 中 `/model` 选模型后按 Enter（界面标注 “enter default”） | **写入 `CODEX_HOME/config.toml`**：`model="gpt-6-astra"`、`model_reasoning_effort="low"`；启动时的 `-m`／`-c` 不能阻止 |
| E6 | TUI 中 `/model` 选模型后按 `s`（session） | 提示 “for this session only”，`config.toml` 不写模型；后续请求与 `turn_context.model` 均为新模型 |
| 附 | TUI 首次启动 | 会写入 `[tui] screen_reader_detection_done = true`；模型选择器列出的是 OpenAI 官方模型目录，不是自定义 Provider 的模型 |

## 结论（Codex）

1. **API Provider 无需独立配置目录。** 按次 `-c model_provider` ＋ `-c model_providers.<id>={…, env_key=…}` 即可生效，Key 只经本次进程环境变量传入，不进 argv、不落盘，不改全局 `config.toml`。WillYou 现有“按次注入”机制可直接承载，只需把 Provider 生成为 `-c` 参数和 env。
2. **Provider ID 必须稳定并在恢复时重新注入。** Codex 把 `model_provider` 写入会话；恢复时缺失会明确报错（E4）。WillYou 应为每个 Provider 生成稳定 ID（如 `willyou_<providerId>`），任务快照记录该 ID；Provider 已被删除时按需求提示重新选择，这一行为与 Codex 自身报错一致。
3. **订阅登录：独立空目录需重新登录；共享凭据有风险。** 符号链接 auth.json 能读到登录，但令牌刷新时若 Codex 以原子替换写回，可能断开链接并造成两份 refresh token 分叉，进而让日常登录失效（本轮未触发刷新，属推断，未验证）。因此**不建议**为订阅配置建独立 `CODEX_HOME`；订阅与 API 都使用默认 `CODEX_HOME`＋按次 `-c` 注入。副作用：WillYou 启动的会话与终端共享 `~/.codex/sessions` 历史（也意味着终端 `codex resume` 能看到）。
4. **T-MODEL：Codex 不会自动沿用最后使用的模型**，恢复时取当前配置默认值。但每轮的 `turn_context.model` 都记在 rollout 里（包括 TUI 内切换）。可行方案：WillYou 恢复任务时读取该会话 rollout 最后一条 `turn_context.model`，以 `-m` 传入；推理强度字段在 `exec` 下为空，TUI 下的字段名待补核。
5. **新风险：TUI `/model` 按 Enter 会改全局默认。** 在默认 `CODEX_HOME` 下运行时，用户在 WillYou 会话里按 Enter 选模型，会改掉终端里 Codex 的默认模型，违背“按次运行、不影响终端”的已确认边界。候选处理（待用户决定）：
   - A. 接受该原生行为，在 WillYou 内提示“切换模型请按 s 仅本会话”；
   - B. 每个运行配置用独立 `CODEX_HOME`（隔离彻底，但订阅需各自登录，或承担第 3 条的共享凭据风险）；
   - C. WillYou 在会话前后检测 `config.toml` 中 `model`／`model_reasoning_effort` 的变化并提醒或还原（与终端并发修改时有覆盖风险）；
   - 另需查 Codex 是否有关闭“保存为默认”的配置项（本轮未查到，待核）。
6. API Provider 下 `/model` 列出 OpenAI 官方目录而非 Provider 模型，会话内切换对第三方服务基本不可用；可否通过模型目录配置覆盖待查。

## 未覆盖

Claude Code 全部实验；真实 API／订阅请求；令牌刷新时的写回方式；`model_reasoning_effort` 在 rollout 中的字段；Codex 多版本差异。

## 补充：DeepSeek 接入 Codex 与 Magpie 做法（2026-11-10 同日）

用户问题：按次注入时 Codex 如何接 DeepSeek；Magpie 为何能同时用订阅与 DeepSeek。

**DeepSeek 官方 Codex 接入脚本**（`https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.sh`，本次下载 SHA256 `7757a41ce202add83777518d4d5c67571bdb031e319227acebc529b6fb71af20`，未执行，仅静态阅读）：`base_url="https://api.deepseek.com/"`、`wire_api` 强制为 `"responses"`（脚本注明 `"chat"` 会令当前 Codex 无法启动）、Key 以 `experimental_bearer_token` 写入，并生成 `models.json`（`deepseek-flash`、`deepseek-v4-pro`）经 `model_catalog_json` 引用；它直接改写 `$CODEX_HOME/config.toml` 顶层（全局），带备份与还原。结论：**DeepSeek 官方 API 已原生支持 Responses 协议，Codex 接 DeepSeek 不需要协议转换网关。**

**Magpie 做法**（本地源码 HEAD `60f0433d`，`docs/subsystems/agent-wiring.md`、`gateway-routing.md`）：在本机起网关 `127.0.0.1:3425`，“连接”时改写 Agent 自身全局配置，令 Codex 的 provider 指向网关（断开时还原）；网关同时持有 ChatGPT 订阅账号与各 API Key，按请求的模型名路由到对应上游，必要时做协议转换，并为 Codex 写入合并后的模型目录。因此同一个 Codex 会话里 `/model` 可在订阅 GPT 与 DeepSeek 之间切换。代价是：全局接管 CLI 配置、网关托管订阅凭据、协议转换与大量边角兼容（其文档对标题／记忆等旁路请求的模型归属有大量专门处理）。

| 编号 | 操作 | 实际结果 |
| --- | --- | --- |
| E7 | TUI 启动加 `-c model_catalog_json="<DeepSeek 脚本中的 models.json>"`、`-m deepseek-flash`＋按次 provider | `/model` 只列出 DeepSeek-Flash、DeepSeek-V4-Pro（不再是 OpenAI 目录） |
| E8 | 选 V4-Pro 后按 `s` 并发一轮 | 请求 `model=deepseek-v4-pro`，`turn_context.model` 同值；全局 `config.toml` 未写模型 |

**补充结论：**

7. 按次注入可完整承载 Codex＋DeepSeek：`-c model_provider`＋`model_providers.<稳定ID>={base_url,wire_api="responses",env_key}`＋`-c model_catalog_json=<WillYou 管理的目录文件>`＋`-m`。Key 用 `env_key` 走进程环境，不采用官方脚本的 `experimental_bearer_token` 明文落盘。会话内可在该 Provider 的模型目录中切换。第 6 条（API Provider 下 `/model` 显示 OpenAI 目录）由此解决。
8. 不经网关时，一个会话绑定一个 Provider：“Codex·原有登录”和“Codex·DeepSeek”是两份运行配置，可同时运行、互不影响；但同一会话里不能在订阅 GPT 与 DeepSeek 之间切换（这需要 Magpie 式网关，R0.3 已将网关排除出首期）。
9. 第 5 条风险在 DeepSeek 场景更严重：若在 DeepSeek 会话里 `/model` 按 Enter，全局 `config.toml` 会写入 `model="deepseek-v4-pro"`，而全局 provider 仍是 OpenAI 订阅，终端里的 Codex 下次启动将以该模型名请求 ChatGPT 而出错。

未验证：真实 DeepSeek API 请求、`models.json` 中 `base_instructions` 等字段对行为的影响、目录文件的维护方式。

## 更正（2026-11-10 同日）

- 结论第 3 条“令牌刷新时若以原子替换写回可能断开符号链接”的推断过宽：Magpie 文档（`agent-wiring.md` 第 162 行）记载 Codex 刷新令牌时以 truncate 方式原地重写 auth.json（codex-rs `FileAuthStorage::save`），按此写法符号链接会被保留、写入原文件。该说法来自第三方文档，未经本轮实测；多个进程并发刷新的风险与共用 `~/.codex` 时相同。原结论“订阅与 API 都使用默认 `CODEX_HOME`＋按次 `-c`”不变，独立 `CODEX_HOME`＋链接 auth.json 降为可行备选。
- 用户决定（2026-11-10）：不做同会话跨 Provider；`/model` 回车写全局采用“检测并提醒＋一键还原”，新建任务用运行配置默认模型。已记入需求 R0.3 补记。

## 补充：经 Magpie 网关的真实请求（2026-11-10，用户打开 Magpie 并授权）

前置：用户手动启动 Magpie，网关 `127.0.0.1:3425` 运行；WillYou 未在 Magpie 中“连接 Codex”，未改 Magpie 任何设置。

| 编号 | 操作 | 实际结果 |
| --- | --- | --- |
| M1 | `GET /v1/models`，`Authorization: Bearer magpie-codex` | HTTP 200，33 个模型：`deepseek/*`、`ultrapwor/*`、`claude/*`（Claude 订阅）、`codex/*`（ChatGPT 订阅） |
| M2 | `GET /v1/codex/models` | HTTP 200，31 条 Codex 目录格式条目（较 M1 少 `codex/gpt-5.6-terra`、`codex/gpt-5.6-luna`，原因未查） |
| M3 | 隔离 `CODEX_HOME`，`exec -s read-only` ＋ `-c model_provider="willyou_magpie"` ＋ `model_providers.willyou_magpie={base_url="http://127.0.0.1:3425/v1",wire_api="responses",env_key="WY_MAGPIE_KEY"}` ＋ `-c model_catalog_json=<M2 保存文件>` ＋ `-m deepseek/deepseek-flash`，**1 条真实请求** | 退出码 0，回复 `OK`；input 10639 tokens（Codex 自带系统提示）、output 2；rollout `model_provider=willyou_magpie`、`turn_context.model=deepseek/deepseek-flash` |
| M4 | 前后核对日常 `~/.codex/config.toml`、`auth.json` | SHA256 与 mtime 均未变化；无残留进程 |

证据：[`magpie-models.json`](实验/T-CFG_Codex_20261110/magpie-models.json)（只存 ID 与目录哈希）、[`magpie-exec-out.jsonl`](实验/T-CFG_Codex_20261110/magpie-exec-out.jsonl)。

**结论 10：** Magpie 可作为“Responses 兼容 API”类 Provider 直接接入，无需专门适配：地址 `http://127.0.0.1:3425/v1`、令牌 `magpie-codex`、模型目录取自 `/v1/codex/models` 并由 WillYou 保存后按次注入。经 Magpie 时，同一会话内跨服务商切换由 Magpie 路由承担（本轮未实测会话内切换）。WillYou 侧需要：Magpie 未运行时的健康检查与提示、目录刷新时机、Magpie 令牌并非用户密钥（可明文展示）的说明。

## 补充：经 Magpie 的工具调用、会话内跨供应商切换与故障表现（2026-11-10，用户要求补验）

隔离 `CODEX_HOME`，按次注入同 M3，只读沙箱，`model_reasoning_effort="low"`；项目目录放 3 个文件，任务为“执行 ls，只回复 FILES=<数量>”。证据：[`magpie-tools-result.json`](实验/T-CFG_Codex_20261110/magpie-tools-result.json)、[`magpie-session-result.json`](实验/T-CFG_Codex_20261110/magpie-session-result.json) 及对应驱动。前后日常 `~/.codex` 哈希不变。

| 编号 | 模型／场景 | 实际结果 |
| --- | --- | --- |
| M5 | deepseek/deepseek-flash | ✅ 执行 `ls -la`（exit 0），回复 FILES=3，4 s |
| M5 | deepseek/deepseek-v4-pro | ✅ `ls -A`，FILES=3，6 s |
| M5 | ultrapwor/deepseek-v4-pro-0813 | ✅ `ls -1A \| wc -l`，FILES=3，9 s |
| M5 | ultrapwor/glm-5.3-flash | ✅ `ls`，FILES=3，13 s |
| M5 | ultrapwor/kimi-k2.5 | ✅ `ls`，FILES=3，8 s |
| M5 | ultrapwor/glm-5 | ✅ `ls -la`，FILES=3，9 s |
| M5 | ultrapwor/claude-haiku-5-5 | ❌ 1 s 内失败，退出码 1：`Ultrapwor云: Upstream provider rejected the request (400)`。上游拒绝，原因（Magpie 转换或 Ultrapwor 对该模型的限制）未查 |
| M6 | 同一会话：deepseek-flash 记暗号 BLUE-42 → `resume -m ultrapwor/kimi-k2.5` 加 1 → `resume -m ultrapwor/glm-5.3-flash` 执行 ls | ✅ 依次回复 OK、BLUE-43、`BLUE-43 FILES=3`；rollout `turn_context.model` 为三者顺序。上下文跨供应商延续；Codex 每次切换只给“会话记录模型不同”的提示 |
| M7 | 指向无人监听端口（模拟 Magpie 未开） | ❌ Codex 不报错退出，持续 `Reconnecting... waiting for network`，120 s 后被驱动终止。同时 `curl /v1/models` 立即返回连接失败（exit 7） |
| M8 | 不存在的模型 `ultrapwor/no-such-model`（模拟上游不可用／目录过期） | ❌ 403 `Model 'no-such-model' is not allowed for this API key`，重试 5 次后 6 s 退出码 1，错误文本清楚指向 Ultrapwor云 |
| 附 | 隔离 `CODEX_HOME` 首次运行 | Codex 后台 `git fetch https://github.com/openai/plugins.git` 同步官方插件目录，exec 结束后进程仍在；已按本次根目录结束。驱动初版给 `exec resume` 传 `-s` 导致用法错误（驱动缺陷，已改用 `-c sandbox_mode`，原失败保留在结果中） |

**结论 11：** Magpie 下 6/7 模型可在 Codex 中完成真实工具调用；`ultrapwor/claude-haiku-5-5` 当前不可用，说明“能列出”不等于“能用”，WillYou 一键接入后应提供逐模型“测试可用性”并标记结果。
**结论 12：** 经 Magpie 可在同一会话内跨 DeepSeek／Ultrapwor 切换且上下文延续（Codex 视为同一 Provider）。
**结论 13：** Magpie 未运行时 Codex 会无限重连而不退出，**启动前 `/v1/models` 预检是必须的**，否则用户只看到终端卡在重连。上游拒绝／模型不存在时 Codex 在数秒内以清楚错误退出，无需额外处理，但目录过期会触发此类错误，支持刷新目录。
**M9（模型目录随 Magpie 开关变化，用户操作）：** 用户在 Magpie 关闭 Ultrapwor云 与 Claude Pro 后，`/v1/models` 与 `/v1/codex/models` 均降为 10 条（deepseek 2＋codex 8），ultrapwor／claude 全部消失；仅重新打开 Ultrapwor云 后两接口均为 15 条（deepseek 2、ultrapwor 5、codex 8）。证据 [`magpie-toggle-models.json`](实验/T-CFG_Codex_20261110/magpie-toggle-models.json)。另：最初 33 个模型时 `/v1/codex/models` 为 31 条（缺 codex/gpt-5.6-terra／luna），10 条与 15 条时两接口一致，差异原因未查。

**结论 14：** Magpie 的开关会即时反映到两个接口。WillYou 已需在启动前请求 `/v1/models` 做预检（结论 13），可同时比对模型目录：所选默认模型已不在列表时提示并给出可选模型，目录有变化时在启动前刷新本地目录文件；另提供手动“刷新模型”。用户 2026-11-10 确认采用“启动前自动＋手动”，已记入需求。

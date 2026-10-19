# Codex 实际用户配置与原生根补验

2026-10-19，M10 A19 开发前补验。当前结论：**本机 Codex 0.162.1 在原生用户根中，现有 Skill／MCP 定义与受管探针能力可以共同发现；真实模型新建、同原生 ID 恢复及固定版本工具调用通过。** 这补上前轮“仅合成 HOME”的证据缺口，不代表全部用户配置、所有 Codex 版本或正式 WillYou 业务已经验收。

脚本：[probe.mjs](probe.mjs)；最终结果：[result.json](result.json)；REA 身份及执行边界：[rea-evidence.json](rea-evidence.json)。2026-10-19 08:02:58–08:03:41 UTC 的最终轮共 **11 项断言通过**，状态为 `passed-with-boundaries`。模型两次均为 `gpt-6.1-sol`，真实 `mcpToolCall` 完成，传入只存在 Skill 正文中的随机 nonce，探针验证 `nonceMatch=true`。

## 实际路径和保护范围

```text
HOME=/Users/liubu
CODEX_HOME=/Users/liubu/.codex
真实配置：/Users/liubu/.codex/config.toml
真实认证：/Users/liubu/.codex/auth.json（由 CLI 原生读取，无复制）
真实用户 Skill：本机 ~/.codex/skills、~/.agents/skills 及现有插件目录

本轮应用 Skill：
/private/tmp/m10-codex-user-config-<随机值>/project/.agents/skills/v1/SKILL.md
/private/tmp/m10-codex-user-config-<随机值>/project/.agents/skills/v2/SKILL.md

自己的原生会话 ID：01a1532f-a053-7792-9413-e4af24f0c07e
恢复时的原生记录：
/Users/liubu/.codex/sessions/2026/10/19/rollout-2026-10-19T16-03-12-01a1532f-a053-7792-9413-e4af24f0c07e.jsonl
```

Skill 和 MCP 只返回合成标记；没有禅道、邮件业务读写，没有向其他人发消息，没有调用用户 MCP 的 `tools/call`。不恢复或修改用户在办会话。本轮仅自己的探针会话在结束时通过原生 `thread/archive` 归档；不手工删除原生历史或 SQLite 行。临时项目与 Skill 已删除，探针历史不作为可长期恢复的应用会话。

实际原生 `config.toml`、`auth.json`、`hooks.json` 在每轮前后 SHA-256 均相同。没有向用户全局 Skill 根新增或删除资源，没有覆盖用户 `skills.config`，运行时覆盖合并时保留其现有 1 条记录。由于实际根参与原生运行，CLI 可写自己的会话／缓存等状态，不能将“这三个文件不变”扩大成整个 `~/.codex` 没有变化。

## 已观察结果

| 检查 | 结果及证据范围 |
| --- | --- |
| 实际配置层合并 | `config/read` 确认真实 `~/.codex/config.toml` 层存在；原有 8 个 MCP 定义与独立探针定义同时保留。MCP 名使用唯一前缀，未覆盖原名称 |
| 实际用户 Skill | 首次发现 196 个，均保留；实际插件异步初始化后增至 292 个，没有初始条目缺失或 enabled 改变。不是只放置一个合成“用户 Skill” |
| 两版本选择 | v1 完整 `SKILL.md` 路径为 true、v2 为 false；现有用户选择记录保留。这里是临时项目发现目录；全局共享目录的两个版本／跨项目选择由[前轮 Codex 实验](../codex/README.md)单独证明 |
| 实际用户 MCP 共同发现 | 原生 `mcpServerStatus/list` 同时返回原有 8 个服务器和应用探针。openaiDeveloperDocs／firecrawl／node_repl／rea／clawchat 返回工具元数据；memex／scrapling／computer-use 本轮只有状态条目、工具数为 0，**不能记作这 3 个服务连接或调用成功** |
| 同名冲突 | 临时项目放置与现有 `agent-prompts-warmup` 同名 Skill，原生列表同时返回两个启用路径。探针侧检查能识别冲突；原生不自动给 WillYou 提供无歧义名称。真实用户文件未修改 |
| 运行后增删目录 | 进程已启动，再增加 v3；`skills/list(forceReload=true)` 发现 v3 且默认启用。删除后再次强制扫描消失。这证明 v1／v2 显式列表不会自动拒绝未知的新路径；并未测试模型自动刷新时机 |
| 实际原生根中的真实新建 | 本机既有认证、只读 sandbox、never 审批；显式 Skill 输入→正文 nonce→只读 MCP，完成 |
| 原生同 ID resume | 关闭首个 app-server，启动新进程，重新传 v1 路径／MCP，恢复同一 ID；返回 1 个历史 turn，第二个真实 turn 再完成 v1 MCP 调用 |
| 清理 | 三个 app-server 都退出，临时目录删除，自己的历史归档，三个原文件 hash 均未变 |

**发现和模型执行分开。** 发现阶段保留实际用户 MCP，做原生初始化、发现和状态查询，未调用业务工具。模型阶段为限定实验，仅在当前进程禁用这 8 个 MCP、插件、Apps、Shell／Web 等，只留下合成 MCP 可调用。不能把模型阶段概括为“所有用户 MCP 和应用工具同时调用成功”；共同发现有独立证据。Hooks 和 notify 在当前进程停用，实际配置文件未改。

## 对首版适配器的具体约束

1. 沿用用户真实原生根，不用空 `CODEX_HOME` 冒充兼容。保持当前工作目录为项目实际路径；应用包和管理投影按设计独立于项目源码。
2. 运行时 `skills.config` 必须合并用户记录，仅修改本产品拥有的完整 `SKILL.md` 路径。MCP 使用确定且唯一的产品命名空间，冲突时报告该应用不可用，不能覆盖同名用户定义。
3. Skill 名使用应用 ID／版本等确定命名空间；核对发现的名称、真实路径、启用状态。测试中同名两个文件同时出现，因此不能只根据 Skill 名认为选对了版本。插件发现可能异步增长，不要用一次总数比较判断用户能力丢失。
4. 共享受管目录仍需已设计的冻结规则：相关消费者存活时，不新增、替换或删除它们可发现的受管路径；安装可先放入未暴露的 staging，准备完成并取得协调条件后再发布。此次 v3 观察直接支持该要求。真实锁、租约与崩溃恢复须由产品实现并验收，本探针没有伪装成实现。
5. resume 必须沿用原生 ID、原生根和固定 Skill／工具版本；原生历史不会替 WillYou 锁版本。旧目录／包缺失时不偷偷换新包，给出应用不可用状态，Agent 仍可继续。
6. CLI 的 `-c` 左侧为其路径解析器，不等同于 TOML 文档语法。本轮 `mcp_servers."memex".enabled=false` 被当作带引号的新服务器键而报 invalid transport；当前可验证普通标识名称使用 `mcp_servers.memex.enabled=false`。任意名称的渲染应走格式正确的整体结构／适配器测试，不能直接拼引号。

以上约束是研究结论与实现要求，不是正式适配器已经落地。

## 失败与复验

- [第一次发现记录](attempt-01-plugin-discovery-async-growth.json)：将整个发现数组要求前后完全相等，得到失败。随后增加逐路径差异，确认原 196 个未丢失，另外 96 个现有插件 Skill 异步出现。保留原失败，不将计数变化误报为用户 Skill 被覆盖。
- [第二次记录](attempt-02-quoted-override-key.json)：发现检查通过；模型进程因上述带引号的 `-c` 键产生无效 MCP 传输，在 initialize 前退出。探针原 RPC 等待器只记录 initialize timeout；独立 `codex -c 'mcp_servers."memex".enabled=false' features list` 返回 `invalid transport in mcp_servers."memex"`，据此修正探针参数。该轮没有模型 turn。
- [最终记录](result.json)：修正后 11 项通过，新建和 resume 两个真实 turn 均完成。脚本仍使用前轮 RPC Client，控制过程以结果 JSON 为准，脚本进程退出 0 本身不代表断言通过。

## 仍属于边界或开发后验收的内容

- 本机没有配置 `profile`／命名 profiles，不能声称所有 profile 组合均测试过。当前默认用户配置已有直接证据；未来不同配置按适配器版本和检测结果报告支持情况，不以本轮证明所有组合。
- 本轮是原生 CLI `app-server` 协议，不是终端 TUI 的人工交互，也不是打包 WillYou 启动链。真实终端布局／交互、宿主传参、broker 权限、故障恢复仍需正式实现后验证。
- 没有写真实全局应用投影；应结合前轮共享合成根的双版本并发、跨项目过滤和 CC／Codex 混合运行证据理解，不能合并成一次全局生产安装实验。
- 没有恢复用户业务长会话，未覆盖其压缩历史和未知版本。新建并恢复的真实原生会话证明机制，正式升级／历史业务用例仍按 A19 第二阶段执行。
- 目录新增／删除是在同一活进程中显式 `forceReload` 观察，不推断自动发现事件时机，不证明真实 catalog 协调锁已经实现。

本轮没有新增需要用户决定的架构问题。以上具体路径、冲突守卫和目录冻结要求可以进入首版开发契约；不能据此把 72 条正式产品用例改为通过。

复现（第二条只执行两个合成真实模型 turn，使用现有本机账号；第一条会初始化实际用户 MCP，但不调用业务工具）：

```sh
node docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/codex-user-config/probe.mjs
node docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/codex-user-config/probe.mjs --live
```

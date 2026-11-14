# 原生子 Agent 提问身份验证

日期：2026-11-14。关联 R05／R06、Q26／Q29。真实固定版本 native、受控本机模型和 HTTP MCP；没有真人审批、真实业务或产品 UI。

## 实际场景

| 场景 | 观察 |
| --- | --- |
| Claude SDK 0.3.321／native 2.1.321，原生子 Agent 调 MCP 表单 | 子任务工具调用／结果帧有 agent_id、parent_tool_use_id，MCP call 的 meta 有 claudecode/toolUseId；但 onElicitation 及原始 elicitation control_request 没有子 Agent／tool-use 身份 |
| Codex 0.167.1，原生子 Agent 调相同 MCP 表单 | 提问 RPC 带子 threadId／turnId，threadId 等于实际 spawn 结果且不同于父 thread；本次 RPC id=0，仍是合法请求 |
| Claude 两个原生子 Agent 并发发送同文表单 | 两个回调均已到达后才允许回答；serverName／message／schema 完全一致，请求 ID 不同，回调 options 仍只有 signal／requestId；不能用正文区分子 Agent |

三条原生场景通过，共 18 次本机模型请求、4 条表单提问，3 个 native 进程 exit 0。回答由实验宿主自动提供合成内容，不代表用户批准。每次请求独立得到结果，子结果返回父 Agent。

## 设计解释

“请求可独立应答”与“请求可归属到某个原生子 Agent”不是同一个能力。Claude 的 requestId 足以回应原控制请求，但本版本的该回调没有直接子身份；原始控制包也不含前述 toolUseId。受控 MCP 服务可取得工具调用元信息，但将它关联到某个 elicitation 仍需要可信桥的额外记录与验证，不能默认所有第三方服务都提供可信身份。

这不等于 WillYou 的宿主委派子任务无法提问。宿主委派有独立 task／binding／run／Query，创建回调时的受管运行归属仍然明确；同一 Query 内 provider_native 子节点才涉及额外细分。无法细分时应展示已证明的宿主运行归属，原生子节点标为未确认；不要按当前选中会话、最后一个子节点或问题正文猜测。

本轮没有执行 T3 适配器。源码显示 T3 Claude 使用 activeTurn 与 requestId，Codex 查询活跃回合上下文；不能把源码参考升级为 T3 对本场景的实际支持结论。

## 未覆盖与复现

未验证宿主子任务问题账、真实 UI／IPC、子树停止期间的未决表单、迟到回答、跨 Provider 切换或崩溃恢复；此前插件审批和独立表单取消证据仍按各自范围保留，不能直接相加为 Q26 完整通过。Q26 继续待集成，Q29 继续部分。

运行 `node probe.mjs claude`、`node probe.mjs codex`、`node probe.mjs claude --two-children`。需允许本机监听，并具备归档记录的固定 native／SDK／MCP 依赖；二进制启动前校验摘要，全部配置与凭据为隔离合成值。各 attempt 保存当时的驱动，单子与双子变体可分别审计。

[结果](result.json) · [源码与版本](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。

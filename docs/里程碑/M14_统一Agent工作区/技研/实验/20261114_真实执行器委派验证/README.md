# 真实执行器通过宿主 MCP 委派实验

日期：2026-11-14。对应 Q19；不替代 Q20／23–29 的持久调度、Skill、权限、审批与恢复验证。

## 结果

| 用例 | 父执行器 | 子执行器 | 结果 |
| --- | --- | --- | --- |
| R01 | Claude Agent SDK | Codex app-server | 通过 |
| R02 | Codex app-server | Claude Agent SDK | 通过 |
| R03 | Claude Agent SDK | Claude Agent SDK（独立配置根） | 通过 |
| R04 | Codex app-server | Codex app-server（独立配置根） | 通过 |

attempt-1 执行前三项；attempt-2 只补 R04，没有重复前三项。固定 Claude SDK 0.3.321／配套 native 2.1.321、Codex 0.167.1。使用实验目录的受管程序、PATH `/usr/bin:/bin`、隔离 HOME 和合成 token，没有调用全局 CLI、真实模型供应商或用户项目。

## 真实链路与证据

父执行器通过实际 stdio MCP 发现 `wy_delegate` → 本地模拟模型返回该工具调用 → 实际执行器调用工具 → stdio MCP 进程请求本机宿主端点 → 宿主在请求处理过程中启动目标执行器子进程 → 子执行器完成真实协议回合 → 宿主返回带 delegationId／子 actor／来源的结果 → 父执行器下一次模型请求含 `CHILD_DONE` → 父原生结果为 `PARENT_SAW_CHILD_DONE`。

这里没有由测试驱动先独立运行子任务再把文本塞给父的替代路径。子进程由宿主收到 MCP 工具调用后创建；host.jsonl、process.jsonl、model-summary.jsonl 和 native.jsonl 共同记录该路径。每项有三次本地模型请求：父工具请求、子回合、父接收工具结果后的请求。

合计 8 个受控 Agent 进程退出码均为 0。4 个 stdio MCP 进程在父退出后经原生身份 helper 查询为 stopped。MCP 脚本没有记录到 exit 事件，故没有宣称其退出码均为 0；实际存活检查在 mcp-liveness.json。

## 模拟部分与未证明事项

- 所有模型响应由本地 HTTP SSE 服务决定，包括主动发起委派。证明运行时工具／协议链路可达，不证明真实模型能自主规划、遵守 Skill 或准确选择目标。
- 宿主是隔离 Node 探针，不是 T3 OrchestratorMcpService，也不是 WillYou 已有 ManagedTaskCapabilities／新生产委派服务。工具名和简化参数是实验合同，不宣称已实现产品 RPC。
- 简化作用域 token 来自宿主 actor 表，接收端校验父仍活动、目标和请求标识；不是 WillYou 私有 MCP bootstrap／peer／PID 出生身份认证，也没有业务授权继承。归档不含 token、配置目录或完整系统提示词。
- 采用独立父子目录并在工具请求中等待子结果。这只验证可使用 wait 的独立目录分支，不验证默认异步委派、父忙唤醒、持久 outbox、重启恢复或 SVN 共享目录交棒。
- receipt 仅进程内 Map；没有验证持久幂等、重复工具调用、取消、目标配置变化、多代次结果或失败恢复。不能拿它覆盖 D 原型或完整产品验收。
- 同 runtime 用例使用不同 HOME／配置根，不同真实账号、DeepSeek API、代理、模型路由与真实费用策略未测试。DeepSeek 通常是执行器配置的模型供应商，不是本实验另接入的 Agent runtime。
- Codex stderr 提示临时 CODEX_HOME 不允许创建 PATH helper aliases；本次 MCP 协议仍通过，但 shell／apply_patch 等工具不在本实验范围，不能把这些结果扩大为完整开发工具链通过。
- 未调用原生 Agent／spawn_agent；这些结果属于宿主委派，不能推断原生子 Agent 与宿主取消／恢复等价。

## 对设计的影响

首批通用委派可沿用相同的宿主 MCP 合同接入 Claude 与 Codex，目标解析后由各 runtime 适配器执行；不需要为“Claude 调 Codex”与“Codex 调 Claude”各建一个专用编排系统。R03／04 进一步说明同 runtime 多个独立实例也可走该通道。通用性仍须建立在已适配的能力合同上，不能承诺任意新 CLI 都无需适配。

下一步应把此通路接入持久命令／结果账、真实 owner、业务能力快照与目录协调。先前 D 状态原型、O 注册器实验与本次 R 协议实验是互补证据，目前没有把三者集成为同一个产品引擎。

## 复验

驱动含原实验路径，先在新的隔离目录映射路径，按 runtime-dependency-lock.json 准备受管运行资源。允许回环监听后运行 `node probe.mjs <不存在的批次名>`；可增加第三参数 `R04` 等只跑单项。不要覆盖归档或把 HOME／CODEX_HOME 指向日常目录。

原始 attempt-1 驱动在该子目录；根 probe.mjs 是新增 R04 与用例过滤后的版本。source-hashes.json 分别对应执行时驱动。归档包括最小请求摘要、原生结果、收尾及依赖／程序哈希，不包含二进制、配置根、会话文件或用户凭据。

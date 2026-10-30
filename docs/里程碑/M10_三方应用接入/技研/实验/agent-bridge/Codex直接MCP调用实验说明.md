# Codex 直接 MCP 调用隔离实验

2026-10-17，M10 R1.2 的技术补充。实际结果：[codex-mcp-call-report.json](codex-mcp-call-report.json)。**1 个研究测试、18 条断言通过**。本实验验证现有运行时能被本机 Codex **真正调用一次工具并取回当前项目数据**，补足已有探针只验证 Skill／MCP 发现的边界。它不是 M10 业务验收。

## 实际执行

- macOS arm64，Codex CLI `0.162.1`；测试由现有 Electron Node 运行，使用已经安装的依赖，没有安装或重编译依赖。
- 使用临时 HOME、CODEX_HOME、cwd、userData 和内存 SQLite；库中只有当前及另一个项目，共两个合成项目。未读取日常 Codex 配置、账号、用户数据库或真实三方数据。
- 复用生产 `CapabilityService.prepare`、`launch.py` 自检和现有 `context_mcp.py`，不改它们。仅把 `PATH` 从父环境传入；生成的运行环境均来自合成 fixture。
- 自定义 model provider 的 base URL 和所有代理均指向无监听的 loopback 端口 1；没有配置 API key，没有创建 HTTP 服务，没有发送任何 `turn/*` 请求。该配置用于避免误触真实模型／外部服务；没有做 packet capture，不将其表述为完整网络审计。
- 实际 RPC 顺序为 `initialize → thread/start → mcpServer/tool/call(project_context) → thread/unsubscribe`。线程响应的 `ephemeral: true`、`readOnly`、`networkAccess: false`、`approvalPolicy: never` 及隔离 provider 均有断言。

`mcpServer/tool/call` 实际返回一个 text content，解析后匹配当前合成项目的 ID、名称和 configHash；不存在另一个合成项目的 ID／名称，数据库与服务器为空，返回对象没有凭据字段。运行时投影自检通过，没有收到需账号／外部服务处理的服务器请求。

线程已退订，子进程退出，投影释放，临时根目录删除；清理结果写入 JSON。首次断言用全文关键词查“password”，误命中了合法 Skill 名 `smartdd-remote-password-ssh`；已更正为检查对象字段名后复验通过。首个失败报告保留于忽略目录 `release/m10-research/protocol-v1/codex-mcp-call-attempt1-report.json`，不把这次断言错误记作产品缺陷。

## 复现

独立入口：[实验测试脚本](codex-mcp-call.probe.test.ts)、[实验 Vitest 配置](vitest.codex-call.config.ts)。生产 `vitest.config.ts` 和既有 `cli-smoke.test.ts` 未修改；本脚本需显式开关，普通测试发现范围也不包含该目录。

从仓库根目录运行：

```sh
M10_CODEX_MCP_CALL_PROBE=1 node scripts/run-tests.mjs --config docs/里程碑/M10_三方应用接入/技研/实验/agent-bridge/vitest.codex-call.config.ts
```

默认结果写入忽略目录 `release/m10-research/protocol-v1/codex-mcp-call-report.json`，避免重跑时覆盖本次归档结果。可用 `M10_CODEX_MCP_CALL_REPORT` 指定其他本地报告路径。不要向这个实验加入真实账号或资源。

## 能证明与不能证明

本次证明：现有项目隔离投影可以在无模型 turn 的条件下，经安装的 Codex app-server 连接现有 Python MCP、实际调用工具并返回合成当前项目上下文；无需先为 M10 发明一套完全独立的 Agent 传输机制。

尚未验证模型能否正确选择工具、需要模型的懒加载、终端真实交互、审批提示、取消／并发／重启恢复、禅道／Foxmail／外部写操作、其他平台。它也不证明把 `readOnly` 配到任意 MCP 工具后就能自动约束远端副作用；本次被调用的工具本身只读。保留原[REA 使用链路报告](../../../调研/Codex接入后使用链路REA_V1.md)的静态调查历史，本实验作为后续运行时证据独立记录。

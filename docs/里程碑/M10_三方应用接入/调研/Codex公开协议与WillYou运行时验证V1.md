# Codex 公开协议与 WillYou 运行时验证 V1

2026-10-17，依据 M10 需求 R1.2，覆盖 M10-R01／R02／R07／R08。与发布包 REA 互补：本页核对当前官方协议和现有项目运行时，不把不同版本的 CLI 当作桌面包的内部运行时。

## 1. 版本与证据边界

| 对象 | 本轮证据 | 能说明什么 |
| --- | --- | --- |
| Codex 桌面发布包 | 26.1007.30912／build20156，REA 子报告 | 已安装包的静态实现及分支，不是所有账号的线上能力 |
| 独立 Codex CLI | 0.162.1，实际执行schema生成、隔离发现及直接工具调用 | 本机该CLI的协议／发现／调用行为；不声称等同桌面内嵌CLI |
| Claude Code | 2.1.302，隔离假 API 探针 | 现有插件 Skill／MCP 注入与工具回传，不代表真实模型或业务服务 |
| WillYou | 当前 feature/0.0.1 工作区 | 既有代码复用边界，未修改生产实现 |

[协议元信息](证据/codex-protocol-v1-contracts.json)记录生成的 447 份 JSON Schema、13 个相关方法的字段与哈希。完整 schema 留忽略目录 `release/m10-research/protocol-v1/schema/`。命令为 `codex app-server generate-json-schema --experimental --out ...`；schema 导出本身不运行会话、工具或模型。

## 2. 公开协议核对

通过 OpenAI Docs 搜索并实际读取 [App Server](https://learn.chatgpt.com/docs/app-server) 和 [MCP](https://learn.chatgpt.com/docs/extend/mcp)。主要职责边界：

| 职责 | 文档／本机 schema 中的接口 | 对本项目的意义 |
| --- | --- | --- |
| 目录与运行状态 | app/list、app/read、app/installed | 元数据、可访问／启用和可调用状态不能混为“已连接” |
| 插件生命周期 | plugin/list／read／install／uninstall | 当前文档明确这些方法仍在开发中，不应作为生产客户端依赖 |
| MCP 连接 | 状态列表、OAuth 登录、配置 reload | 连接就绪与工具暴露分别检查；不是复制 Codex 云账号连接 |
| 工具执行 | mcpServer/tool/call；参数含 threadId、server、tool、arguments、_meta | 执行绑定线程及服务；显示摘要不是执行权限 |
| 会话输入与输出 | thread/start、turn/start、mcpToolCall／dynamicToolCall | 会话工具配置、单次调用、应用上下文及结果是不同层 |

MCP 文档还区分 stdio 与 Streamable HTTP、工具白名单、启动／执行超时及审批配置。WillYou 可使用标准 MCP 为不同 CLI 提供同一业务能力；M10 首期是否需要 HTTP 服务仍应以实际通道选择为准，不为复刻界面先开放额外网络服务。

本页只作有限职责摘要，具体参数以本机生成 schema 和对应版本官方文档为准。新旧持久化条目可能缺少新的 appContext 元数据，读取不能假设所有历史记录具备完整连接身份。

## 3. 实际复用测试

[结果摘要](../技研/实验/agent-bridge/cli-reuse-summary.json)保留命令范围、版本、逐项名称和原报告哈希。

| 实际执行 | 结果 | 覆盖边界 |
| --- | --- | --- |
| capability-service、task-runtime、transfer-format 原有测试 | 31／31 通过 | 项目运行时投影、版本固定、秘密不落 argv／配置、退出清理／恢复、M8 严格格式等；不等于 M10 已实现 |
| 本机 Codex app-server 隔离探针 | 1／1 通过 | 临时项目中已启用／停用 Skill 发现，当前会话 MCP 发现；没有真实模型或第三方调用 |
| 本机Codex直接MCP调用独立实验 | 1测试／18断言通过 | initialize→只读临时thread→mcpServer/tool/call(project_context)→退订；仅合成当前项目、无模型turn、临时数据清理 |
| 本机 Claude Code 隔离假 API 探针 | 复验 1／1 通过 | 临时插件 Skill、MCP 工具被假 API 选择、结果回传；没有真实账号／邮件／禅道数据 |

Claude 初次在沙箱内尝试监听 127.0.0.1，被 `listen EPERM` 拒绝后超时；原失败报告保留。允许该隔离本地监听后仅复验受影响的 Claude 用例并通过，Codex 用例在该复验中未重跑、不能把 skipped 计为通过。未以调整超时或更换真实服务掩盖失败。

实际运行的是已有 `src/main/core/capabilities/cli-smoke.test.ts`。独立测试临时目录与假 API 是既有隔离方案，没有改写用户日常 CLI 配置。Mac Electron 环境的结果不能证明 Windows／Linux 业务兼容。

表中另加的[直接MCP调用实验](../技研/实验/agent-bridge/Codex直接MCP调用实验说明.md)使用独立测试入口，复用未修改的CapabilityService／launch.py／context_mcp.py。实际返回当前合成项目ID及configHash，另一合成项目缺席；没有发送turn/start，模型provider和代理均指向无监听loopback端口1。此为配置隔离，不是网络抓包证明。首次全文关键词断言误命中合法Skill名中的password，已改为字段名检查并复验，失败报告保留；不记为产品缺陷。它补足“发现之后确实能调用现有工具”，仍不验证模型选工具或新三方业务。

## 4. 已有 MCP 的边界实验

用[独立脚本](../技研/实验/agent-bridge/probe_existing_mcp.py)直接启动现有 `resources/runtime/context_mcp.py`，仅传合成公开项目上下文。[9 项观察报告](../技研/实验/agent-bridge/existing-mcp-report.json)中，6 项验证基本行为、3 项明确记录设计限制：

- 初始化、发现、只读调用、未知工具拒绝、坏 JSON 后继续处理均可观察；传入其他 projectId 不会切换已绑定的当前项目。
- 当前实现仍接受初始化前调用，回显任意协议版本，且完整反射输入 context。它依赖上游生成的公开投影，不是通用连接授权或数据清洗服务。
- 这些观察不表示现有只读工具存在跨项目读取漏洞，也不表示可直接扩展为邮件发送／禅道流转。M10 需要显式参数契约、当前连接／绑定检查、输出投影和逐类结果处理。

## 5. 数据持久化候选实验

[SQLite 实验](../技研/实验/agent-bridge/probe_candidate_storage.py)在临时库验证 8 项结构：外部 ID 按连接＋对象类型隔离、唯一约束、外键、项目绑定、停用／修订后的旧快照拒绝、重复本地 intent、事务回滚和重开后的未知结果。[结果](../技研/实验/agent-bridge/candidate-storage-report.json)为 8／8；这是候选 schema，不是生产迁移。

初次脚本的 INSERT 占位符与 7 列表结构不匹配，在实验脚本内修正后完成。没有修改业务数据库。唯一约束只能防本地重复入队，不能保证外部服务器 exactly-once；撤销检查也不能撤回已经发出的远端操作。

## 6. 与 M8、运行时和平台的实际耦合

- `CapabilityService.prepare` 已按 project／task／run 生成配置，并固定 Skill 版本；配置生成、CLI 发现、工具调用成功应分开记录。连接撤销状态需要额外每次核对，不能仅信任旧快照。
- `SecretsStore` 使用注入的系统加密器；renderer、工具描述、公开上下文和调用日志仅保存引用／脱敏数据，不能直接投影所有账号密码。
- M8 传输格式是 strict schemaVersion=1，能力枚举和凭据类型固定。新增三方连接不能静默塞进 v1 文件；是否随项目导出需业务决定，随后分别设计排除或新格式／兼容迁移，不改变既有已验收文件含义。
- 本地 Yoda 的 MCP 适配器可参考通道转换，但其 Codex adapter 只输出 stdio，不能据此推定 Codex 不支持 HTTP。实际复制前仍需核对许可证、依赖和来源声明。
- 尚未验证 M10 服务被真实 CLI 调用、真实第三方数据、打包容器权限、权限撤销后的完整 UI 恢复以及其他平台。对应工作应进入正式方案和验收，不用本页实验替代。

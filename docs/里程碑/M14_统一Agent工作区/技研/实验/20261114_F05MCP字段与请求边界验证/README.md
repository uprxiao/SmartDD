# F05 MCP 字段、复杂请求与断连

2026-11-14。F05 研究关闭，产品未开发。新增决定是逐字段准入、完整 Schema 的证据门槛和精确连接回调隔离；不能把原生 SDK 能调用工具解释为任意表单均可回答。

## 执行与适用范围

| 批次 | 结果 | 范围 |
| --- | --- | --- |
| attempt-kgcnzX | 6 项通过 | Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1，各测试带标题多选、URL 明确 cancel、pattern 丢失反例；MCP 实际收到 cancel，下一本机模型请求收到工具返回 |
| attempt-nWr9cf | 1 项通过 | Codex 待回应时断开自有进程连接，再启新连接；两连接原生 ID 都是数字 0，旧 callback 拒绝且零发送，新连接一次回应 |
| attempt-viOrGy | 2 项通过 | 当前 convertMcp 结果进入真实 SDK／app-server；Claude 使用私有 mcp-config 与 headersHelper，Codex 使用 env_http_headers；认证、空头和字面量 ${...} 都在实际 localhost HTTP 接收端核对 |
| mapping-6D7Vha | 4 项通过 | 当前 parse／resolve／convert／projection 及实际 launcher 子进程；stdio cwd／args／环境过滤、HTTP 值、禁用与不支持路径、未知 timeout 字段反例及候选前置拒绝 |
| schema-gate | 3 项通过 | 对照真实 MCP 发出帧与两端宿主回调，确认 pattern 丢失；候选私有证据门槛拒绝无依据、复制句柄及旧连接证明 |

批次子检查不累加成产品验收数量。Claude／Codex 用合成模型和 MCP，未用真实供应商、登录、外部 OAuth／TLS 或业务写入。断连是进程协议连接关闭，不是所有网络断连：HTTP SSE 重连和原生 MCP 内部重连若不暴露代次／关闭依据，仍只能标记来源未知，不允许借新请求恢复旧 callback。

前两批 attempt-kMJCmd／attempt-ZmVy58 失败均保留：探针要求完整 Schema 相等，原生回调缺 pattern，SDK 将回调异常变成 cancel，导致“已记录回调一次”的断言失败。没有把它当通过；补原始 MCP 发出帧和回调日志后确认字段丢失，后续将该行为作为反例，显式取消而非默默放宽答案约束。当前证据证明 native 边界两侧字段不同，不精确归因到闭源 native 内部的某一函数。

## 已发现的两类丢字段

当前 parseMcpSource 接收 startup_timeout_sec／tool_timeout_sec 时会省略它们。M14 在读取原始定义后、现有 parser 前必须按 driver／版本／transport 的字段清单核对顶层及 tools／auth 等子对象；每字段登记“等价转换／原生保留／明确不支持”，不能解析后再比较，因为那时字段已丢失。合法且未知的语义字段阻止该服务器的新投影，提供具体字段诊断；保持原配置和旧 CLI 入口。只隔离有问题的服务器，其他完整选中项可继续。

当前两个 native 都把实际发出的 string.pattern 从宿主回调中移除。因而“检查 callback 是否包含不支持字段”不足以证明完整性。首期默认不承诺任意外部 MCP 表单 accept；只有宿主控制的原始 Schema 与当前请求、连接及来源存在可信关联，或者精确 native／协议组合已证完整保留且请求满足声明支持的语义时，才提供可填写表单。仅 serverName 相同、用户勾选可信、哈希字符串或原生声明支持 form 都不构成证据。没有完整性依据时统一 unsupported／SCHEMA_INTEGRITY_UNVERIFIED，走实测 cancel，不提交默认值。

这里的原始证据句柄由研究夹具签发，未开发产品透明 MCP 代理；不能把 schema-gate 的通过说成已经解决任意第三方 MCP 的原文获取。本期普通 MCP 工具与 WillYou 既有业务审批仍走原服务；此限制针对无法证明的原生表单接受。保留原生 CLI 工作流不代表修复其同版本内部 Schema 丢失。

## 复用现有职责

当前 projection 负责 cwd／相对命令解析、来源环境／私有槽、模型秘密剥离、权限和禁用；Driver 消费完整投影，不另建相反配置优先级。Claude 无 cwd 的 SDK 字段不意味着可以删除 cwd，继续用实际 launcher 控制工作目录；headersHelper 通过生成的 mcp-config 文件送入 SDK extraArgs，不能塞到不承诺该字段的 typed mcpServers 后假定支持。Codex 保留 env_vars、env_http_headers、工具允许／拒绝与审批策略。来源 helpers 不执行；宿主自有固定 helper 与来源脚本区别明确。

OAuth 是目标 native 的独立认证，当前跨工具转换明确拒绝 oauthRequired，不复制登录令牌；传输 TLS 使用原生网络层，企业证书／真实认证没有本批证据，仍走相应配置诊断与原入口。URL elicitation 是服务器要求的外部交互，不能与 MCP 连接 OAuth 混为一谈。两端 cancel 已证；打开、accept、completion 本批未验，不显示认证成功，不在研究期新建浏览器认证流程。

公开规范参考 [MCP 2025-11-25 elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)：URL 的 accept 表示同意开始交互，完成另由通知表明。文档列有字符串 pattern，但固定安装的 MCP SDK 1.32.2 的 StringSchemaSchema 不包含它；文档／类型声明不能替代原生链路实测。

## 关闭审计与后续验收

Q09：T0.1 §5.1.2 明确逐字段映射、来源、禁用和认证职责；当前转换／launcher 加真实原生 HTTP 提供证据，未知字段和不支持路径有拒绝出口；A09 验收同包完整配置、真实认证及错误诊断。

Q11：§4.4.5 保留 form／URL／unsupported、原始约束及精确连接；本批可见复杂请求取消、不可见约束丢失、断连旧 callback，加已有 §4.13／17／60–61／94–97 的正常回应／故障账；A11 补原始 Schema 与 callback 不同的反例以及首期 URL 取消。默认禁止无证据 accept 是已冻结 F05 的“不支持项明确终止”边界，不是宣布任意表单已兼容。

两项研究关闭不解除 F06 执行范围、F08 业务未知或 F16 UI 接线责任，不提升产品通过数。

## 证据与重放

[原生结果](native-result.json)、[断连](disconnect-result.json)、[投影入原生](projection-result.json)、[字段检查](mapping-result.json)、[Schema 门槛](schema-result.json)、[源码](source-review.json)、[退出审计](cleanup-audit.json)、[原始归档](evidence.tar.gz)、[摘要](archive-manifest.json)。归档仅合成配置与数据，包含两次失败。所有被追踪 native 根进程已终态；header helper 的短暂子进程未单独记录内核出生身份，不冒充全树故障验收。

重放按各 attempt 的原脚本与固定依赖恢复路径；native.mjs --disconnect-only 和 --mapping-only 分别运行后两批，schema-gate 读取六项原生批次的录制。脚本保留原环境路径，需要 macOS arm64 与所记录 native／SDK。映射构建把 Vite glob 替换为空并显式传入真实 launcher；不代表 Electron 打包验证。合成临时环境保留作为证据，未修改用户日常配置或产品源代码。

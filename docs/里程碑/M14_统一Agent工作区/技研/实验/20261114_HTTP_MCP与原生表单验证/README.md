# HTTP MCP 与原生表单验证

日期：2026-11-14。对应 Q09／Q11，补充[技术方案 §4.4](../../技术方案.md#44-待回应请求与原生回调)。固定 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1，在独立 HOME／配置根运行真实原生程序。本机模型端点选择工具，真实 HTTP MCP 服务发起表单，由隔离宿主探针回应。使用合成凭据，没有真实模型调用、生产业务调用或业务源码修改。

## 方法与结果

[探针](probe.mjs)使用 Streamable HTTP MCP、每次初始化独立服务／会话和会话来源核对。模型认证和 MCP Bearer 值不同，服务记录布尔匹配结果。表单包含必填 string／integer／boolean，以及长度和数值范围；实际接受内容为合成值。拒绝和取消不携带 content。两端均完成工具调用、询问、回应、工具返回和后续模型请求／回合终态。

| 批次 | 结果及解释 |
| --- | --- |
| [attempt-1](attempt-1/result.json) | Claude accept／decline／cancel／错误 MCP 认证四项通过；Codex 使用 approvalPolicy=never，服务收到 decline，宿主未收到 elicitation 请求。探针误期待 accept 并向假模型返回 500，引发原生重试及 turn failed；此失败原样保留，不当成 Codex HTTP MCP 不支持的证据 |
| [attempt-2](attempt-2/result.json) | Codex 改为 on-request，四项均通过。将结果断言放在回合之后，避免探针断言错误反过来制造模型 500 重试；不改变真实 MCP 服务、表单或原生程序 |
| [attempt-3](attempt-3/result.json) | 单独恢复 never，以自动 decline／宿主无 callback 为预期，再次验证通过；模型正常返回，turn completed。记录中的 codex-accept 是最初期望分支名称，实际预期和结果是 never 策略拒绝，并非表单接受 |

最终有 **9 项不同检查**：第一批 Claude 4 项、第二批 Codex 4 项、第三批 never 1 项。离线[审计脚本](audit.py)／[结果](audit-result.json)核对真实回应与 MCP 结果、Codex RPC／thread／turn 关联、认证头未误用模型 token，以及三个批次共 10 个 native 均退出 0。首批失败没有删除或改判。

错误认证使用 HTTP 403，两个执行器都没有向模型暴露该 MCP 工具，且没有工具执行／表单回调；最终模型仍可回答并正常结束。因此“回合成功”不是“MCP 连接成功”的证明。它没有验证 401 challenge／OAuth、HTTPS／TLS、SSE 旧传输、代理、断线重连、会话过期或全部认证方式。

## 设计与 T3 参考边界

- approvalPolicy=never 在本次固定 Codex 组合下使 elicitation 直接拒绝；不能把它解释成自动批准所有交互，也不能假定声明支持 form 就保证任何权限档位都会上报询问。工具执行许可与工具内部 elicitation 是不同交互。
- Codex 的实际 RPC id 在不同独立实例都可为数字 0；宿主必须保留连接／运行代次、thread、turn、serverName 与原生请求 ID，不可全局仅按 RPC id 去重。
- 单次 elicitation 的 cancel 只是取消这次表单，不等于取消整个任务。本轮两端 cancel 后工具返回 cancel，模型继续，最终回合正常完成。
- 本地 T3 的 CodexAdapterV2／ClaudeAdapterV2 将可回答的 elicitation 映射为审批卡。CodexMcpElicitation 会拒绝 URL，以及不能填齐必填字段的表单；两适配器也拒绝无法关联活动回合的情况。因此 T3 当前这段实现不等于任意结构化表单编辑器。本轮仅源码核对 T3，没有运行 T3 UI。
- WillYou 须分别声明底层协议能力、当前策略是否允许询问、公共合同是否支持该形态，以及实际 UI／业务回应能力。不支持时明确诊断并按验证过的协议拒绝／取消，不能降成 boolean 或偷偷填默认许可。

本轮对字段有效值做了完整往返，没有证明无效输入、所有 Schema 约束和复杂表单的客户端校验，也没有验证 URL/OAuth 流程、原生并发询问、重启恢复、实际业务审批、owner／私有业务桥或新 UI。Q09／Q11 保持部分；正式产品验收仍 0／54。

## 复核与归档

来源版本、源码／二进制摘要和压缩原文摘要见 [sources.json](sources.json)，归档校验见 [manifest.json](manifest.json)。各批保留当时脚本、结果、协议和清理记录；不归档整个原生配置根／依赖。所有输入、认证及模型输出为合成数据。

重跑需调整 probe.mjs 中本机依赖绝对路径，在允许回环监听的隔离目录执行 `node --check probe.mjs` 和 `node probe.mjs`。`--codex-only` 跳过已留存的 Claude 检查；`--codex-only --never` 只验证拒绝策略。不要连接日常 HOME 或真实模型。audit.py 使用原实验目录名；审计归档时须将其目录映射到 attempt-1／2／3 并解压日志，不需再次启动原生程序。

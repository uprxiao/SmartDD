# F15 安装、版本与 DeepSeek 真实端点验证

2026-11-14。结论：F15 的研究决定关闭；当前产品并未获得新的已支持组合。设计正文见[技术方案 §12](../../技术方案.md#12-运行资源配置与版本)，研究计数见[验证账 §7.6](../../全局设计验证账.md#76-逐项研究关闭审计与冻结清单2026-11-14)。

## 实际执行与结果

| 证据 | 结果 | 能证明的范围 |
| --- | --- | --- |
| [真实 DeepSeek](deepseek-result.json) | 两段均成功；一次工具调用；新进程恢复同一会话并准确复述合成标记 | macOS arm64，Claude SDK 0.3.321／native 2.1.321，官方 Anthropic 兼容端点，deepseek-flash；基础工具与恢复可行 |
| [当前资源注册器](registry-result.json) | 7 项通过 | 实际 ResourceStore／AgentAdapterRegistry／迁移代码，隔离数据库和四个仓库适配包；版本声明、L3、缺文件、版本冲突的真实分支 |
| [T3 策略纯函数](policy-result.json) | 3 组通过 | 未修改的兼容策略和 semver 函数经 TypeScript 擦除；合成版本区间、应用范围和最低版本边界 |

三种证据不相加为产品验收数量。注册器复用实际源码 bundle，执行前重新核验其 681 个源码输入摘要，[核验记录](source-verification.json)保留 bundle hash。T3 不是完整服务或仓库测试；本机没有可用 vp，本批未运行 T3 测试套件。合成 broken／最低版本不代表某个实际厂商版本已知有缺陷，也不构成真实模型最低版本声明。

DeepSeek 使用独立临时 HOME、空合成工程、settingSources=[]、无内置工具，仅首段允许无副作用的进程内 MCP fixture.emit_token。第二段使用新原生进程及同一 session ID，无工具。两个自有子进程正常退出；临时 HOME／工程已删除。只发送合成文本，没有读取项目代码、接私有业务桥或发送邮件。凭据经无回显标准输入进入临时进程环境，不写配置或证据。日志保留 unrecognized_model 警告，同时保留真实成功终态，不能仅据警告判定失败。

该结果不是跨 Provider 切换、子 Agent 模型路由、业务来源授权、所有 MCP 类型或所有版本验证；这些按原 F03／F04 等合同继续处理。SDK 返回的 num_turns／usage 不是抓包所得 HTTP 请求计数或确切账单。

## 源码和复核

[source-manifest.json](source-manifest.json)固定本轮直接参考文件及仓库基线。[证据归档](evidence.tar.gz)、[文件清单](archive-manifest.json)和[归档摘要](archive-summary.json)包含原实验脚本、原结果、实际 SmartDD bundle／其 681 项来源摘要和四个适配包输入快照；不包含用户凭据、原生二进制或用户数据库。脚本中的绝对路径记录原执行环境；迁移重放时须显式替换依赖路径并核对摘要，不宣称可在任意机器直接运行。

- registry.mjs：依赖原实际 bundle、better-sqlite3 及清单；NODE_PATH 指向隔离依赖目录。正式重放前确认源码未漂移；不改 adapter 元数据来获得 L3。
- policy.mjs：依赖固定 T3 checkout 和隔离 esbuild；仅提取纯函数。
- deepseek.mjs：依赖固定 SDK／native，其 native 摘要在脚本中校验；需要另行提供有效测试凭据，会产生真实 API 用量。归档校验不执行它，不重复计数或消费。

本次归档只做离线结果断言、来源摘要、文件完整性和凭据格式扫描，没有再次进行付费调用。相同源码实验不为归档重复执行。

## 外部依据和限制

[DeepSeek Anthropic 兼容说明](https://api-docs.deepseek.com/guides/anthropic_api/)确认兼容端点及工具消息协议；[Claude Code 接入说明](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/)给出端点、鉴权及模型环境配置。本次显式使用 deepseek-flash，并非据模型别名映射推定实际模型。服务端忽略 mcp_servers 字段不等于客户端 SDK 本地 MCP 无法使用。

真实 Electron 首装／ASAR／签名／Finder／代理及各目标平台运行仍按 A51 执行。F03 负责持久输入与 live 来源，F04 负责现有配置来源，F06 负责执行范围，F10 负责最终资源回收；本批不将这些依赖归零。

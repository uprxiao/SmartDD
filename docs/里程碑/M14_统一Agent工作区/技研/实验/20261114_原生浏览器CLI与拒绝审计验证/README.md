# 原生浏览器 CLI 与拒绝审计兼容

2026-11-14；技术方案 §9.7.1，验证账 §4.69；R02／03／05／08／10，Q09／27／28／37。仅隔离研究，产品／共享原型未改。

## 真实链路与五项检查

`Codex exec_command／Claude Bash → 当前源码编译的 willyou-app → ApplicationCliGateway → MacUnixPeerIdentityReader → ApplicationToolService(entry=cli) → 原 BrowserModule／context／BrowserService`

本批不再由研究宿主直接替 Agent 调用业务工具。模型端点为本机受控响应，按固定步骤要求每个真实原生运行：读取自己的空标签列表 → 未授权读取其他 task（SCOPE_DENIED）→ 申请跨任务授权 → 宿主允许后再次读取。每一步最新工具输出进入下一模型请求，三个 run 各五次请求。原生运行固定 Codex 0.167.1、Claude SDK 0.3.321／native 2.1.321。

| 检查 | 结果 |
| --- | --- |
| N01 真实二进制＋错误进程树 | 研究宿主直接启动同一 willyou-app，并给它有效临时 token；内核对端可核验但不属于 Agent 祖先链，返回 PEER_MISMATCH |
| N02 父子分别授权 | Codex 父、Claude 子的原生 shell 各完成实际 CLI 流程；等待的授权分别绑定父／子 run；批准 control／observe 后读成功，未批准之前被拒 |
| N03 停旧父 | 原父停止、旧 token 再经真实 CLI 返回 AUTH_REQUIRED；旧 owner 业务入口拒绝，仍活跃子的 grant 保留 |
| N04 同 task 新 Provider | 新 Claude run 保留父 task，但重新经过 CLI 未授权拒绝与独立申请，不能继承旧父 grant |
| N05 排空 | 三个原生 run 及业务活动结束、授权清空；所有记录的 CLI peer PID／出生身份核验 stopped；宿主 BrowserService 在运行停止后才由实验最终关闭 |

最终 attempt-btSYF5，五项通过。25 份真实内核 peer 证明：三个原生根各八份（四条 CLI 命令各发现＋调用），另一个属于错误祖先反例；旧 token 拒绝在读取 peer 前发生。12 条业务调用＝6 条成功读取、3 条获批授权、3 条未授权读取拒绝。三次授权返回 completed 不代表修改网页。首批 attempt-iJQGuD 已通过相同五组，随后补旧 token 实际请求与 peer 退出断言复验；两批六个 native 最终退出，共 30 次本机模拟模型请求。

## 现有审计缺口与候选迁移

真实 CLI 拒绝正确，但 capability_broker_denials 无记录。当前 0028 表约束只允许 MCP 方法，且已知 run 要求同时有 bridge_id；CLI 网关实际写 cli-parse／cli-list／cli-call／cli-cancel，且没有 MCP bridge_id。原 Gateway.denial 捕获 SQLite 失败后返回 auditUnavailable，CLI refused 又只输出 error／requestId，调用端看不到顶层审计状态。

复制 final.sqlite 的最小复现直接调用未修改 Gateway.denial，确认 auditUnavailable。候选表重建扩展四个 CLI 方法及独立 CLI 行形状：CLI bridge_id 必须空，run_id 可为空；MCP 原来的成对约束保留。原方法无需改造即可对 4 方法 × 已知／未知 run 写出 8 个 auditId。旧行保留、事务中途失败回滚、无桥已知 MCP run 拒绝、伪 CLI bridge 拒绝、未知 method 拒绝均已检查。不是正式迁移编号，也未修改用户数据库。

迁移方案必须明确该补齐：不能伪造 bridge_id 绕过检查；审批／鉴权拒绝仍按失败返回，审计写失败另展示可恢复诊断。统一 UI 不应依赖当前 CLI 输出恢复完整审计状态，需从宿主投影读取，或明确扩充并版本化 CLI 返回字段。CLI 输出传播 auditId／auditUnavailable 尚未实施或验证。

## 范围和复跑

Electron 原生窗口／session 分配被禁止，只有空 tab 列表；没有真实网页、登录态、网页写、输入／下载、真实 renderer 批准、远程供应商或平台沙箱能力验证。Codex 使用实验私有 danger-full-access thread、Claude 允许固定 Bash，业务授权依旧由真实 CLI 网关核验；不据此声称原生只读隔离。资源定义来自当前源码，但 bundle runtime hash 重绑至研究桥；不是正式发布资源证据。

编译：在 SmartDD 根目录执行归档 build-cli.mjs，输出临时 willyou-app；归档 cli-source.mm 和 cli-binary.json 保留源码／二进制哈希。运行 probe.mjs，再运行 audit-schema.mjs（只写复制 SQLite）。baseline.sqlite 为原快照，working／after 为候选结果，initial-working-copy 为首次同一 Schema 实验的工作副本。SDK/native 与依赖固定，全部 HOME、数据、模型端点临时隔离。

[结果](result.json)、[运行／Schema 审计](runtime-audit.json)、[源码依据](source-review.json)、[摘要](archive-manifest.json)、[原始脚本／模型协议／SQLite](raw-evidence.tar.gz)。468 文件，16 份 SQLite 完整性与外键通过，1097 构建输入核对。

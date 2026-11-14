# 跨 Provider 结果的真实传输与未知读取恢复

2026-11-14；R03／04／05／06／12，Q14／19／24–28／54。验证账 §4.58，技术方案 §7.2.3。技术研究，产品和共享原型未改。

## 验证目标与实际路径

沿用 §4.57 的同一逻辑 task、两个 binding、程序化私有 run 和 ExecutionPlan。结果处理不再仅由驱动直接调用：Codex 0.167.1 通过 app-server 的实验性 dynamicTools／item/tool/call，Claude SDK 0.3.321／native 2.1.321 通过 createSdkMcpServer 的进程内 MCP，调用同一个候选 Results 服务。运行权限由闭包保留的私有 run 核验；不接受模型传入的 run 或 task 身份。

预置两个合成子结果。本机 HTTP 端点返回固定工具调用，记录 SDK／原生实际发出的下一次模型请求；断言其中包含结果正文、revision 和观察 token。不是仅检查工具返回值，也不是模型口头说“读到了”。没有真实子 Agent、供应商调用或模型自主决策。

## attempt-YtlGCF：T01–T04

| 检查 | 证据 |
| --- | --- |
| T01 | 真实 Codex 动态工具读取已提交，但驱动持有回包；实际停止 Codex 后丢弃该响应。只有一次本机模型请求且不含结果正文；结果仍 unobserved，父切换被 offered 记录阻止 |
| T02 | 原 run 排空后把未确认读取转 unknown，切换仍拒绝；隐式恢复理由拒绝；明确夹具操作废止原观察 token 后才切 Claude，保留结果与未观察状态，不重新启动子任务 |
| T03 | Claude SDK 的进程内 MCP 重新读取同一结果，下一模型请求含正文及新 token；原 Codex token 的实际工具确认被拒绝，新 token 确认一次；四次模型请求、三次工具调用 |
| T04 | 排空后切回 Codex generation 2，通过同一结果服务读取第二个结果并确认；三次模型请求、两次工具调用。另由宿主重放同一有效确认，回原收据，不增加计数 |

三个捕获原生退出为 Codex 0、主动关闭的 Claude 143、Codex 0；所有 run stopped、运行资源租约 released。八次本机模型请求、零供应商请求，最终两个结果分别确认一次。没有重试失败轮。

## 对设计的影响

上一批仅规定 offered 阻止切换，还没有验证其跨 run 恢复出口。本批补齐候选：旧 run 排空后 offered → unknown；没有可靠消费证据时不自动确认或自动重发；由可信用户入口明确废止旧观察尝试，保留未观察结果，再由新 run 显式读取并取得新 token。处置记录、结果身份与正文不能被这个操作删除。

这项“用户入口”只是设计合同。实验调用的是 fixture-explicit-reinspect-unread-result，未验证产品授权界面、权限实现或真实用户批准；不能在真实任务上由后台自动执行。held-response 精确证明本次确实尚未把正文回给原生程序，但一般网络断开不能得到相同判断，因此设计按 unknown 处理。

候选接口将读取和确认分开。T3 当前本地源码的 task_status 文案是读取即标 delivered，OrchestratorMcpService 在返回结果前派发 completion-delivery.acknowledge。WillYou 的二步 token 合同是为其当前 run／恢复需求补的设计，不是声称 T3 已提供同样 API，也不把本实验当作 T3 缺陷证明。它增加模型往返成本；Skill／适配器需要规定确认时机，不能默认每个模型都会遵守。未来若改为传输回执，必须给出相同消费／失联语义的证据。

传输适配与宿主结果服务可以解耦：本批两个入口调用同一服务，但不规定生产 Codex 必须用实验性 dynamicTools；可以选 MCP 等已支持入口，按该版本能力检测。实验性字段不属于“全部版本都支持”的承诺。

## 限制与剩余验证

本批没有业务 ApplicationToolService／私有进程桥，没有四类业务 MCP 回归，也没有使用其授权证明替代结果服务私有 owner 校验。取消发生在宿主活着且持有响应的受控点，不是宿主崩溃、部分 socket 写入或原生已经消费而 ACK 丢失；这些与 §4.31 证据分别记录，不能相加为当前最终 Schema 全链。未测试自动通知、实际子问题／取消迟到、整棵任务树、真实 UI、完整历史交接及 SDK 的其他版本。

## 证据与复跑

[结果](result.json)、[运行审计](runtime-audit.json)、[源码对照](source-review.json)、[哈希清单](archive-manifest.json)、[完整临时驱动及数据](raw-evidence.tar.gz)。共 124 个归档文件，5 份 SQLite 完整性和外键通过，506 个唯一构建输入核对。

Codex schema 由固定原生包执行 app-server generate-json-schema --experimental 生成，归档仅保留本批使用的三份定义。复跑先执行 build.mjs／profile-build.mjs，再 probe.mjs；使用隔离 HOME、临时工作区、合成凭据和本机端点。默认不对日常任务执行恢复处置。

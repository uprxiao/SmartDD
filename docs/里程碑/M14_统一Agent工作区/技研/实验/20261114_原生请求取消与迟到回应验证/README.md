# 原生请求取消、迟到回应与请求关闭语义

2026-11-14；R02／03／08／10／12，Q01／04／11／12／27／28／43。技术方案 §4.4.1，验证账 §4.60。仅技术研究，产品和共享原型未改。

## 联合范围

Codex 0.167.1 与 Claude SDK 0.3.321／native 2.1.321 经实际 HTTP MCP 发起表单；沿用程序化私有 run、ExecutionPlan、gated launcher，回应前再核实际 run。复用先前规范请求候选 Kernel，包括完整作用域、typed native ID、revision、commandId、字段校验和私有 UI 句柄。本机固定模型选工具，合成表单不包含真实用户输入。

每个 Provider 独立一个逻辑 task，先中断 generation 1，再打开 generation 2。两个新运行同时持有表单，用于跨 Provider 作用域拒绝；不是同一 task 的 A→B 历史交接，不是完整父子树。没有真实 renderer IPC 或业务审批。

## attempt-EQVTjb：E01–E04

| 检查 | 证据 |
| --- | --- |
| E01 | Codex 待回应时先撤销候选 live callback，再真实 turn/interrupt；回合 interrupted，MCP 收到 cancel。排空后新 generation 的原生 RPC id 仍为数字 0，但宿主 requestId 不同，旧回应和直接旧 send 均拒绝 |
| E02 | Claude 待回应时同样撤销 callback 并 query.interrupt；原 options.signal 实际 aborted，匹配 result 为 error_during_execution／aborted_tools，MCP 收到 cancel；排空后下一 generation 使用新 callback，旧回应拒绝 |
| E03 | 两个新 Provider 请求同时 pending。跨 Provider scope、旧 run requestId、count 超范围和伪造 UI 句柄均拒绝，原生发送数为零 |
| E04 | 各自合法回应发送一次；重试同 commandId 不再次发送；真实 MCP 收到 accept 和精确 content，随后原生模型请求含工具结果，两个回合完成。候选适配器不把 write／Promise resolve 当 applied，收据保留 unknown |

四个捕获原生退出：Codex 两次 code 0，主动关闭 Claude 两次 code 143；所有 run stopped、租约 released。六次本机模型请求，零供应商调用。原生 JSON 中的 costUSD 是对合成 token 数的本地估价，不是实际模型收费。

## 决定性的反例

**Codex 的 serverRequest/resolved 在取消与正常接受两条路径都出现。** 两条通知都只含匹配 threadId 和 requestId，没有答案／action／接受原因；单独看到它不能认定用户已同意或原答案被接受。两个进程重用数字 0 也实证了不能全局按原生 ID 寻址。

**Claude form 的 ElicitationResult hook 本轮没有 elicitation_id 或控制 requestId。** 它含 session、prompt_id、serverName、action 和 content。SDK 类型把 elicitation_id 作为可选值，说明 hook 发生在结果发给 MCP 之前；本批只观察一张表单，未验证同 server／prompt 并发时的唯一对应，不能把该 hook 单独当所有表单的精确回执。

协议存在结果信号不等于所有信号可直接映射 applied。回调已关闭／请求不再等待、宿主记下的用户选择、对应回应是否被原生消费、后续业务是否成功，是不同事实。

## 对设计的约束

保留三部分：决定记录（commandId、摘要和来源）、投递记录（回调／连接代次及证据）、请求活性（pending／关闭／取消）。宿主知道用户选了什么，不等于知道远端接受了什么；请求结束不构成新的插件、邮件或浏览器授权。

本批复用 Kernel 的状态较粗，故适配器发送后返回 unknown；这是保守探针，不是要求产品每次正常回答都弹人工恢复。正式投影可结束已经可靠关闭的等待卡片，同时保留“已提交，是否生效未确认”的投递诊断；禁止自动重发，并按实际操作账与切换门禁继续处理。最终三维 Schema／迟到信号对账尚未实现和验证，不能把本轮通过称为所有回应恢复已完成。

停止顺序为先撤销宿主 callback／回应入口，再中断原生并排空，最后失效旧运行身份。只更新 UI 状态或仅依赖 SDK 的 abort signal 均不足以替代当前私有 run 检查。取消回包与原用户批准必须区分；内部 cleanup 返回 cancel 不产生用户许可。

## 尚未覆盖

原生命令／文件写审批的所有 decision、同一原生会话多个并发表单、URL／复杂字段、用户提交与取消同时越过发送边界、部分回包、宿主崩溃、已投递结果的最终对账、真实 UI 和父子委派链未在本批通过。actual MCP 接受的观察来自隔离服务，不能假定产品能读取第三方服务器内部状态。T3 仅源码对照其 live providerSessionId／pending callback 边界，未执行 T3 服务或 UI。

## 证据

[结果](result.json)、[运行／信号审计](runtime-audit.json)、[源码基线](source-review.json)、[哈希清单](archive-manifest.json)、[驱动、协议帧及数据库](raw-evidence.tar.gz)。131 个归档文件、7 份 SQLite 完整性与外键通过、506 个唯一构建输入复核。

在隔离 HOME 和本机端点复跑 build.mjs、profile-build.mjs、probe.mjs。所有进程由启动句柄停止，不向日常 Agent 会话发送测试回应。

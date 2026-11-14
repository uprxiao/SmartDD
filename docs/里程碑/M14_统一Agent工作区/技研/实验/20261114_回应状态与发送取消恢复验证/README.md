# 回应状态、发送与取消竞争及宿主退出恢复

2026-11-14；R02／03／08／10／12，Q01／04／11／12／27／28／43。技术方案 §4.4.2，验证账 §4.61。仅独立技术验证，产品／共享原型未改。

## 目标和方法

§4.60 确认原生请求关闭不能直接当答案接受；其旧 Kernel 又把正常投递统一记 unknown。本批提出最小三部分账：决定、投递事实、请求活性。复用真实 Codex accept／cancel 两条路径的原始 request／serverRequest/resolved 帧，使用实际 ResourceStore、协调锁和 Mac PID／出生身份；候选 SQL 和 responder 仅放在临时目录。

不再重复启动原生 Agent。发送端为受控 Promise 或追加合成 JSON 的文件，以便精确制造返回前／后的时序；五个真实 worker 在检查点由捕获的 ChildProcess 句柄 SIGKILL。该方法验证宿主持久状态与调度，不证明真实 socket 所有字节窗口、OS 断电或 CapabilityRunRegistry 已接入新账。

## attempt-KXnlCC：13 项检查

| 检查 | 结论 |
| --- | --- |
| S01 | 决定提交后不再等待用户；投递 submitted 且原生请求 closed 后也不等待原生。消费仍 unproven，没有补造批准；重复 commandId 不再发送 |
| S02 | 真实取消路径的关闭帧先到时，之后不能新提交决定；仅请求 closed，不生成用户同意 |
| S03–04 | 发送前取消拒绝派发；即使已持久发送意图，活着的同一闭包尚未调用发送端且门闩关闭，仍能证明 not-sent，发送次数为零 |
| S05 | 发送已在途时取消先记 unknown，迟到的发送完成可补 submitted 事实，但请求仍 expired，不重新等待或复活 |
| S06 | 请求关闭与投递失败交错，得到 closed＋unknown；关闭事实和投递不确定同时保留 |
| S07 | 复制私有句柄、不同 connectionId、数字／字符串原生 ID 混用及损坏 inbox scope 均拒绝；损坏事件不能关闭新请求 |
| S08 | 决定写入失败完整回滚；同命令不同值、同请求第二决定拒绝，不留下可发送的半份收据 |
| C01 | 决定 prepared 后宿主死亡：原 callback 失效，投递 not-sent，不自动恢复 callback 或发送 |
| C02 | 发送意图提交后死亡：unknown，即使本夹具实际上尚未写发送文件；不能凭缺回执证明未发送 |
| C03 | 合成发送已完成、submitted 未记账时死亡：unknown，发送文件保留一次，恢复不重发 |
| C04 | submitted 已提交后死亡：保留 submitted，原 live 请求过期；这仍不代表原生消费 |
| C05 | 精确关闭帧已入 inbox、尚未应用时死亡：恢复原子应用 closed，保留 submitted，重复恢复一致 |

五个 worker 均取得 SIGKILL 终态。每次恢复前分别验证原 owner 存活和 unknown 都拒绝接管，确认出生身份已 stopped 才允许审计恢复；返回 liveGrant=false、automaticRetry=false。新的进程不能由持久 requestId 复造 live callback。

## 已验证的候选合同

决定使用稳定 commandId、原 requestId／作用域和内容摘要，只允许该请求的一个明确决定；事务提交失败不派发。投递记录 prepared／dispatching／submitted／not-sent／unknown，submitted 只说明本次发送函数已正常完成，不承诺原生接受或业务成功。请求活性独立为 open／closed／expired。

正常完成可以投影为“回应已提交，原生请求已结束”，无需一直保留“等待你回答”。关闭事实不消除投递未知，也不解除其他业务操作／目录／运行的约束。取消后迟到的传输事实只更新原记录，永不恢复入口或自动改投下一 Provider。

活着的启动闭包能证明未调用发送端，和宿主退出后只剩发送意图，是不同证据。前者可落 not-sent；后者必须保守 unknown。发送前取消 gate 与状态持久化顺序已经在受控交错中实跑，实际跨进程调用入口仍需接入同一 owner／协调边界。

inbox 保存原连接作用域摘要和原始帧，校验 typed native ID；应用关闭投影与 processed 标记同事务。回放源来自 §4.60，而不是本批重新跑出的原生结果。

## 限制

本批不含真实 Agent、业务写入、实际窗口／IPC，也未联合最终 CapabilityRunRegistry。回放仅覆盖 Codex 的请求关闭帧；Claude 缺唯一 form ID 的 hook 不被本合同猜测匹配。秘密答案没有进入夹具；生产的 secret／敏感字段仍需引用现有受保护存储，不能照搬本批合成 value_json 明文。

新的三部分 ledger 是 WillYou 候选，不宣称 T3 使用相同表。未知传输的人工处置、原生命令／文件审批、同连接并发请求、部分 socket、业务副作用对账及完整产品恢复仍按全局账推进。不是“所有请求恢复已验证完毕”。

## 证据

[结果](result.json)、[worker 与恢复审计](runtime-audit.json)、[源码及回放来源](source-review.json)、[归档摘要](archive-manifest.json)、[驱动／协议／SQLite](raw-evidence.tar.gz)。60 个归档文件、14 份 SQLite 完整性和外键通过，370 个构建输入复核。

复跑 build.mjs 后运行 probe.mjs；只结束脚本捕获的 worker。所有状态与合成发送文件均在临时目录，不操作日常会话。

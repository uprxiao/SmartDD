# M14 Codex 二次修订核对

日期：2026-11-16。输入：[二次复核](二次复核.md)。现行基线：[需求 R1.1](../../需求.md)、[技术方案 T1.1](../技术方案.md)、[验证账 V1.1](../全局设计验证账.md)、[用例 A1.1](../../验收/测试用例.md)。本轮完成设计修订和真实模型研究，尚未正式开发、制作新原型或做真实 App 验收；原报告 §7 的决定未改。

## 1. 对照二次复核 §5 的关闭条件

| 条件 | 处理结果 | 证据位置 |
| --- | --- | --- |
| 1．C01：补齐五项政策，真实 T3 源码对照并复跑 | 已完成。notification、thread_created 纳入；fork、secret_request、link_request 各写删减理由；dynamic_tool 明确改名。测试从固定提交的 Git 对象用 TypeScript AST 提取外层 Union，解析 spread 与 as const。旧五项遗漏的负对照会产生精确缺口，未知条目不能靠诊断兜底通过 | [T1.1 §4](../技术方案.md#4-统一时间线模型c01)；[提取器](../实验/20261116_复核修订验证/t3-baseline.mjs)；[replay.test.mjs](../实验/20261116_复核修订验证/replay.test.mjs)；[源码 SHA／25 成员与政策](../实验/20261116_复核修订验证/results/t3-baseline.json)；[34 项回放全通过](../实验/20261116_复核修订验证/results/timeline-replay.json) |
| 2．C15：三类边界、同步／异步选择、真实双向可写实验 | 已完成。本期固定异步收据，写子等父回合自然结束、输入冻结与工具／后台／业务排空；Claude result、Codex turn/completed、ACP prompt stopReason 分别对账，无证据时准确 owner 退出后交槽。同步阻塞等待写子不启用。W1 Codex 父→Claude 子、W2 Claude 父→Codex 子均通过四个核对点 | [T1.1 §6](../技术方案.md#6-委派方案-b-与后台结果)；[实验四点对照](../实验/20261116_二次复核修订验证/README.md#2-c15-四个核对点)；[实时结果](../实验/20261116_二次复核修订验证/results/writers-result.json)；[宿主顺序](../实验/20261116_二次复核修订验证/results/writers-host.jsonl)；[原生录制](../实验/20261116_二次复核修订验证/results/writers-native.jsonl.gz) |
| 3．插话：补真实验证或明确无证据只排队 | 已完成真实验证，同时保留能力门槛。Codex 工具在途时 turn/steer 返回原 turnId，同回合最终答复采用新指令；Claude SDK 工具在途时消费第二输入，唯一 result 采用新指令。未验证的执行器版本／模式、探测失败或当前状态不允许时只排队；输入流写成功不能单独作为接受证据 | [R1.1 R01](../../需求.md#m14-r01-统一任务界面与手动终端rc3rc7)；[T1.1 §5](../技术方案.md#5-provider-切换交接与输入)；[两端真实结果](../实验/20261116_二次复核修订验证/results/steer-result.json)；[时序](../实验/20261116_二次复核修订验证/results/steer-host.jsonl)；[原生录制](../实验/20261116_二次复核修订验证/results/steer-native.jsonl.gz) |
| 4．顺手修订 §2.3、§2.4 | 已完成。ACP max_turn_requests／refusal→failed，max_tokens→输出受限且不自动重试／不伪造额度重置时间，未知原因→failed。Claude parent_tool_use_id 内部输入、流与工具归属对应 subagent node，子结果不结束父回合。首轮 README 的重复“复跑命令”已合并 | [T1.1 §4](../技术方案.md#4-统一时间线模型c01)与 §9；replay 中 6 个 stopReason 检查及子节点隔离检查；[首轮 README](../实验/20261116_复核修订验证/README.md) |

## 2. C15 实际通过范围

两组在各自同一共享 cwd 使用真实原生文件工具。父收到 queued 后继续写 parent-after.txt，原生回合终结、准确 owner code 0 退出后才派发子；子用 Python 生成 UUID 写 child.txt，返回的结果 JSON 不含 UUID；宿主送回完成引用，原父 thread/session 恢复后实际调用 wy_observe、读文件并写 parent-observed.txt，与子文件随机值一致。

**本次真实证据是 owner 退出后的保守交槽；没有宣称 owner 存活时交槽、ACP 后台排空或生产调度器已验。** 原 pausedNoWrites 候选已替换为明确的回合终结／输入冻结／工具和后台业务排空条件，[15 项候选验证](../实验/20261116_复核修订验证/results/runtime-contract.json)全通过，仍只算候选层。存活 owner 优化须在正式开发后另行验证。

插话证据局限：使用受控 MCP 等待门，未模拟模型响应；只覆盖已记录的本机版本、真实模型和模式。Claude result 的 user_message_uuid 仍是第一输入，未伪造第二输入的逐条 ACK 或幂等保证。实际接受由工具在途时提交、新指令进入流和真实回答采用随机标记共同证明。

## 3. 同步产物与保留证据

- 验证账 Q01/Q12/Q31/Q32 及 R01 接续已同步；V09 的逐轮 reviewer 与 resume 证据引用[二次复核 §3](二次复核.md#3-本次补充的真实验证-v09)，不重复计为本轮新调用。
- A32/A52/A55/A59/A60 的步骤和预期由[编制脚本](../实验/20261116_复核修订验证/编制验收文档.py)同步生成；原型文字状态与兼容计划同步。产品用例仍为 54 条适用、0 通过、54 未执行，9 条范围外；研究测试不计入产品通过率。
- [二次实验 README](../实验/20261116_二次复核修订验证/README.md)提供环境、复跑命令、失败／修正和边界；[录制清单](../实验/20261116_二次复核修订验证/results/recordings-manifest.json)记录原件与脱敏入库 SHA。准确 owner 均正常退出，监听关闭；未复制凭据或修改日常配置。
- 修订前 R1.0／T1.0／V1.0／A1.0 等完整历史整稿保留。首轮 replay／timeline／runtime-contract 及结果的原字节由[before.json](../实验/20261116_二次复核修订验证/before.json)核对，能与首轮交付清单 SHA 对上；原失败未覆写为新通过。
- 原[首轮修订核对](Codex修订核对.md)是当时交付记录；其 C01“全部覆盖”、C15 暂停候选的过宽结论由本回执更正，不再作为现行关闭依据。

## 4. 最终校验

当前结果以[本轮校验清单](../实验/20261116_二次复核修订验证/results/final-checks.json)和[交付快照](../实验/20261116_二次复核修订验证/delivery-manifest.json)为准；原报告 §7 的完整段落 SHA 与修订前一致。生产源码与依赖没有改动，未提交、推送或发布。

可交 Claude 再次独立复核本表三个必需关闭条件。原型视觉评审、正式开发、全部真实 App 用例及已登记平台／业务缺项继续按阶段流程推进。

# M14 二次复核修订验证

日期：2026-11-16。依据：[二次复核 §2、§5](../../复核_20261116/二次复核.md)、[需求 R1.1](../../../需求.md)、[技术方案 T1.1](../../技术方案.md)。这是隔离研究与真实模型实验，未接生产代码、未构建 App，不计产品用例通过。原报告 §7 的 D1–D5 没有修改。

## 1. 结果与证据边界

| 项目 | 实际执行与证据 | 局限 |
| --- | --- | --- |
| C01 | [当前 replay](../20261116_复核修订验证/replay.test.mjs)从固定 T3 提交 `fe59fa44d0f12ba1e58b1cccc2c888ac99e743da` 的真实 Git 对象读取 Schema，TypeScript AST 提取 25 个外层条目（解析 `as const` 与 spread）。[类型、来源 SHA 与政策](../20261116_复核修订验证/results/t3-baseline.json)；[34 项回放结果](../20261116_复核修订验证/results/timeline-replay.json)全通过，含旧五项遗漏的负对照 | notification/thread_created 的宿主映射是合同夹具；不是新 UI 实现。fork／secret_request／link_request 有明确范围排除 |
| W1 Codex 父→Claude 子 | [双向结果](results/writers-result.json)、[宿主顺序](results/writers-host.jsonl)、[原生记录](results/writers-native.jsonl.gz)：父委派 queued 后仍写 parent-after.txt，结束回合并退出；子随后写 child.txt；原父 native thread 恢复，领取结果并实际读文件，写 parent-observed.txt | 真实模型与原生文件工具＋候选宿主调度；当前验证的是 owner 退出后交槽 |
| W2 Claude 父→Codex 子 | 同上；原父 native session 恢复，读取随机 UUID 与子文件一致 | 两组均共用各自同一个 cwd；没有并发写入；不推广为所有后台进程、存活 owner 交槽或 ACP 写入调度通过 |
| Codex 插话 | [插话结果](results/steer-result.json)、[宿主时点](results/steer-host.jsonl)、[原生记录](results/steer-native.jsonl.gz)：真实模型先调用受控 wait_gate；工具未返回、回合未结束时提交 turn/steer，ACK 的 turnId 与原回合相同；释放工具后同回合回答包含新随机标记 | MCP 工具是合成等待门，模型和 app-server 为真实；没有修改模型端或模拟其回答。未测任意工具、无工具的推理中途及所有版本 |
| Claude 插话 | 同上；真实 Claude SDK AsyncIterable 在 wait_gate 未返回时写入第二输入，之后唯一 result 采用新随机标记 | result.user_message_uuid 仍指首输入；没有为第二输入伪造独立 ACK。流已消费＋真实回答采用新指令共同证明此路径；不是逐输入 ACK 的通用幂等保证 |
| 原生子消息／ACP | 回放新增 parent_tool_use_id 的节点隔离；ACP end_turn／cancelled／max_turn_requests／refusal／max_tokens／未知原因的终态检查 | 定向语义夹具，未新增 ACP 真模型配额／拒绝故障实验 |
| 资源收尾 | [写入实验清理](results/writers-cleanup.json)、[插话清理](results/steer-cleanup.json)与各 host 日志：6 次写入调用、2 次插话调用的准确 owner 均 code 0／signal null；无剩余登记 owner，两个 HTTP 监听关闭 | 仅操作本轮独立实例，没有终止日常 Agent |

环境：macOS arm64、Node v22.23.1、本机 codex-cli 0.169.0（现有 ChatGPT 订阅）、Claude Code 2.1.325＋锁定 Claude Agent SDK 0.3.321（DeepSeek `deepseek-flash` 真实端点）。完整版本回执见 [writers](results/writers-versions.json)、[steer](results/steer-versions.json)。Claude 使用新 HOME／CLAUDE_CONFIG_DIR，第三方 MCP 清空模型 Key；Codex 禁用发现到的日常 MCP、apps 和插件，沿用现有原生登录，未复制 auth.json、未修改用户配置。

## 2. C15 四个核对点

| 关闭条件 | W1 | W2 | 直接证据 |
| --- | --- | --- | --- |
| 父释放前子不启动 | 通过 | 通过 | host 的 delegate-queued、dispatch-blocked（childStarted=false）、native-turn-completed、owner-exited、writer-slot-released、child-dispatched 严格排序 |
| 父子没有交叠写入 | 通过 | 通过 | writers-result 的三个 invocation interval 不重叠；原生 command/tool_use/result 逐个对账无 pending，父退出早于子调用 |
| 结果返回父 | 通过 | 通过 | completion-delivery 后，真实父模型调用 wy_observe；不是宿主替模型读取收据 |
| 父续跑读到子文件 | 通过 | 通过 | 子用 Python 生成随机 UUID，子结果 JSON 不包含 UUID；恢复原父 thread/session，真实 Read/cat 后写 parent-observed.txt，与 child.txt 一致 |

异步 receipt 与后续结果不是同一次同步 MCP 返回；本期不支持“父阻塞委派调用等待写子”。未测同步工具默认超时，不把旧同步 V01 的成功当方案 B 证据。ACP 的具体 prompt 终态／工具排空合同已写入 T1.1 §6，实际产品实现与验收另做。

## 3. 可重复核验与复跑

不调用模型的证据复核（从任意 cwd 执行，E 指本目录，FIRST 指首轮目录）：

```bash
python3 "$E/audit-evidence.py"
M14_T3_ROOT="$M14_T3_ROOT" node "$FIRST/replay.test.mjs"
node "$FIRST/runtime-contract.test.mjs"
python3 "$FIRST/audit-docs.py"
```

证据审计核对入库 SHA、宿主时序、原生工具完成、随机文件内容、同回合输入与真实 owner 退出，不只读取 passed 布尔值。[38 项结果](results/evidence-audit.json)全通过。真实回放需要当前项目锁定的 TypeScript 依赖和带固定提交的本地 T3 checkout；不需要原 scratch、登录或 Key。

重新调用模型时使用全新仓库外目录；M14_CLAUDE_SDK 指锁定 SDK 的本机 sdk.mjs，Claude Key 只来自既有环境（不要在命令中填写），Codex 需已有本机登录：

```bash
node "$E/real-async-writers.mjs" "$NEW_WRITERS_OUT"
node "$E/real-steer.mjs" "$NEW_STEER_OUT"
python3 "$E/archive-evidence.py" "$NEW_WRITERS_OUT" "$NEW_STEER_OUT"
python3 "$E/audit-evidence.py"
```

archive-evidence.py 只白名单提取原生事件；不复制 HOME、用户扩展库存、MCP argv 或凭据。新的归档会覆盖本目录 results，独立复核应先复制本目录到私有审阅目录再归档。当前实际输入路径与原件 SHA／入库 SHA 见[录制清单](results/recordings-manifest.json)，原件保持在独立临时目录。

## 4. 保留的失败与基线

- 写入实验 a1 在受限环境启动监听之前未形成有效实验记录；没有在运行的实例，a2 在获准的本机运行环境完成。a1 不计模型失败或通过。
- T3 AST 首次提取未解析 `as const` 包装，因而拒绝两个 spread 条目的判别式；修正解析后，真实 25 成员对照及原缺口负对照通过，未换成手写清单。
- 插话实测没有模型失败或重试；两端各调用一次。首轮 V08 maxTurns 的原失败继续保留在首轮目录。
- 修订前需求／技术方案的完整原字节在 before-requirements.md.original、before-design.md.original；正式历史整稿的链接仅重定位。修订前 replay、timeline、runtime-contract 脚本及结果也保留，本轮回执不把其当现行结果。首轮 delivery-manifest.json 是首轮时点快照，本轮使用独立交付清单。

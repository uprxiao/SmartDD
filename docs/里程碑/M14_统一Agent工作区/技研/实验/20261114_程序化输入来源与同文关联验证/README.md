# 程序化输入来源与同文关联验证

日期：2026-11-14。对应 Q17／Q41，设计见[技术方案 §6.1](../../技术方案.md#61-程序化输入的来源与原生身份关联)。固定 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1。两个真实 native 各执行三轮相同原文，本机假模型只返回文字，不加载或调用邮件／业务工具；消息中的草稿 URI 是合成身份，没有真实发送。

## 实证：native user 角色不等于真人来源

[native.mjs](native.mjs)将三条相同文字分别标为两条 ui-user 和一条 agent-delegation，并以相同原生 user 输入形态提交。来源标签由测试宿主控制，不是实际 Electron 用户输入。两端都完成三轮：Claude 原生行有不同 uuid；Codex 实时 userMessage 有不同 clientId／turnId。第三条也被 native 记录成普通 user，不能由 role 单独恢复宿主来源。

Codex 的这三条落盘行没有保存对应 clientId；payload.id 与实时 userMessage.id 也不同。落盘元信息有 turn_id，可与实时回执保存的 clientId→thread／turn／item 映射关联。本次仅每 turn 一条输入；不能推广为 steer／合并／多消息同 turn 全部兼容。Claude 本次原生行 uuid 与提交 UUID、result.user_message_uuid 对应，但 result 是后续终态证据，本轮没有验证发送邮件前实时取得来源所需的最早可用回执时点。

两个 native 均退出 0，共六轮；[原生结果](native/result.json)、原文、回执与原生记录分别保留。native 报告的 usage/cost 为假端点下的估计，不是实际模型账单。

## 负对照与候选验证

[replay.mjs](replay.mjs)回放六份实际 native 用户记录。当前运行、UI sender 和 L3 支持标识均为受控夹具：这里没有真实活动 owner、受信任 Electron 窗口或生产兼容登记。此边界不能因为读取了真实 JSONL 而省略。

负对照实际运行现有 NativeUserInputs＋NativeUserMessages＋NativeEvidenceAdapter，模拟一种应拒绝的迁移接法：把两条 SDK 用户输入伪造成 terminal observe。结果两端都把三份同文 native 记录匹配到第二条相同 receipt，inputSequence 都为 2；第三条原生 Agent 输入也被错误接法视作最新用户来源。它证明这条迁移捷径不成立，不是声称现有产品已经实施 SDK 接线或实际邮件误发。

[candidate.mjs](candidate.mjs)是隔离的 RAM 来源账候选：宿主分别提供用户入口和内部入口，保留原文摘要、scope、sequence、原生输入 ID、接受／unknown 状态及实际回执关联。真实用户仍须经过受信 sender；native 接受回调仅接受固定宿主 channel。历史／工具／委派／自动接续不产生真人 receipt。序列变化、失效或内部工作接续后，旧来源可以保留作历史，不能自动保持“最新用户指令”。

[临时 reader overlay](overlay/native-user-messages.ts)仅把原生 identity 从 parser 穿过现有 read／verify 匹配路径，不改原文件／inode／header／摘要复核。Claude 用 UUID；Codex 用保存的实时回执映射和原生 turn 身份，并对同 turn 同文的多条候选拒绝猜配。它是可执行设计草案，尚未实现正式 TypeScript 类型、运行时 Schema 和持久化服务；不是可以直接合入的正式实现。

| 回放检查 | 结果 |
| --- | --- |
| 两端旧文本匹配负对照 | 均重现三条 native 行映射到同一最新 receipt；作为被拒绝方案的反例通过 |
| 两端独立原生身份 | 两条用户记录分别匹配两个 receipt，现有精确文件 proof 可复核；旧条仍可保留但非 latest |
| 两端同文 Agent 接续 | 第三条无真人 receipt；旧用户记录均非 live，不产生新的 claim |
| 两端 unknown／回执关联 | unknown 不授予来源；错误 channel、ID、文本拒绝；用已有真实录制回执核对后可恢复来源，不重新发送 native 输入；重复 inputId 拒绝 |
| 两端 scope／过期／语义 | 伪造 sender、冒充 ui-user 的内部入口、换 binding／generation／session／cwd、过期及 abort 拒绝；实际邮件意图解析器仍要求具体草稿修订，拒绝引用示例、旧修订和未核实 unknown |
| Codex 标识差异 | 三条记录的 raw ID、live item ID、clientId 不同，turn 可关联 |
| Codex 同 turn 同文歧义 | 合成两条 receipt 指向同一 turn 的夹具得到 no-match；未实跑原生 steer，不能称 steering 已通过 |

共 **12 项回放检查**，不是产品验收数量。首次加载因临时目录缺 external better-sqlite3 解析路径，在任何回放前失败；[preflight.json](preflight.json)保留原因。补齐到既有隔离依赖的链接后，唯一实际回放批次[全部通过](replay/result.json)。没有为修复此夹具问题重跑 native。

## 对现有业务与 T3 的影响

- ApplicationService 现把 requireSender、runs.inputContext(taskId,ptyId)、NativeUserInputs、NativeUserMessages 和 mailAuthorizations 连接起来；SDK 需新增明确程序化输入入口，不能调用 observe／observeLaunch 冒充旧传输。
- MailUserAuthorizations 仍会核对来源 live／retained、输入时连接与政策摘要、当前具体 review、原文语义、claim 和原生 proof。contextLive 还比较 ptyId；改成新 scope 时须显式迁移这项比较，不能删字段后让两个 undefined 被当作同一来源。本轮仅实跑具体意图解析器，没有实跑整个 tryNative／confirm／send 链。
- PluginWriteApprovals 要求真实宿主写调用账、具体 reviewHash、displayReceipt 和当前运行／政策；BrowserAccess 是独立的 run 授权。程序化文本或 runtime 的工具批准不能替代这些业务授权。
- 本地 T3 Claude adapter 使用 prompt UUID／steer UUID 和原生 origin 协助回合关联；Orchestrator 保留通知 source、createdBy、creationSource 等宿主信息。这支持借鉴“宿主来源与原生关联分开”的结构，但不证明 T3 包含 WillYou 的邮件／插件授权合同。本轮仅源码核对 T3。

## 未覆盖与复核

尚未验证真实 UI sender、程序化输入与实际 owner／私有桥联合、输入提交和来源账的崩溃一致性、持续会话实时业务调用时的最早回执、原生 steer／合并／多模态、实际 MailUserAuthorizations／插件审批与浏览器授权接线、生产持久化迁移及重启。Q17／Q41 保持部分，正式验收仍 0／54。

[审计脚本](audit.py)和[结果](audit-result.json)核对六份原生内容／身份、进程收尾、12 项回放与未改源码摘要；来源版本见 [sources.json](sources.json)和 [build.json](build.json)。归档只保存本轮合成数据，不包括整个配置根／依赖或日常凭据。

重跑时调整脚本内本机依赖路径，先 `node build.mjs`、`node --check native.mjs`／`replay.mjs`，再在允许回环监听的隔离环境运行 `node native.mjs` 和 `node replay.mjs`。replay 使用 latest.json 指向的新实验原生根；归档的绝对路径只供原现场追溯，换机器需要重新生成独立 native 记录或明确重建夹具，不能把修改过的路径冒充原字节。离线审计归档需映射 native／replay 目录并解压日志。

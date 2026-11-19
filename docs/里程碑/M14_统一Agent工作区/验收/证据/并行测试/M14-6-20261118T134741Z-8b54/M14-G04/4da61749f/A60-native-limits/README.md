# A60 Claude 与 Codex 原生限流和输出上限

2026-11-19，新加坡时间。macOS arm64；冻结源 `4da61749fc24f8d05481b6139e276cf6c4afd5b0`、ASAR `39351e634975433afb8034cda4e3a387fbd534b3f982ad56b3f88e062864dbc4`。真实执行器收到隔离回环供应商响应。驱动对点击和实际回执取证，不生成 SDK 或 app-server 事件。

- 145 Claude 真实普通暖机完成。第二条输入在同一原生回合收到 8 个 HTTP 429，实际原生 JSONL 有持续的退避和重试元数据。100 秒观察期内没有自然终态，也没有新宿主回合／手动继续。收尾中明确停止本轮，App 正常退出 0。该次只证明真实原生重试与一次宿主派发；界面受限终态和手动恢复待验。[原结果](attempt-145/result.json) · [真实退出](attempt-145/quit-phase.jsonl)

- 146 Claude 确实收到标准 SSE 的 max_tokens，原生记录保留部分文本并在同一轮自己追加输出上限续接说明。夹具此前只认真人标记，把该真实原生说明误作未知输入，导致轮次未自然结束；App 清理后退出 0。保留原记录，修订前不把它算受限或恢复通过。[原结果](attempt-146/result.json) · [实际退出](attempt-146/quit-phase.jsonl)

- 148 Claude 真实收到 SSE 输出上限，同一原生日志先有部分文本，随后原生在同一轮续接三次，再由实际 SDK 产生输出受限。App 保留部分回答和「输出长度到上限」卡。观察窗口没有额外宿主回合，实际点击继续后才有一个新回合并恢复，App 正常退出 0。[受限](attempt-148/01-actual-native-terminal.png) · [真点击恢复](attempt-148/02-explicit-new-turn-recovered.png) · [结果](attempt-148/result.json)

[总用例逐项对照](../../A60-终态证据对照.md)

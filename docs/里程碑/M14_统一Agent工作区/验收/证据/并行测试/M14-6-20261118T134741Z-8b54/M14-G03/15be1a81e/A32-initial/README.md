# A32 第一批实包与 Claude 原生后台事件定位

候选 `15be1a81ebd66740d252d5835a8bee7b971dcd2e`，ASAR `1bbfc724e8e4d3a88e77f4b63a57b2de5ea0548cb5bfb6a88d89dd6b40cab48d`。macOS arm64，Codex 0.169.0 与 Claude 2.1.326，合成供应商仅使用本机回环。三个尝试各用不同私有状态，未使用日常凭据。

| 尝试 | 实际结果 |
|---|---|
| [072](attempt-072/console.log) | 驱动漏引入 `createServer`，在监听及 App 启动前退出。原文件保留。 |
| [073](attempt-073/result.json) Git Codex → Claude | 两次原生 queued 回执均可查。父在收到回执后实际用原生命令写文件，待发的另一子实际在关系卡取消，真人后续仍排队。父原 run 退出后 Claude 子取得唯一写入槽。Claude 的实际审批按钮显示「批准」，当时驱动仅找「批准一次」所以未提交，随后清场终止。不能计完整子写入或父续跑。PID 70422 正常退出。 |
| [074](attempt-074/result.json) SVN Claude → Codex | 两次真实回执、待发子取消、父继续实际写入；真实 Claude 前台结束时后台 Bash 仍活，Codex 子 queued 且未进入原生。放后台后驱动误把 Claude 的原生完成通知归到未知父输入，返回错误并执行清场。PID 72078 正常退出。 |

## 074 时间线

时间为 UTC，App 写入时刻和已归档的原始 Claude 事件按同一系统时钟对应。

| 时刻 | 实际结果 |
|---|---|
| 20:56:41.284 | 真人第二条 `A32_RESUME` 已落盘 accepted。全次保持 `run_id=null`、`native_turn_id=null`、`started_at=null`。 |
| 20:56:42.510 | 原真人 `A32_START` 前台 completed。原父 run `921a8302-d7e6-4d6c-b866-59e113546832` 代次 1，PID 72211；后台 Bash PID 72325 仍活。此时本应启动的 Codex 子还未开辟原生运行。 |
| 20:56:43.062 | 释放测试私有标记后，WillYou 从 SDK 收到原后台节点 completed。 |
| 20:56:43.064 | 同一个 Claude 原生会话写入 `<task-notification>`，任务 `bw0sz7g41`、tool-use `toolu_ef4e62405823458d80b9bf8c066968f4`。Claude 的 API 请求体将其明确标为 `SYSTEM NOTIFICATION - NOT USER INPUT`。 |
| 20:56:43.072 | 合成端收到 Claude 原生 HTTP，由该自主通知触发。此时整个 DB 仍只有原父 run，未有第二次真人、宿主结果通知或 Codex 子的原生运行。 |
| 20:56:43.074 起 | 合成端不认识此原生通知而返回错误，后续检查提前结束。43.224 起是清场停止和子取消，44.153 原父 run 退出。 |

此轮没有观察到真人输入或写子抢槽。正常接受原生通知后能否交槽需用精确识别后的新尝试证明。

[原生事件原始摘录](attempt-074/native-background-event-excerpt.jsonl) · [只读 SQLite 对账](attempt-074/readonly-matching-host-turns.json) · [实际后台保持队列](attempt-074/17-background-holds-queued-child.png) · [完整测试结果与 HTTP 时刻](attempt-074/result.json) · [文件 SHA-256](SHA256SUMS)

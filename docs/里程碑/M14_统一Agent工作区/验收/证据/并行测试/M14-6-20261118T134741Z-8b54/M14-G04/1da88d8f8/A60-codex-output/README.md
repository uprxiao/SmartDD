# A60 Codex 输出上限实包复验

2026-11-19，macOS arm64。冻结候选 `1da88d8f85325d76474f1125427646aa56776848`，ASAR `f06168649ff9a1eec9fb5cdbbb2238bcf9778e2613cd486a427c8bdb8df584bd`。真实本机 Codex 通过回环产生原生事件，模型服务为合成协议回包。

- 149 在旧包复现 D06-48。原生以 `other` 回报精确的 `max_output_tokens`，旧宿主显示普通失败。[旧包原生与宿主对照](../../4da61749f/A60-native-limits/attempt-149/verified-149-codex-output-red.json)
- 153 在同一修复包的暖机前，驱动立即计算控件几何，没有命中输入框。已保存原始失败，未发出模型请求，App 正常退出。修正后要求标题、控件与焦点匹配，确认输入实际出现在文本框后才提交。[原始失败](attempt-153/result.json) · [时序与根因分析](attempt-153-composer-readiness.md)
- 155 在同一新包通过。原生错误仍是同样的输出上限，App 显示“输出长度到上限”，已有正文保留，无重置时间。静置 3.510 秒没有额外回合或模型请求。实际点“继续”后，新输入及新回合只发一次。原生同一会话记录实见继续及恢复正文，回合完成。App 正常退出，界面无报错，回环和测试进程均已收口。[完整结果](attempt-155/result.json) · [原生与宿主核验](verified-155-codex-output-and-manual-continue.json) · [受限状态](attempt-155/01-actual-native-terminal.png) · [手动继续后](attempt-155/02-explicit-new-turn-recovered.png)

D06-48 关闭。Claude 输出上限在 [148](../../4da61749f/A60-native-limits/README.md) 已单独取证。A60 的剩余额度、限流和其他终态仍按合同验收。

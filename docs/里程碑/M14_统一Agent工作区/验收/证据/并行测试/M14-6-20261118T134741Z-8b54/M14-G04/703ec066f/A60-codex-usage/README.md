# A60 Codex 额度耗尽与重置时间

2026-11-19，macOS arm64，冻结候选 `703ec066f36e10ffb490b19f818b385641de19ad`，ASAR `cb65cbeb53d8145a8dd80972ecb76ec3a09425ad0926808bdb61cdaa7c2b078b`。真实本机 Codex 0.169.0 使用本机合成 Responses 服务。未改变原生退避。

- 162 实验回包的相对重置头没有被原生识别为结构化时间，只有原生错误文字含时间。额度卡、暂停、实际手动继续在同一原生线程完成。该轮不能核界面结构化重置值，App 正常退出。[原始结果](attempt-162/result.json) · [结构字段核验](verified-162-codex-usage.json)
- 165 使用原生版本支持的绝对重置头。实际原生进程 stdout 和 rollout 同时证实主额度已满与同一个绝对时间。随后的同一原轮报 `usageLimitExceeded`。旧宿主没有保存结构化时间，界面仅写“稍后”（D06-51）。观察窗口越过真实重置时点 2.031 秒，未自动换账号、开启新轮或请求模型。实际点继续后只开启一个新轮并完成。App 正常退出、界面无报错。[原始结果](attempt-165/result.json) · [真实原生回执与缺失投影](verified-165-codex-structured-reset-red.json) · [旧界面](attempt-165/01-actual-native-terminal.png)

168 用同一原生协议和断言在候选 `4f1d4c0a2` 复验。实际原生绝对时间、宿主记录和实际卡片同为 `2026-11-19T01:41:27.000Z`。观察 24.316 秒、跨重置 2.038 秒都没有额外请求或宿主回合。真实点继续后同一原生会话中出现唯一成功的新轮，App 退出 0。D06-51 关闭。[修复包核验](../../4f1d4c0a2/A60-codex-usage/attempt-168/verified-168-codex-structured-reset-green.json) · [额度卡](../../4f1d4c0a2/A60-codex-usage/attempt-168/01-actual-native-terminal.png) · [包与回归](../../../build/candidate-4f1d4c0a2/README.md)。本页有额度分支证据，A60 其他终态仍待验。

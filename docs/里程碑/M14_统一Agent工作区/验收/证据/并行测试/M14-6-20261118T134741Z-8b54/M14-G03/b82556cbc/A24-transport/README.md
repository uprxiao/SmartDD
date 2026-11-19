# M14-A24 委派去重与回包中断

2026-11-19，macOS arm64。冻结候选 b82556cbc74646ec7ab2dfe9defc70a4e305ebac，ASAR 898f908c7b2340262358d2adab2f1ade01eb14da46c796352bc668d7a59792fd。真实 Claude 和 Codex 使用本机合成模型，所有隔离 App 交互由后台 CDP 驱动。仅在本轮原生 MCP 私有网络回执边界注入丢失。

- 086 先由真实原生工具查询当前目标及修订，在同一实际父回合中两次委派同一 key，只为同一子任务派发一次。忙父仍工作时子结果写入 revision 1，原宿主通知保持排队。
- 当父在真实原生调用中领取子结果时，测试门闩只截断本轮身份、回包内容与 revision 同时相符的一次私有 Unix 回复。原生 Claude 的同一 tool_use 回执确实报连接错误且没有正文。随后父回合继续，宿主通知恰好送达一次。
- 实点发送一条恢复意图。新原生运行通过真实 MCP 从同一子任务读回相同 revision 和正文，原子未重发。App 正常退出，无渲染错误。[完整结果](attempt-086/result.json) · [回包切断及排队界面](attempt-086/40-a24-original-broker-drop.png) · [恢复并读回界面](attempt-086/41-a24-native-recovery-same-result.png)。
- 084 的旧驱动未查目标修订，产品两次各自明确拒绝，没创建子任务。保留尝试，以实际工具查询修订后重新运行。[084 原生回执](attempt-084/native-delegate-denials.json)。
- 旧 token 被明确拒绝、新运行重读的集成证据与实包结果共同覆盖本条。当前委派、运行与业务请求回归 67 项通过、1 项条件跳过。[旧运行拒绝及重连集成证据](../../1c9022486/a24-observe-reply-i/README.md) · [当前软件回归](a24-a27-current-software.log)。

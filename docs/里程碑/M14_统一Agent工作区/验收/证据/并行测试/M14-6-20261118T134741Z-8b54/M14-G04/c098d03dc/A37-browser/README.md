# A37 修复包待绑定场景

2026-11-19，macOS 26.6.1 arm64，签名候选 `c098d03dc`。真实本机 Claude、Codex、SVN 工作目录，隔离 App 与合成本机页面。无实际账号与外部请求。

| 轮次 | 结果 | 证据 |
| --- | --- | --- |
| 111 冷启动 | 同一聚合第一次读 SQLite 时请求仍待绑定、新运行在准备；随后异步查询已出现同一请求的观察授权。新运行依次登记、取得授权、请求记为已解决。驱动将不同时间的读取当成同一时点，提前结束，真实模型上下文通知和 CLI 读取未取证。两个宿主分别按计划故障结束和正常退出。 | [原始状态](attempt-111/first-after-restart-before-opening-any-tab.json) · [结果](attempt-111/result.json) · [释放](attempt-111/release-check.json) |
| 112 停止 | 实际点击停止时，另一原生任务仍持写入槽。原批准退役且没有绑定或授权审计。原页面仍存在。后来由真实新运行经内置 CLI 读取原页面，返回 `SCOPE_DENIED`。App 退出 0。 | [退役](attempt-112/03-retired-before-slot-release.png) · [结果](attempt-112/result.json) · [释放](attempt-112/release-check.json) |
| 113 撤销 | 实际选择撤销并确认时，另一原生任务仍持写入槽。原批准退役且没有绑定或授权审计。实际新运行同样不能读取仍存在的原页面，CLI 返回 `SCOPE_DENIED`。App 退出 0。 | [退役](attempt-113/03-retired-before-slot-release.png) · [结果](attempt-113/result.json) · [释放](attempt-113/release-check.json) |
| 114 冷启动复验 | 同一 SQLite 读事务核对批准仍待绑定、原标签同一、无后继已登记。后继 generation 2 登记并附进程后才确立观察授权，同一请求 resolved，随后真实模型收到可用通知。原生 CLI 实际读出旧标签的同一 ID、URL 与正文，审计绑定同一授权；运行结束后授权撤销，重启 App 退出 0。 | [原始结果](attempt-114/result.json) · [新运行实际读取](attempt-114/03-cold-successor-live-authorized-read.png) · [独立复核](attempt-114/verified-114-candidate-restart.json) |

[旧包 110](../../2521f1b41/A37-browser/attempt-110/README.md)会误退役原请求，D06-43 已用实包对照复验。旧包错误和不合时序授权均由修订后的断言判为失败，111 保持未完成。[断言回放](attempt-114/coherent-replay-110-111.json)

A37 仍缺 M15 无人值守触发判据，待确认验证入口。

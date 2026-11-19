# A60 原生默认模型与推理强度

2026-11-19，macOS arm64，隔离包 9a6e95cdc。使用本地合成供应商和真实原生 Codex。两个场景各使用一次 App 正常退出后复用同一份隔离数据，实际原生进程身份均单独复核。

- 359：在同一个原生线程从默认 A 改为显式 B，随后真实界面切回默认 A。正常退出，再打开同一任务，按真实协议恢复同一线程、使用新的运行代次，实际下发默认 A。[界面](attempt-359/03-cold-retained-thread-default-a.png) · [结果](attempt-359/result.json) · [清场](attempt-359/verified-release.json)
- 360：保存 high 后正常退出。重启时只延迟本次需要的原生模型目录回执，首次开跑先跳过 high，真实命令未携带 effort，App 显示未公布原因。随后原样释放该原生回执，驱动从宿主快照读到了目录，重新打开模型菜单时仍显示“执行器尚未公布可用选项”。公布后实际应用设置尚未证实，保留界面和 wire 记录，恢复后继续区分界面刷新与夹具定位。[公告前](attempt-360/03-cold-unannounced.png) · [后续现场](attempt-360/failure.png) · [结果](attempt-360/result.json) · [清场](attempt-360/verified-release.json)

- 364（Claude Code 接手，同一包）：360 失败的原因是驱动取样太早。驱动从宿主快照读到目录后马上打开菜单，渲染端要在收到 `run.models` 事件后防抖 80 毫秒再重新读快照。修正后的驱动在菜单打开期间有界等待最多 5 秒，并逐次记录取样（[改动](attempt-364/driver-change.diff)）。重跑结果：冷启动后的首轮跳过 high、命令没带 effort、界面显示未公布原因，与 360 相同；释放目录回执后打开菜单，第 0 毫秒就显示“默认／low／high”，high 为已选；随后一轮实际发出 effort high，同一线程、同一运行，没有再提示跳过。两次 App 正常退出 0，4 个 CLI／桥进程按出生身份核对已退出，3425 已释放。设置“公布前跳过、公布后应用”这组判据通过。[公布后菜单](attempt-364/04-native-announced-and-visible-skip.png) · [结果](attempt-364/result.json) · [清场](attempt-364/verified-release.json)

整条 A60 还需补齐短期限流、过期子结果及其余终态组合。

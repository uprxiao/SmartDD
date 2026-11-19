# A70 Codex 自动暂停后冷重启

2026-11-19，macOS arm64，隔离包 `9a9da26a7`，ASAR `3f8d39d0458accff2138e7e9a2c0309c8d47f1fb51437daf4f32dfe38857d357`。合成回环模型、真实 Codex 与安装包。本轮仅 SIGKILL 已核验隔离 App，使用同一隔离 userData 重新启动，无宿主外目录操作。

567 在目标待子已暂停且原子任务原生结果到达、宿主通知尚未持久化时中断原 App。[原实际等待状态](01-original-waiting-goal.png) 第一进程实际 SIGKILL。新进程在任何恢复页界面动作前已自行恢复，原生先报告同修订 paused，再 `thread/resume` 原 ID、确认 active，业务时间线只接受一条旧结果通知。原子任务只有一个运行和回合。新 App 结束为 0，回环释放。[冷恢复回执](02-recovered-autonomous.json.gz)

旧夹具在最后打开原任务视图时等待超时，未按整组通过。[失败截图](99-failed.png) 原结果完整保留，待补正确的重启 UI 入口和原状态核对。568 保留原有自主恢复判据，通过了全部冷启断言。在写完零界面输入的恢复证据后，真实点设置打开测试实例的 M14 工作区，再从侧栏打开原任务。界面展示同一目标 active 和那一条原结果通知。用户式按钮停掉恢复任务，第二 App 正常退出。[新包复验](568-02-recovered-original-goal.png) · [恢复前零输入记录](568-02-recovered-autonomous.json.gz)

A70 的真实模型全文工作流仍待覆盖。[SHA256SUMS](SHA256SUMS)

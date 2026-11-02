v0.1.1 首轮 Release run 41399417380 / run_attempt 1 已 failure，来源44b不变。9 jobs为7 success、1 failure、1 skipped。Mac x64在DMG构建后运行packaged Electron native-smoke时出现spawnSync ETIMEDOUT；原日志未暴露内部阶段，也未观察到业务断言错误，根因未确认。publish跳过，Release API返回404，七安装包公开校验未达成。

本轮release-tests实际24/24通过；Vitest5866通过、1000原条件跳过、0失败。Mac arm64、Windows、Linux包任务成功。观察者及进程组已真实退出，没有UI/native/Codex租约。未重试、取消或移动tag，协调者的慢ZIP下载不受影响。

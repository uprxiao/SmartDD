# A37 旧候选冷启动实包反例

macOS 26.6.1 arm64，2026-11-19，隔离候选 `2521f1b41`。真实 Claude 父、Codex 子、SVN 写槽及本机合成页面。通过实际界面批准后，在后继仍不能开始时按本轮故障计划终止原宿主，使用同一私有数据冷启动。测试未重新打开原标签。

1. 冷启动第一份快照仍见同一请求 r2 待绑定、原标签 ID 和 URL 相同、无可用授权。此时从浏览器存储读取标签，没有再次请求页面。[故障前](before-intentional-restart.json) · [首次冷启动状态](first-after-restart-before-opening-any-tab.json)
2. 后继运行真实登记 PID 和 generation 2 后，旧实现把原请求退役，提示目标页面、地址或项目已变化。持久标签仍在，浏览器审计没有对应授权。[原始结果](result.json) · [失败截图](99-failure.png) · [独立核验](verified-110-old-package-restart.json)
3. 旧宿主按计划退出。第二个 App 正常退出 0，相关子进程和调试端口已核对释放。[第一宿主退出日志](app-86583-intentional-crash.log) · [第二宿主退出事件](quit-phase.jsonl)

[D06-43 软件复验](../../../../software/a37-restart-c098d03dc/README.md)对照实际持久工作区，修复包待复验。

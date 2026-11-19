# A04 在启动准备阶段停止

2026-11-19，macOS arm64，后台 CDP。保持真实 Claude CLI 的版本退出、宿主 PID、原有运行与时序。故障注入只在隔离环境暂缓向宿主返回第二次 `--version` 的已生成输出。用户操作由后台 CDP 点击原生任务的停止键。三次回环模型请求均为零，隔离 App 均正常退出。

- 150 在旧候选 `4da61749f` 复现 D06-49。停止后旧运行实际 fork 原生 PID 20808，随后才收口。[旧包红测](../../4da61749f/A04-prepare-stop/attempt-150/result.json)
- 152 在候选 `1da88d8f8` 没有原生 fork、活跃登记或桥握手。旧判据把数据库中任何进程行当成已启动进程而报失败。同一原数据库的只读核对显示两条记录均已取消，PID 和实际出生时间均为空。修正后实测解读同时拒绝原 150 和六种破坏式反例。[原记录](attempt-152/result.json) · [真实数据库核对](attempt-152/database-cancellation-check.json)
- 154 同一签名包、独立数据、修正后的夹具复验。释放版本探测后，原运行以 stopped 收口，仍没有 fork、PID、桥或模型调用。已接受输入留在队列，CLI 和桥预留都明确取消，实际退出后再次只读确认已持久化。App PID 69959 退出码 0，六个精确身份全部收口，无界面报错。[实包回执](attempt-154/result.json) · [停止后界面](attempt-154/10-stop-preparing.png) · [测试文件校验值](driver/SHA256SUMS)

D06-49 关闭。A04 的 spawn、attach 及两端旧调用方的其余判据继续执行。

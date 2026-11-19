# A04 原生出生和工具桥握手过程停止

2026-11-19，macOS arm64。冻结候选 `1da88d8f85325d76474f1125427646aa56776848`，ASAR `f06168649ff9a1eec9fb5cdbbb2238bcf9778e2613cd486a427c8bdb8df584bd`。真实本机 Codex、隔离 App 与本机合成回环。实际项目任务的停止由后台 CDP 点击。三次均无模型请求或业务执行。

- 156 默认测试沙箱拒绝监听 127.0.0.1:3425，App 未启动，未进入产品判据。[环境前置记录](attempt-156/result.json)
- 157 通过进程出生但业务 CLI 登记尚未完成时停止。夹具只短暂持有同一资源协调库的原生锁，实际 fork 与进程出生不变。点击停止时，实际 CLI PID 已由宿主观察，业务 CLI 和桥行均为 armed 且无 PID。释放同一锁后，CLI 实际登记并退出，未启动的桥预留取消，无工具桥授权、模型请求或业务执行。租约释放，三个准确出生身份均核空，App 正常退出。[实包记录](attempt-157/result.json) · [停止后的 UI](attempt-157/10-stopped-spawn.png)
- 158 复现 D06-50。原始核身份 helper 已识别同一真实桥进程，夹具只短暂保留它的原 close 回执。UI 停止事件先于放行；之后仍出现同一个桥的认证观察记录，应用操作与模型请求均为零。App 正常退出且三个准确出生身份收口。[真实停止、回执、迟到认证](attempt-158/result.json) · [停止后的 UI](attempt-158/10-stopped-attach.png)

161 使用冻结候选 `703ec066f36e10ffb490b19f818b385641de19ad`、ASAR `cb65cbeb53d8145a8dd80972ecb76ec3a09425ad0926808bdb61cdaa7c2b078b` 按同一故障点复验。停止先于放行，原核身份回执摘要相同，实际旧握手记录 `SCOPE_DENIED`，无已认证桥、业务执行或模型请求。实际 CLI 与桥均退出，资源租约释放，App 退出 0 且无界面报错。D06-50 关闭。[修复包实测](../../703ec066f/A04-post-fork/attempt-161/result.json) · [停止界面](../../703ec066f/A04-post-fork/attempt-161/10-stopped-attach.png) · [构建与回归](../../../build/candidate-703ec066f/README.md)。旧代次、复制句柄与伪造调用方的其余判据另行执行。

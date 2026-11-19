# A59 工作计时混入审批等待（D06-54）

2026-11-19，macOS 26.6.1 arm64，真实本机 Codex、回环合成模型响应、隔离打包 App 后台 CDP。基线 `684a0b6a1e1ba01c12f405b89087aebf9e357a5d`，`app.asar` SHA-256 `237e4b90eb22fbae9329bb475094ba99a397433fd9d0f30d52ec1c34e53379fc`。

- 两次已有实包 143／147 的只读数据库与截图显示同类问题。147 的原生请求等待 2,964ms，回合总长 3,283ms，前台工作 319ms，实际界面为“已工作 3 秒”。当次背景节点是在原生请求结束之后启动。 [早期包独立核对](verified-existing.json)
- 188 在真实 Codex 未列出 `decline` 时提前判夹具失败，未测试耗时。实际产品按现行需求为此种请求仍提供“拒绝”。复验继续走实际产品的拒绝和确认控件。 [首次记录](attempt-188/result.json)
- 189 同一前台回合从开始到完成 4,651ms，其中原生审批等待 4,596ms，前台工作 55ms。原生收到拒绝后回合正常完成，测试命令没有写入文件。原 App 界面显示“已工作 5 秒”，真实工时按秒四舍五入为 0。App 和原生进程已退出，App 退出码 0。 [原始结果](attempt-189/result.json) · [开始等待](attempt-189/01-native-command-wait-opening.png) · [仍待处理](attempt-189/02-same-native-request-after-hold.png) · [错误计时界面](attempt-189/03-same-completed-turn-timing.png)
- 修复 `1b1680eeab910d29a5e86dbe73698f27c93b4bdf`。按同任务、同运行、同前台回合归并实际原生审批等待区间，取其并集；运行页与历史页分别显示工作和等待时长。宿主异步审批、独立原生子节点的等待不计入主回合等待。两条回归旧版均红，新版 387 项通过、7 项按条件跳过，两套类型检查均成功。 [回归红测](a59-work-timing-before.log) · [受影响回归](a59-work-timing-regression.log) · [类型检查](a59-work-timing-typecheck.log)

190 在新签名候选完整复验计时，D06-54 关闭。[新包证据](../../1b1680eea/A59-work-timing/README.md)。A59 的完整事件矩阵仍另计。

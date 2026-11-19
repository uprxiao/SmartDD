# A37 浏览器页面、父子授权与请求等待复核

2026-11-19 按现行 A1.13 对照保留的打包记录、封存 SQLite、实际 CLI 回执和当前源码。用户指定的 M15 无人值守场景已移交 M15。下表保留各次实际实测的候选包，`2b78058ec` 用于源码核对和渲染端回归。

| 判据 | 实际证据 |
| --- | --- |
| 新建页面后切执行器 | 实际通过页面切换 Provider 后仍是原标签和地址，合成登录 Cookie 持续有效。 [首包 002](../../attempt-002/result.json) |
| 分别申请观察、控制 | 104 显示同项目目标任务、URL、只读说明和绑定后仅本次运行有效。仅观察可选“允许观察／拒绝”。105 控制申请增加“允许控制”，实拍说明点击、输入和页面脚本。 [观察面板](../../15be1a81e/A37-browser/attempt-104/01-observe-after-61s.png) · [控制面板](../../e17b6c79e/A37-browser/attempt-105/02-control-options-before-stop.png) |
| 父子权限分开，观察不可写 | 108 的真实 Codex 子在授权前被拒，父界面批准后才从相同目标标签读取。105 请求批准档和 106 完全访问档的观察授权均拒绝写入，结果为未开始。 [真实父子 108](../../2521f1b41/A37-browser/attempt-108/result.json) · [批准写仍拒绝 105](../../e17b6c79e/A37-browser/attempt-105/result.json) · [直接拒绝 106](../../b82556cbc/A37-browser/attempt-106/result.json) |
| 交互等待超过 60 秒，无倒计时 | 104 的原生 CLI 先返回 `awaiting_user`，请求继续挂起，原 Agent 回合完成。等待 61,053ms 后用 App 批准，同一运行收到可用通知并实际读取原标签。 [等待和原生结果](../../15be1a81e/A37-browser/attempt-104/result.json) |
| 停止及迟到批准 | 105 点真实停止，挂起请求和已有授权均终止。按用例注入原修订的迟到批准，宿主拒绝；页面所有者仍可使用原登录态。 [停止及后续导航](../../e17b6c79e/A37-browser/attempt-105/README.md) |
| SVN 待绑定、冷重启及后继消费 | 109 在原运行退出且写入槽被占时批准，记录空 run 的待绑定和待送达通知。114 同事务观察冷重启的原页和待绑定请求。后继运行先登记，再获同一授权，原生读取原页内容，结束时撤回该运行的授权。 [交槽](../../2521f1b41/A37-browser/attempt-109/result.json) · [重启验证及时间链](../../c098d03dc/A37-browser/attempt-114/verified-114-candidate-restart.json) |
| 绑定前分别停止、撤销 | 112、113 均以真实控件退役原请求。截图和封存库的通知分别记录停止、用户撤销原因。后继原生读取均返回 `SCOPE_DENIED`。 [停止](../../c098d03dc/A37-browser/attempt-112/03-retired-before-slot-release.png) · [撤销](../../c098d03dc/A37-browser/attempt-113/03-retired-before-slot-release.png) · [只读证据对照](verified-closure-readback.json) |

U／I 负例覆盖目标变化后旧批准拒绝、同项目及任务归属、休眠标签与当前地址的重新核对，见 `business-browser.test.ts`、`service-access.test.ts`、`access.test.ts`。App 实包覆盖同目标从等待、审批、绑定到读取的完整路径。新候选仅对照浏览器服务和调度相关源码。较新的宿主通知变成简短排队提示，专用待绑定文案、退役原因和原生通知仍保留。 [渲染端 93 项回归](m14-2b78058ec-renderer-regression.log)

真实历史故障 D06-40 与 D06-43 保留于旧记录，分别以 105／106 与 114 的实包正例关闭。此组可按 U／I／A 归账。

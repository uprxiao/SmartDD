# 来源等待与文件故障验证

日期：2026-11-14。对应 Q17／Q04／Q27；对 Q41 只补来源边界，完整业务审批仍待集成。固定 macOS arm64、Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1。

沿用[回合中来源实验](../20261114_回合中输入来源与取消验证/README.md)的实际 run、session、租约、系统进程身份、私有业务桥及 ApplicationToolService，保持隔离 HOME、合成凭据和回环假模型。测试宿主把不同故障加入原生文件读取过程；业务处理器只返回合成读结果，不执行邮件／插件写入。UI sender、L3 兼容等级与部分身份仍是夹具。

## 十二个 native 场景

Claude／Codex 各运行下列六种场景，[唯一批次结果](result.json)全部通过。

| 场景 | 注入方式与结果 |
| --- | --- |
| healthy | 回归正常链路：两端在回合结束前取得文件 proof，业务调用成功 |
| missing-deadline | 临时格式适配器的 locate 始终抛 ENOENT，实际 reader 返回不可用；在首次观察后显式触发截止信号，候选等待器拒绝，业务调用失败 |
| waiting-cancel | 同样保持来源不可用；在已订阅且首次读取后停止实际 run，等待退出、监听关闭，无来源 proof |
| replace-file | 取得实际原生文件 proof 后，用完全相同字节的新 inode 原子替换文件；现有 reader.verify 返回 false，业务结果被拒绝 |
| late-cancel | 实际 reader 已返回匹配结果，测试夹具暂扣其 promise；停止 run 后 root 退出，但实际 activity 与 lease 仍保留；释放读取结果后候选再次核对取消，拒绝迟到结果，随后释放资源 |
| late-deadline | 在相同暂扣读取窗口触发截止信号；释放后拒绝迟到的匹配结果，不放行业务结果 |

缺失是定位器故障注入，不声称 native 实际关闭了日志。截止信号由测试主动触发，以验证状态转换和竞态，不是等待某个秒数的计时精度／性能测试。替换使用真实临时文件系统。暂扣的是实际读取结果，不能推广成全部操作系统 IO 故障已通过。

两端各三个非取消故障中，原生回合仍正常完成，但实际调用账为 failed／read-only／attempt_count=1。这是“回合完成”不能冒充“业务操作成功”的联合证据。两项 healthy 成功，其余十项业务调用失败且没有验证通过的来源 proof；无真实外部业务副作用。

部分取消场景仍有第二个模型请求，假端点按失活 owner 拒绝；继续不宣称停止瞬间网络排空。十二个 native 及其已登记桥均收尾，activity 完成、租约释放，十二个文件监听均关闭。

## 候选等待合同

[source-wait.mjs](source-wait.mjs)是隔离候选，不在产品源码内。它先订阅再读，在 await 前后核对取消／截止；变化仅唤醒下一次完整读取。截止或取消发生在未结束的读取期间时，先锁定拒绝状态，等待读取实际结束再结算活动，不用 Promise.race 的表面返回提前释放仍占用的资源。无法中断的 IO 可能延长清理，须保留 stopping／恢复提示，不保证固定秒数完成。

读取、监听和预算三个错误域需独立处理。候选最多读取 32 次，此值只是实验预算；产品参数及不同平台文件监听能力尚待确定。四个[独立等待检查](wait-results.json)覆盖读取期间变化不丢失、不支持格式立即拒绝、无关变化风暴命中预算、开始前已取消不打开监听；结束后信号监听均移除。这四项只有合成观察，不重复计为 native 或产品验收。

本轮未验证真实文件监听异步 error、跨平台监听、网络文件系统的不可中断 IO、全部篡改／截断分支；也未验证真实 Electron 用户入口、程序化来源持久化、邮件／插件完整审批、steer／合并输入。来源 proof 不能替代 MailUserAuthorizations 的业务审核；isLive 是 RAM 守卫，具体业务仍须走 verify／claim 等已有检查。

## 复核与重跑

[审计结果](audit-result.json)核对十二组 native／数据库状态、事件顺序、一次调用及资源收尾，验证实际依赖与业务源码摘要未改；[sources.json](sources.json)沿用上一轮源基线。原始协议、假模型请求、文件证据及当次脚本在 [traces.tar.gz](traces.tar.gz)，成员摘要见 [traces-manifest.json](traces-manifest.json)。

重跑需按前序实验的构建说明重建独立 bundle、原生依赖与 macOS 身份 helper，并调整本机绝对路径。先运行 `node --check probe.mjs`，再运行 `node probe.mjs`、`node wait-cases.mjs`；`audit.py` 固定本次归档批次，重跑审计须显式改到新批次。仅使用临时配置和假端点。正式产品验收仍为 0／54，未修改产品代码。

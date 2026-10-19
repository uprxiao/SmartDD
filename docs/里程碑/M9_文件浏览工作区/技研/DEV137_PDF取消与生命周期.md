# DEV137 PDF取消与生命周期

依据R3.4/P1，Y18原I/A范围、步骤与预期保留，完整通过。正式248/419（59.19%），169未执行、2阻塞；Y14/Y17仍缺V。不改生产/native/依赖，复用正常r79，不发布。

## 实际验收

| 层级 | 结果与边界 |
| --- | --- |
| I12 | 实际生产engine/session-slot仅经格式/导入适配，在独立sandbox/contextIsolation/no-node真实BrowserWindow调用包内原PDF.js/native Worker。实际鉴权读取四份合成文件及精确字节；三轮200页加载取消、真实待决getPage拒绝/销毁后新run拒绝、密码等待取消、活动及排队来源替换后只有最终3页生效。非Node fake-worker；直接契约操作只计I |
| A26＋补充A1 | 正常r79原UI/原native/原Worker，真实指针浅深各三轮加载中关闭、密码等待关闭、快速三个来源切换、关闭重开及非空画布释放；每主题一次真实Worker未捕获JS异常、可信原生ErrorEvent、错误界面与新Worker重试。另真实Worker.close静默退出，由原15秒看门狗发现后清理/重试 |
| U及构建核对 | PDF模型6及资源13共19U、类型通过；新核对82运行文件；复用同哈希r79及原六smoke，无新包、无生产源/原生/依赖变化 |
| 清理 | I15个真实Worker Target全销毁；关闭后归属PDF计时器、活动端口及引擎显式错误监听归零，旧画布清零/脱离或已回收。四源hash/inode/mtime/ctime未变，4自有实例全闭，最终I12/A1正常退出0/null |

执行前预算v1.1 SHA256：`2f9d3ff33d5fc97446597f929d20fd65af6b3db43722534f28bc87dab2f2b808`。契约销毁最大202.8ms、实际关闭输入至native Target销毁最大10.9ms，冻结限均1000ms。静默退出原看门狗15000.7ms（原15000ms，冻结允许调度超时2000ms），原200ms销毁握手等待209.2ms后资源归零，真实重试112ms（冻结限5000ms）。未修改产品deadline/握手时长。源码/预算均可从1243文件清单及基准＋7文件增量恢复。

## 失败、观察器与复跑

初I等待空闲Worker的Debugger.pause事件后才发请求，形成驱动死等；改为发真实请求后等原生paused，最终I12全部通过，未改产品。A首轮26逐项通过后，补充静默退出在错误UI出现即断言资源0，实际原200ms销毁握手尚未结束；保留该整轮失败及89MB原始JSON的gzip与解压前SHA。只修驱动等待握手，再独立复跑该补充项A1通过，**26+1不是一次完整27项全绿**。初失败两轮仅cleanup关闭，不充作正常退出证据。

Worker构造/消息/计时器观察转发原函数/参数/身份，仅记录元数据，无PDF正文/密码/事件强引用；Debugger控制真实Target启动/暂停/未捕获JS异常/close，不伪造解析、错误事件、回包或文件数据。原生未捕获JS异常不是OS段错误。计时器按实际编译函数范围及原库直接调用栈归属，避免把一般工作区持久化误算PDF资源。首轮观察器重复复制累积元数据造成89MB文件；已归档原观察器，后改紧凑快照＋最终完整trace，转发/清理/计时归属未变。静默补充结果降至约1MB。原观察器与Target控制均恢复。

只证明本次归属PDF资源及真实Worker上下文销毁，不宣称全局监听、heap/RSS/GPU或长期预算。两张实际浅深错误截图已查看；不作为R/V完整像素证明。无密码输入、模型/CLI、剪贴板或外部应用启动。其它用例与范围不变。

## 复用入口

- 合成数据：`scripts/files/pdf-lifecycle-fixtures.py`。
- 冻结预算：[dev137-pdf-lifecycle-budget.json](实验/dev137-pdf-lifecycle-budget.json)。
- I：`scripts/files/pdf-lifecycle-integration.mjs`；A：`scripts/files/pdf-lifecycle-ui.mjs`，支持`WILLYOU_PDF_LIFECYCLE_ONLY=silent`。
- Worker/计时观察：`scripts/lib/pdf-lifecycle-observer.mjs`；原生Target控制：`scripts/lib/pdf-worker-targets.mjs`。
- 环境使用`WILLYOU_FILES_APP`指定正常包、`SMARTDD_PDF_LIFECYCLE_PROJECT`指定本批合成目录、`WILLYOU_PDF_LIFECYCLE_BUDGET_SHA256`指定冻结预算SHA。所有自有数据独立，不接日常userData。
- [原始35项证据](../验收/证据/m9-acceptance-pdf-lifecycle-dev137-r79-20261019.json)；[通用自动验收流程](../../../真实App自动验收流程.md)。

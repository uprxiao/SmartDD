# 2026-11-22 Codex 预恢复、消息队列与文件面板复验

测试包为 macOS 26.6.1 arm64 的 WillYou 0.1.6。源码基于 `9f0874a775053bf54703edd2b77c4ac70d7cb684` 与构建工作树。验收包在 `/private/tmp/willyou-m14-stage6.IZSEr2/package/mac-arm64/WillYou.app`，`app.asar` SHA-256 为 `314e664322b19d6b33f0e7390ad72b65352fe7580c5d65e11ca4535ac5ee7c34`。构建路径中的 `source.patch` 保留生产源码快照。宿主进程身份核验二进制 SHA-256 为 `3ea4c07164ebd92391822629e00f4efa4a07a97f33088ef53b3c9b6b532c6040`。

| 场景 | 实际结果 | 核验文件 |
| --- | --- | --- |
| A14／A15 旧包对照 | 真实 Codex、Claude 均能完成一轮。第二次切回后等待 35 秒，后台无原生恢复。隔离实例退出正常。 | 旧包 `willyou-m14-stage6.5IXzNM/g04/attempt-471/result.json` |
| A14／A15 切回并续聊 | 用真实 Claude SDK 与原生 Codex、ZenTao MCP 验证。恢复后的线程 ID 与原线程匹配。就绪前未开轮、注入历史或发模型请求。等就绪后发送到开轮为 413 毫秒。恢复挂起时立即发送也只有一次输入凭据、派发及回复。 | `g04/attempt-481/result.json` |
| A14／A16 后台拒收与再次切走 | 一次明确拒收后，发送可恢复同一会话并收到回复。恢复被挂起时再切走，原进程退出且没有交接或开轮，重新切回后正常完成一轮。 | `g04/attempt-482/result.json` |
| A03／A15 宿主握手与会话回归 | 真实 Skill 请求的回执延迟 33 秒后，原生 Codex 完成实际宿主 MCP 鉴权并看到 19 个工具。另一轮无延迟的正常首发和追问共用一个原生运行和同一 MCP。隔离 App、CLI 和桥进程均已退出。 | `g04/attempt-483`、`g04/attempt-484` |
| A14 P0 模型目录回归 | 合成 Codex 协议持有模型目录刷新。使用已核实的缓存模型与档位开轮，放行刷新后目录更新。 | `g04/attempt-485/result.json` |
| A52／A73 标题栏与文件区 | CDP 从实际界面打开文件，核对标签与窗口顶部、右栏左右边缘的位置。浅色、深色窄窗、键盘调宽、最大化还原、底部终端、选中文件与文件页签均通过。 | `g03/attempt-006/result.json` |
| A16／A55 队列与收据 | 打包界面用 Enter、⌘Enter 和发送键入队。正常回执前队列仍保留，确认后同一输入进入时间线。坏回执记未知且不重发。支持和不支持插话的运行均完成 FIFO 测试。两轮 App 正常退出。 | `g03/attempt-005/result.json`、`g03/attempt-006/result.json` |
| 软件与原型检查 | 类型检查和签名包的六项原生冒烟通过。Agent、任务界面及业务 MCP 回归 568 项通过，7 项默认跳过。同一次变更的最终切换与界面定向套件 102 项通过。另手动开启两个隔离原生探针套件，4 项通过。原型 390 项测试和生产构建通过。 | 构建路径中的 `package-build.log`、`regression-test.log`、`switch-and-ui-regression.log` 和 `native-probe.log` |

原生服务端测试使用独立 HOME、userData 和项目目录。真实 Codex、Claude 与宿主 MCP 确认协议及身份，模型回复来自确定性的本机测试服务。日常账号下的网络与订阅未纳入本批。完整原始证据与复跑驱动保存在本轮私有临时目录。

UI 使用合成 Codex 协议提供确定的忙闲和回执时序。早期夹具的地址和空会话能力探测、分隔条的焦点步骤分别保留在 attempt-001 至 attempt-003。attempt-004 的业务断言通过，退出阶段仍有被收起的手动终端，触发原生退出确认。attempt-006 通过抽屉中的关闭操作结束终端，文件面板保持开启，App 正常退出。

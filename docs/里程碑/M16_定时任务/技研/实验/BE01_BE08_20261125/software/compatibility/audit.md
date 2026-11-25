# M16 F36 BE06／BE07／BE08：冻结基线兼容面与软件层预验

## 结论与边界

- 源码冻结为 `a0acddb3a2325c6bf732adaa7e954ce4d767a2c3`，协调者基线 `/private/tmp/willyou-f36-lab-tljocnfp/baseline`。本次只读审计，软件实验在 `/private/tmp/willyou-f36-compat-51flr0t2/source` 私有副本执行；测试缓存、临时目录和 HOME 均私有。Electron 42.11.14（仅 `ELECTRON_RUN_AS_NODE=1`），Vitest 4.1.11，better-sqlite3 12.11.1。
- 基线 17 个既有软件测试文件、117 个用例通过；首次 16 文件／111 用例通过、1 文件收集缺静态输入（未执行）。原失败保留，从同一 Git 提交补齐精确静态依赖后单独重验 6／6；两项额外宿主形状诊断也符合预期，**它们不是产品候选通过证据**。未运行 GUI、正式 App、资源长测或真实系统动作。未改冻结源码、主仓库或用户日常数据。
- 现主窗绑定了 `BrowserWindow.webContents`；F36 必须将“原生宿主窗口（BaseWindow）”和“可信主壳 WebContents／mainFrame”作为不同生命周期与职责，原生窗口身份不能代替可信内容身份。BE01/02 的实测表明新主窗不是 BrowserWindow，`.webContents` 不存在；`BrowserWindow.fromWebContents` 可返回实际 BaseWindow，`BrowserWindow.fromId`/枚举不能充当通用宿主查找。建议中心化类型及壳引用，不靠伪造同名原生属性、全局焦点或强制 cast 掩盖风险；不需要重写现有 renderer UI。

## BE06：必须逐项适配/回归的调用面

下表路径、行号以冻结提交为准；“影响”是源码分析及已有 BE01/02 实测的推断，未将其记为候选真实运行结论。

| 调用位置 | 当前行为与影响 | 候选要求与回归判定 |
|---|---|---|
| `src/main/app/window.ts:19–43,57–100` | 主窗口变量、创建/加载、`ready-to-show`、显示事件与 `isMainRenderer` 都绑定 BrowserWindow；原生窗 ID 与内容 ID 不是一回事 | Native window 和 trusted shell 分开持有。保留原 preload、mainFrame/URL/hash 判据、旧窗口销毁/替换即失效、标题栏/流量灯、隐藏不退出、恢复通知、真实退出。适配原 `window.test.ts` 的 native shape，用没有 `.webContents` 的 BaseWindow + 独立壳模拟；不因为同窗而接受普通页的 sender。实际 App 核对原 UI、resize/恢复、show 事件不重开标签 |
| `src/main/index.ts:101,278,283,291–295,334,361–406` | IPC 事件发送、语音/通知主窗焦点与菜单动作；真实退出须经保存、放弃/确认、commit 的文件编辑 ack，再关闭任务/应用/数据库 | 事件只发当前可信壳；原生窗焦点仍来自 BaseWindow；退出的 owner 仍为原 WC ID＋frame process/routing IDs；旧 frame invalidation 保留。隐藏并非退出，真正退出先等浏览器/文件收口再销毁壳及主窗。真实候选用本地脏文件、终端、合成任务验证取消退出保留、保存再退、放弃仅限原规则 |
| `src/main/rpc.ts:113–125` | `BrowserWindow.getFocusedWindow()` 父窗选择项目目录/文件，旧类型枚举可能不包含 BaseWindow，或误附着到别的合法窗口 | 用已确认真实主壳所属的 native parent，不把焦点或 native ID 当 sender 信任判据；必要时改为已有 scoped RPC 模式并保留取消返回 null。真实系统选择器按 S，不能用对话框 API 返回值冒充点选 |
| `src/main/core/files/controller.ts:110–111,175–177,199–235` | MCP UI、HTML 预览父窗及 Office/通用文件另存通过 `fromWebContents(sender)`；`owner(event)` 严格绑定当前可信 renderer/frame | 接口明确 native parent + owner shell；`showSaveDialog` 已接受 BaseWindow；保存/取消/发生 frame 换代时仍按原规则，所选目的路径及真实文件副本字节一致。回归 `files/controller.test.ts`、`mcp/controller-ui.test.ts`；真实 App 检查 HTML/MCP 不遮挡浏览器控制与任务区域 |
| `src/main/core/files/html/service.ts:11,28,70,111–116,160–184` | record parent 用于几何、原生事件、sheet begin/end、add/removeChildView；`.webContents.getZoomFactor()/focus()` 为壳职责。**新增软件形状诊断**：保留旧 fixture，只让 parent 缺 `.webContents`，调用实际 bounds 得到 TypeError；恢复壳引用后布局恢复 | 服务记录 native parent（内容尺寸、可见/最小化、focus 及 sheet 等事件）和可信壳 WC（zoom/focus）；窗口内容区几何和壳 zoom 完整一致。关闭/隐藏/切到别的面板只在原条件满足时归还壳焦点；sheet/非活动窗/最小化不抢焦点；WC 销毁或 host generation 失效必须无旧回调。回归原 `html/service.test.ts` 的隔离、焦点、超时、资源释放；实际 A/S 对照 100/其他现有 zoom、resize、sheet、隐藏/restore 和关闭 |
| `src/main/core/files/mcp/ui-view.ts:12,18,49,64–66,89–91` | 与 HTML 相同的 native parent/WC 职责混用；已有 `mcp/controller-ui.test.ts` 只测 controller 及回调归属，未覆盖该服务真实几何与焦点 | 同一宿主接口复用，不降低既有隔离和内容身份规则；补 native-view fixture 的布局、zoom、sheet、旧 lease 关闭与壳焦点判据。真实 App 打开可复核的合成 MCP UI，再与浏览器/普通文件/任务输入切换，旧视图不能悬浮或截获键盘 |
| `src/main/core/projects/transfer-controller.ts:26,35`；`src/main/core/ai/agent-transfer-controller.ts:37,44` | native picker/save 父窗由 sender 找到；owner/过期/取消规则独立 | 保留安全的原父窗身份、取消/确认/导航失效等旧规则；软件基线 6＋9 项回归，真实 A/S 仅合成本地项目/配置，不导出实际 Key，不要求用户另做正常选择器的自动化前置工作 |
| `src/main/core/applications/controller.ts:38,123–125` | 插件包安装打开 native dialog；附件另存同 sender 所属窗判定后在 finally 用 `win.webContents.focus()` | parent 改为明确 BaseWindow，focus 回归可信壳内容；只在原 owner 仍有效、原生窗口仍正确且焦点满足条件时归还，不聚焦合法 popup/后台页。补本地合成附件保存/取消及 sheet 关闭后的真实路径/焦点证据 |
| `src/main/core/voice/controller.ts:12,22` | 录制快捷键期间遍历 BrowserWindow，调用内容的 setIgnoreMenuShortcuts；BaseWindow 不被原枚举获取。**新增软件诊断**：只枚举旧 BrowserWindow 时实际 controller 只设置该内容，不覆盖独立壳 | 显式当前可信壳参与原快捷键录制启用/复位（含 60s timeout）；原有需处理的合法窗口维持原约定，普通后台页不被当壳。记录真实 S 层 menu/voice 快捷键与页面非聚焦时行为（M12-T133），不调用真实语音输入或权限提示作为软件测试 |
| `src/main/core/browser/service.ts:254`、`page-registry.ts:34,78,149–165,182–196` | browser 创建先 park 到独立透明窗；普通页和主窗间移动，另一页 mounted 的 demote 有 await；独立合法 popup 已用 BaseWindow | 在同一 native 主窗有唯一壳，普通页以确定顺序位于壳后/当前槽位。Main host 初始化早于/晚于命令均要明确等待契约。后台 page 不遮挡/抢焦点，异步旧 placement/new close 后不能重新挂载。不要为了“只有一个窗”误删需保留的合法浏览器 popup、图表渲染等非普通停放窗 |
| `src/main/core/files/diagram-renderer.ts:10,29` | 专用合成图表渲染 BrowserWindow，非普通后台浏览器 | 无依据不重构；原验收已要求正常文件渲染保持。统计额外窗口应区分普通浏览器、明确合法弹窗及原有专用业务窗，不把合法业务窗作为 F36 新黑框 |

### 同一宿主的层级和焦点最小约束

- WebContents 业务身份（taskId/pageId/profileId）和 native parent/layer/painting 是不同维度。统一浏览器 placement 与壳/预览的 native 宿主适配，保证后台普通页位于壳之后，可见页和 HTML/MCP 不因独立异步挂载争夺同一槽位。现 HTML/MCP 由自身 `setVisible`/bounds 管理，须核对浏览器重新 placement 后是否错误遮挡；此风险未经真实候选证实。
- `BrowserWorkspace` 的 `overlay` 使用多个 owner 的独立 hold；释放一个 owner 不释放其他。截图进行中先关 owner，迟到 capture 不能再 park。新宿主的 paint hold 不应等同于 DOM overlay hold 或逻辑关闭；保留原截图/遮挡条件、壳焦点、按钮/输入事件的真实生效证据。
- Native `dialog.showOpenDialog/SaveDialog/MessageBox` 的 window 参数已经是 BaseWindow。`BrowserWindow` 静态枚举/owner lookup 的名称与真实对象类型/功能不同，shell WC 获取应始终显式。所有布局/焦点应用以同一有效 host generation 为边界，壳销毁后不再 focus。

## BE07：兼容的数据契约与精确回归

源码基线具有如下持久化契约，均不应因 native 宿主替换而新增数据迁移：

| 契约 | 来源 | 验证范围 |
|---|---|---|
| `app_settings` 的 `browserWorkspace.v1:<taskId>`，schema version 1（tabs／activeId／closed）；`browserRecent.v1:<projectId>` | `workspace.ts:50–64,128–142,300–307,394–410`，`src/shared/browser-workspace.ts` | 旧版以真实创建/关闭流程在隔离 数据库产生；候选读取同样 task/profile/saved id/state，不无故更名、清库；startup tab 仍懒加载；失效任务清理只作用对应 owner；原损坏记录保留并给出明确错误 |
| `browserProfiles.v1` schemaVersion 1；分区仍 `persist:wy-browser-<profileId>`、项目与任务归属及原默认项目身份 | `profiles.ts:9,20–40,55–59,74–115`；`src/shared/browser-profiles.ts` | 两 task／两 profile 使用本地合成不同 Cookie／状态标记；候选升级、正常重启仍正确。实际文件位置及分区名不因主窗改造改变；缺失/退役 profile 不恢复旧分区。持久内容状态按原规则验证（不要求未提交表单跨进程退出保存） |
| `browserProfileState.v1:<id>`、`browserSettings.v1` | `site-state.ts:9`、`settings.ts:4` | 合成站点状态、允许/拒绝、撤销、设置、下载等原有行为和已有数据，不扩大授权；仅本地合成数据 |
| `browser_operations` 收据（run/request/task/page 等关联，未完成状态重启转 unknown；已完成不得重派送） | `operations.ts:17–69` | 合成正常/失效/取消/中断语义及 SQLite 可读历史；新 UI 展示结果对应正确页面。保留记录而非重新执行，旧版本中断、已完成状态均须对照 |
| native engine 与逻辑页分离；每次原生重建新 reference scope，身份切换时保留逻辑 tab id 但替换 native 内容/queue/helper | `page-registry.ts:55–89`、`workspace.ts:203–219,310–333` | 在同一 App 运行中切任务、隐藏、停放或收起不重建页面，能验证唯一文档标记/计数/表单、pageId、WCId 及原生页面持续；只有符合原规则的身份切换、真正关闭/重启时重建。已关闭页 reopen 是新 tab id，旧引用按原契约无效 |
| `removeProfileBindings` 处理未载入、已关闭与活动 tab；clone/journal 对应原有恢复规则 | `workspace.ts:337–351`；`profile-clones.ts`、`profile-snapshot.ts` | 本机合成文件及临时 SQLite 的复制、删除、导入暂停、重开、重启成功/失败保持一致，无残留引用。不使用真实登录、账号凭据或外部站点 |

已执行的既有测试覆盖 `workspace`（14：懒恢复、pending/失败/停止/关闭、历史上限、activity 不持久化、身份替换和孤儿清理、shutdown、overlay 并发）、`profiles`（7）、`profile-snapshot`（5，实际临时文件/SQLite）、`profile-clones`（6）、`recent-sites`（9）、`site-state`（3）；真实 Session、同源完整包升级以及 `browser_operations` 和 native 资源实测仍待候选。已有 popup、下载、权限和回执测试需在候选复跑，合成登录状态并不等于真实站点登录验收。

## BE08：生命周期、异常与性能判据

### 旧实现在退出／恢复的关键边界

- `BrowserPageRegistry` 在 create/popup 之后、publish 之前登记 initializing，初始化关闭时 `cancelProfileInitializations`/dispose 先关闭已分配内容，再待 initialization settlement（`page-registry.ts:39–48,55–89,93–122,186–198`）。主宿主 promise 若未就绪而关闭、切页、注销，候选也必须终止/汇合对应挂起工作，不能先毁宿主再等待导致陈旧挂载。
- close 先 `page.closed=true`、关闭 queue、abort 页信号，关闭关联 popup、失效引用、等待 helper、等待 queue、停止 proxy、解除 native view、关闭内容、删除页及清理 active（`page-registry.ts:168–185`）。显式从本页序列队列内关闭必须保留 `fromPageQueue` 例外，不等待自己。一般 UI/真实退出的先后顺序不能改变。`workspace.dispose` 先令 `shuttingDown`，取消恢复计时与 observer，保存不再覆盖已持久 tab（`workspace.ts:39–46,58–64,354–412`）。
- 队列 `queue.ts:4–36` 一页一 queue，入队及执行前重新校验；关闭立即拒绝待办，不重派旧取消事件。Operation 收据应区分执行前超时与派发后结果未知。保留 `navigation-wait` 的有界等待契约。
- `workspace.placement` 有全局 placementVersion（`workspace.ts:270–277`），overlay 以 owner 集合及 `capturePage` 检查迟到 owner（279–294）。新 host 若需要 await ready/paint，须在真实 commit 前复核仍是当前 placement/有效 native page；旧异步回调不得重加关闭/失效的 view。恢复新 paint hold 只能释放所持有的资源，不能误释放其他 owner。
- Native `BaseWindow` 本身不是 shell WC：宿主被关闭不意味着由 Electron 自动清理全部 child WebContents。候选初始化与正常退出须显式检查自己创建的内容、helper 和原生窗承诺；主窗口 hide 不是 retire。实际 `ApplicationService.dispose` 会调用浏览器 dispose（`application-service.ts:387`），`index.ts` 正常 quit 先完成文件、任务/应用收口后 `app.quit`，不能因宿主重构绕开。

既有 `core.test`（12）、`registry-shutdown.test`（3）、`navigation-wait.test`（8）、`downloads.test`（14）、`service-budget.test`（6）验证了原软件行为：回执、queue 序列/取消、初始化 drain/关闭、被取消 native 等待的真实结算边界、下载所属和收尾、队列内关闭不等待自身、超时未知/不重复 dispatch。未验证真实 candidate 的进程、页面、壳 crash/reload或资源曲线。

### 不缩减的原性能合同

- T107：前台 3 次、后台 click/screenshot/snapshot 各 10 次、切回 3 次；实际点击计数逐次生效，后台 click 中位 <1s，截图不卡、尺寸/状态保持。T108：收起右侧，关闭文件面板后重新打开，计时器持续、pageId 不变、命令不中断。
- T109：真实 Dock、⌘Tab、调度中心、窗口菜单、下层点击不被后台停放窗截获。T110：真实双屏/Space/全屏切换，后台保持 T107 耗时、切回不闪烁。T133：焦点不在网页，实按原 ⌘R/⌘W 行为保持。S 层不能由进程窗口枚举替代。
- T111：5 个任务页面同时后台 30 分钟；每 5 分钟执行一次既有合法实际命令并记录整个 App 进程组 RSS 和 CPU。真实结果必须全部成功；RSS(30min) ≤ 1.10 × RSS(10min)，最后四次有效采样不是持续单调上升；空闲平均 CPU <5%。RSS/CPU 进程组和纳入范围要准确（主进程＋渲染进程＋实际本轮 helper 等；不把测试 driver、协调者构建进程和用户日常 App 算作产品开销），以 PID/启动身份和已确认的同轮进程归属取证。应保存 t=0/5/10/15/20/25/30min 原始样本和命令事件、CPU 空闲区间而非只保存一个聚合数；若身份或采样归属未知，保留缺项。与真实旧基线采用相同页面数据、渲染周期、宿主状态以及测量口径。
- 原完整复验根：`docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P103/`。`attempt-002/run.mjs` 是原生 wrapper/资源组观察；`attempt-002/payload/run.mjs:44–67` 是实际 1800 s 驱动；`payload/raw.json`、`result.json`、`resource-samples.jsonl`、`milestone-00/05/10/15/20/25/30.json` 和 `resource-curve.png` 归档原结果；`cpu-proof-review-001/review.py`、`coordinator-case-review.json` 为最终独立归账。后者历史 `RSS30/RSS10=1.01954`，自有进程已观测 CPU 下界 0.8013%，经完整超集证明的保守上界 2.8704%，不是本候选数据。中间 `payload/result.json` 的部分 scopeApproved/formal case credit 仍为 false/0，引用最终独立结论而非把中间文件冒作通过。
- 原驱动每轮为 5 个实际本地 snapshot（7 轮 35 次＋5 暖机），固定静态合成页面；空闲约每 5 秒采样，T107 的点击与截图验证另组。若增加资源组动作，与相同 baseline 同口径记录，不能用增加动作后性能数值随意降低原门槛。
- 不可直接重跑旧 archive：`payload/run.mjs:9–19` 固定旧私有根并验证包／源／依赖／采样器/原生运行时 pin；`L45–46` parkedState 要求 `opacity=0` 透明旧 park window、不可聚焦，F36 刻意取消此宿主；`L53` 用 BrowserWindow 枚举主窗。归档存在 wrapper/驱动/pins 和结果，但没有运行所需 `resource-sampler.py`、`cpu_collector.py`、`coalition_judge.py`、`driver-source/`、`source-snapshot/`、`private-python/`；其记录的原隔离目录 `/private/tmp/willyou-m12-p103-app021-long-002/payload` 已不存在。复核证据不等于可执行的完整重跑包。本候选应新建独立测量驱动，采用同样静态页面、命令节奏、正确进程归属及新主窗有效身份/层级判据，核对实际新根及旧根/越界拒绝条件，从真实软件收据和原始数据判断；不移除或绕开根保护。若缺真实包、完整采样器／进程归属或 30 min 时长，仅计局部技术观察，不称 BE08/T111 已完成。

## 候选回归批次建议（不代替上层已确认用例）

| 批次／层级 | 精确业务步骤与关键证据 | 依赖门槛 |
|---|---|---|
| G1 软件先行 / U | 更新旧 Window、HTML、MCP、files、transfer、voice 测试 fixture 为真正分离 BaseWindow 和 shell，保证先前 contract；运行本文 17 文件及候选新增 host adapter 用例；保留预期红测（parent 缺 WC）、修改后通过，避免补属性假装 BaseWindow | 冻结 candidate 后再运行，基础 API 可验证 |
| BE06-1 / I+A | 同一项目本地合成浏览器 A/B、HTML、MCP、文件、差异和终端；相同主题/尺寸/zoom 与旧 App 对照。可见页存在、背景页层级、右侧 resize、宽窄布局；分别触发已确认的各原浮层、焦点、键盘；HTML/MCP 原生预览 zoom、sheet hide/show 和 drop 后焦点；浏览器截图与遮挡 owner 在途取消。断言真实 UI 可点击、输入框/终端焦点仍在用户前景、WC 不被意外销毁、原页面无视觉退化 | 完成 shell host/layer 适配；系统真实选择器、快捷键按 S 单记；对应 B09、M12-T108/130/133/145 |
| BE07-1 / I+A | 用旧版隔离任务创建两个不同合成身份和本地站点唯一状态，保存 tabs/recents/operation、关闭部分 tab 并正常退出；备份独立数据。候选读旧数据，核对 row schema/key/partition 及页面逻辑身份，真实恢复、导航、关闭/重开、同一 App 内 form 保留；候选重启后核对原承诺持久状态；合成本地 clone/delete/reopen 继续原规则 | 冻结新旧源码/依赖和本地 fixture；旧数据需由旧 App 真实生成，不能用新版 synthetic 数据假冒旧版；B07 |
| BE07-2 / I+A+S | 合法本地站点既有弹窗/新页、页面状态提示和下载（真实内容/字节）、原权限/授权回执；关闭、撤销、有效/失效状态按原规则；普通浏览器内容不得被误认成壳。真实网站、本人密码/登录态交接另列缺项，不将本地合成通过扩张为真实站点通过 | B05/B08；原 M15 A04–A08；system layer 分证 |
| BE08-1 / U+I+A | 用独立合成启动门闩复现先建后迟到、关闭/取消、app hide、页关闭中队列、profile switch/退役、overlay 多 hold/取消、壳 reload/crash、真实退出；每步记录 page/generation、实际计数/receipt/unknown、WC/queue/observer 清场、文件退出 ack；恢复后同一逻辑目标有效，已关闭页不复活 | B10；`registry-shutdown`、`service-budget`、`workspace`；无真实日常 App 故障注入 |
| BE08-2 / I+A+S | 严格 M12-T111 时长/样本条件，在实际候选（及冻结旧 baseline）完成；核对所有所属进程，清场后候选重启验证保存页面以及旧关闭页不复活 | B11；独立资源租约；不得使用缩短计时或单 PID 代替 |

## 可复核文件与实际运行

- `manifest.json`：17 个基线测试文件的 SHA256；已复核与冻结源一致。
- `run_tests.py`、`logs/test.txt`、`logs/run.json`：首次实际命令和 16 个文件、111 个通过及一个收集失败。原因为 `service-budget.test.ts` 导入生产 `exec-policy.ts` 时缺静态 JSON，而非业务失败。
- `static-input-supplement.json`、`run_service_budget.py`、`logs/test-service-budget.txt`、`logs/run-service-budget.json`：从精确 Git blob 补齐静态输入后仅复跑失败 suite，6/6 通过。无 production/policy/测试预期修改。
- `source/src/main/core/files/html/f36-basewindow-compat.test.ts`、`source/src/main/core/voice/f36-basewindow-compat.test.ts`、`run_shape_diagnostics.py`、`logs/test-shape-diagnostics.txt`、`logs/run-shape-diagnostics.json`：两项额外软件诊断，确认现有接口假设不适合新宿主，不是候选通过。
- `summary.json`：按文件的实际通过数、运行版本、缺项。命令只执行 Electron bundled Node，并未启动真实原生应用；原日志中出现沙箱 `task_name_for_pid ... failure (5)` 诊断，不作为产品失败或新宿主结论。

最终状态：本轮完成兼容面审计／既有软件层基线预验。BE06、BE07、BE08 的候选真实 App／系统／资源门槛仍需按原计划执行，不预填通过。

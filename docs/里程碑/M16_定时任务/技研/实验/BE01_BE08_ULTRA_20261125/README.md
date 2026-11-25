# F36 Ultra Review：开发前补充专项证据（BE01–BE08，2026-11-25）

依据 [R0.2 需求](../../../需求.md)、[R0.4 技术方案](../../技术方案.md) 及 [前轮 BE01–BE08](../BE01_BE08_20261125/README.md)。生产起点 `a0acddb3a2325c6bf732adaa7e954ce4d767a2c3`，macOS arm64，Electron 42.11.14。用户同意补齐开发前 Review；各支实验在独立临时源、HOME、userData 及固定回环测试站点完成，不修改生产源、日常应用或用户数据库。三个实验修正补丁分别基于前轮隔离候选，不是已经合并的最终实现；其差异交叉（尤其 page-registry），正式实现按 R0.4 合并职责并完整复验。

## 1. 新增验证与设计收口

| 检查 | 实际结果（保留失败） | 收口依据 |
| --- | --- | --- |
| BE01 宿主初始化、加载失败、关闭/退出取消 | 既有候选新 3 条中 2 红、1 绿；隔离修正与既有回归共 6/6 绿；真实退出处理器提取+依赖替身 5/5（取消、保存/提交/丢弃回执及重试）。现行壳事件发射器/内存 intent 2/2 证明订阅前不重放、重载不能沿用旧意图。 | [host](host/)；正式区分原生宿主、壳 document、UI 订阅与持久结果，先核验退出承诺再拆资源；依赖替身不等同真实系统对话框/服务。 |
| BE02 动态页绘制与恢复 | 真实原生 view、固定 helper，CSS、rAF Canvas、计时及异步 payload；隐藏约 421ms 仍有 +50 rAF／+4 timer／CSS +416.7ms，页面 visibility 仍 visible；恢复后同文档、实际新帧像素，另一页前景保持。三轮 27 PNG 独立核对；多持有者、底层超时未结算、关闭及新代际的独立契约 6/6。 | [资源实验](resource/README.md)、[绘制契约](host/paint-hold-contract.test.mjs)；不把 visible false 等同页面暂停、CPU 降低或释放完成。真实 BrowserService 接线在 S2。 |
| BE03 macOS 原生窗口及实合成 | 前轮候选及旧版开发构建，隔离副屏上的 hide/show/minimize/restore 的 native 状态和 WindowServer 自有窗口记录；初次全屏截屏发生在动画过渡，保留但不作为稳定画面。再等待真实 enter/leave 事件、确切 PID 及标题、连续稳定几何后，修正候选和旧版均实际完成全屏切换、1920×1080 合成画面且退出仍可操作同一网页；严格复验 14/14，候选主窗口 1 个，旧版 2 个。 | [初次系统与往返记录](ui/roundtrip/result.json)、[稳定复验](ui/native-stable/result.json)、[候选](ui/native-stable/candidate-stable-fullscreen.png)／[旧版](ui/native-stable/baseline-stable-fullscreen.png)。实际系统合成不是 AppShell 截图；仍未执行全局 Mission Control、真实系统输入或用户焦点专项。 |
| BE04／05／06 关闭中的旧页、调用者取消、布局/overlay 竞争 | 真 BrowserWorkspace/TabOpen/Registry/SQLite，native 替身，9 条中旧候选 8 红 1 绿、修正候选 9/9、现有回归 57/57、node TS 通过。包括新请求错误复用旧 closing 页、重关重复历史、全取消后加入死 loader、旧 null、快速 A→B→A、迟到 capture。两条新实例参数属合同草图而非旧完整 RPC。 | [软件红绿证据](software/README.md)；按逻辑关闭接受、独立等待者、实例序列及浮层持有者约定收口；真实当次 UI ticket/IPC 和原生过渡不由替身证明。 |
| BE05／06 实际壳重载、迟到布局 | 实际 UI 壳重载后旧 candidate 的页面/表单仍在，但旧 view 仍前景盖住回到首页的壳（roundtrip `layoutCoherent=false`）；另在真实注册表检测旧 A null 将新 B 降层（resource attempt 2）。分别在独立实际候选实施重载降层及 null 只影响自己页的修正，两项重新验证、实际新页点击和页面保留，15/15，node TS 和构建通过。 | [原生红测](resource/attempt-2-stale-placement-red/result.json)、[实际修正补丁](host/shell-native-candidate.patch)、[UI 绿测](ui/shell-native/result.json)；不证明完整原生串行/多类视图协调或瞬时过渡无闪动。 |
| BE07 新旧双向及异常重启 | 先由旧版真实生成新鲜合成数据根，再候选读写、正常退出、旧版读候选新增页、候选受控 `app.exit(23)`、候选恢复；29/29 数据与操作检查，退出码 0/0/23/0、旧 cookie 不重新签发、已关闭页不复活、另一任务不变。首次过期 Cookie 夹具失败保留，重新生成而非放宽预期。 | [往返](ui/roundtrip/result.json)、[首次失败](ui/expired-fixture/result.json)、[新鲜基线](ui/fresh-fixture/result.json)。受控异常退出非断电／SIGKILL；新旧真实进程读取不意味着所有未持久化文档跨重启保存。该轮另外观察到壳重载 UI 红测，已按上一行独立复验。 |
| BE08 动态资源及终态清扫 | 第三轮同一长寿命宿主 20 次动态页创建/导航/真实 helper 点击/关页并保持 anchor，343 检查通过；23/23 实际 WC、daemon/client、端点、queue 清场。短时约 50.35s，不能替代 M12-T111。第一轮发现 `.version` 16B/页、空 helper home 元数据线性残留，旧／新 helper 实现同 SHA；终态专属清扫独立契约 10/10。 | [资源实验](resource/README.md)；临时 close 允许重连、终态 dispose 确认结算及所有权后才清扫，未知保留诊断；三轮固定夹具的外部残留已单次清理并保存清理前 SHA，不能记为生产自然清场。 |

## 2. 证据层与复验边界

- `resource/`、`software/` 是独立实验原始证据及各自 SHA256 清单；`host/` 是宿主单测、真实处理器提取、契约探针、固定 fixture 驱动、补丁与构建源码哈希。`ui/` 只归档合成测试的 JSON、日志及 PNG，不归档完整数据库、profile、浏览器缓存或身份凭据；自有窗口 OS 采集按本轮 PID 且截屏严格按确切自有 CGWindow ID。UI 日志本地调试目标标识按需遮盖。
- [post-exit 复核](ui/verified-post-exit.json)：三组最终正常退出后的独立合成库 WAL 0、SQLite `integrity_check=ok`、DB 维护归属与资源文件一致；各次 renderer error 0，固定本地 fixture server 已关闭。首次过期夹具和第一次壳重载红测不隐藏。
- 重现使用同一冻结前轮候选与旧版，按各子目录的命令／脚本；根宿主实验：在独立源码带相同依赖的副本中放入 `f36-host-review.test.ts`、`f36-shell-events.test.ts`，用原 `scripts/run-tests.mjs` 与固定回归路径，先执行基线再应用 `host-window-candidate.patch`；`node --test paint-hold-contract.test.mjs`；`quit-review.mjs` 从冻结 `main/index.ts` 取实际处理器（见提取产物）。实际构建修正应用 `shell-native-candidate.patch` 后用原 electron-vite 构建及 `tsc --noEmit -p tsconfig.node.json`，运行 `roundtrip.mjs`、`shell-native-green.mjs`、`native-stable.mjs`（需先从实际旧版重建新鲜、完整的独立合成数据根，路径配置见驱动；Collector 编译只用自有临时缓存；脚本经 Node/CDP 表达式预检）。第一轮全屏过渡帧照保留，稳定事件复验取代其视觉结论。所有截图属开发构建及自有合成页面，不是正式安装包，也未使用真实用户 Agent／登录态。
- **评审结论**：开发前架构风险已有实证或独立契约，根因与处理路径已落入 R0.4，原 UI 与 v1 数据方向保持。不再另起同类预研轮次。尚未通过的完整 G1–G3 产品门槛与 G4/G5，以及真实服务、最终 schema/旧会话、真实 Agent/UI、瞬时 native 层级、系统 Mission Control/焦点、正式资源长测、平台、本人操作仍列在 S1–S6／B01–B12，不能算作已交付。正式生产前先完成原定评审。

`MANIFEST.sha256` 覆盖本目录所有归档文件（自身除外）；记录按试验分项保留，不与正式产品用例通过率相加。

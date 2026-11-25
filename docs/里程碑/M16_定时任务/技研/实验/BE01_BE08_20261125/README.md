# F36 BE01–BE08 隔离候选专项验证（2026-11-25）

**性质：开发前技术研究，不是 M16 正式交付。** 依据 [F36 R0.2 / R07–R14](../../../需求.md)、[实验计划](../../浏览器单窗口承载实验计划.md)。用户确认保持现有 WillYou 界面，并授权开展本轮实验。未修改主工作区生产源码、共享原型、日常安装包或日常数据库。

## 1. 冻结基线与复验环境

- 开发分支 `feature/0.1.7`，源码提交 `a0acddb3a2325c6bf732adaa7e954ce4d767a2c3`，独立 Git 源码归档和私有候选位于 `/private/tmp/willyou-f36-lab-tljocnfp`。Electron 42.11.14，macOS arm64。见 [冻结输入记录](snapshot/frozen-source-metadata.json)、[候选源码变化及哈希](snapshot/candidate-source-differences.json)、[可应用的候选实验补丁](snapshot/candidate-only.patch)。补丁仅作为研究证据，不能直接当发布代码；其中非激活／冷隐藏测试入口仅供实验。
- 两份源码均加载实际 WillYou renderer、preload、原主进程与实际业务模块；候选仅对宿主、调用适配和显示状态做试验性修改。私有 Vite 配置统一跳过既有大型 native/application 资源重建、复用已准备资源，只读使用本地锁版本依赖。主工作区此时缺 `@pierre/diffs` 锁版本，从相邻 bugfix 已安装的同锁版本只读复用，两边统一 React 去重；无依赖锁改动。第一次构建缺精确静态文件、第二次缺锁版本依赖，按原 Git blob 与同版本依赖补齐以后两份构建成功；原构建错误和补齐理由保留。见 [实验构建配置增量](snapshot/private-build-config.patch)、[构建与回归日志](software/candidate/)。
- 所有 UI 测试各用独立 HOME/userData、隔离工程、固定回环网页与合成任务；执行器仅为可检测的空闲任务夹具，禁止运行实际模型或登录。测试只控制本次隔离身份和固定合成页面。窗口在已有副屏约 1320×850（此机共 3 屏）；记录非激活、页级模拟焦点和实际业务回执，不以后台 CDP 冒充原生系统焦点。真正 Mission Control、全屏/Space、其他平台、正式打包 App 不在这些结果的通过范围内。
- 记录按 E（技术探针）、U（软件单测）、I（集成）、开发构建实际 UI 分层。这里没有 A（正式隔离打包 App）或 S（系统操作／本人确认）完成结果。源码、关键产物哈希和清场记录见本目录；不归档测试数据库、HOME、Cookie 文件、执行器数据或整个安装包。隔离日志中的已关闭调试目标 URL 在归档时移去临时路径令牌；实际合成业务回执和像素不作改写。

## 2. 结果索引和门槛

| 实验 | 已获得的直接证据 | 去往正式开发／验收前仍需关注 |
| --- | --- | --- |
| BE01 | 真实 renderer/preload 加载；BaseWindow 与显式 shell；窗口与壳分离、原有 IPC/正常退出；node/web 类型检查和相关单测 | 完整系统菜单/快捷键、原生文件对话框、shell 异常重载及可信界面旧代际回归 |
| BE02 | 两份实际开发构建的页面切换与像素；冷隐藏下实际 BrowserPageRegistry、BrowserReferences、固定 helper、页级截图 | 将绘制占用与实际 service 命令、截图、取消、初始化握手整合；独立 E 层资源试验不能替代候选全部链路 |
| BE03 | 普通页存在时旧版两个原生窗、候选一窗；副屏放置、非激活、原生 hide/showInactive 保持页面、冷隐藏未 show | Mission Control 缩略图/Space、全屏、最小化/系统恢复、原生焦点和多屏系统操作，需按系统层真实验 |
| BE04 | 旧版实际 BrowserService/BrowserWorkspace/SQLite 软件契约、失效标签与重开；本地 schema 互斥诊断 | 生成器到实际 provider MCP schema、冻结会话、真实服务模式开页/撤销；不修改现行权限 |
| BE05 | 三种真实 renderer 软件时序红测；相同断言在候选转绿；新展示不可被旧自动清理误撤销，手动关闭立即撤销旧展示 | 真正 Agent 输入、主进程接受/展示事件和实际右侧联动复验；原始现场尚无完整脱敏事件链 |
| BE06 | 实际旧/新壳截图对照、原生网页后台层级、浏览器菜单遮挡、HTML 真实预览及返回浏览器原页面 | 浅/深色及其他尺寸、文件 chooser、MCP UI、终端、差异、系统输入/焦点、其他浮层的完整矩阵 |
| BE07 | 从正常退出的旧版真实生成数据恢复标签、profile、旧 Cookie；本地 HTML 兼容及文档重建 | 多 profile/导入/删除、授权子窗、下载、本人登录接力及正式升级回归 |
| BE08 | 软件层关闭/资源基线、冷隐藏 helper 清理、实际独立五页策略试验（见资源小节） | 候选实际 service 的异常队列、崩溃恢复、绘制占用竞态与正式 M12-T111 |

BE00、前两项局部 API／冷隐藏探针保持原始记录：[BE00](../BE00_20261125/README.md)、[BE01/BE02 初次探针](../BE01_BE02_20261125/README.md)。以上没有把 G1–G3 整组或正式 B01–B11 标为通过；BE09/BE10 不在本轮研究验收范围。

## 3. 实际开发构建：窗口黑框根因、界面一致性及数据兼容

### 3.1 旧/新同驱动对照（BE01/02/03/06）

| 验证 | 旧版隔离构建 | 新宿主隔离候选 |
| --- | --- | --- |
| 开页后普通系统窗口 | `WillYou` 和 `WillYou browser background` 两个 BrowserWindow | 始终一个原生 BaseWindow，AppShell 和网页各自有 WebContentsView；无额外 BrowserWindow |
| 两个任务的切换、返回 | 实际点击、文档身份、表单保留；原生页在两系统窗口间转移 | 实际点击、文档身份及表单保留；只在同一宿主内调整 native child 顺序 |
| 菜单遮挡 | 原生页停放在额外窗口，不盖 DOM 菜单 | 两网页位于壳之后；菜单实际显示，关闭后原页仍存在 |
| 关闭最后标签、再开 | 原页消失，新标签/原生页 ID；同 profile | 同样判据，原生页不占独立窗 |
| 实际回执 | 15/15；renderer errors 0，退出 0/null | 15/15；renderer errors 0，退出 0/null |

原始：[旧版结果](ui/fresh/baseline/result.json)、[候选结果](ui/fresh/candidate/result.json)、[实际 UI 驱动](ui/driver/ui-probe.mjs)、[独立像素复核](verified-actual.json)。两任务稳定切换时实际候选层序是 `后台 A → AppShell → 前景 B`，返回时 `后台 B → AppShell → 前景 A`，出菜单时 `A/B → AppShell`。个别开页瞬时拓扑在布局异步完成之前取样，不能用这些点宣称前景已经完成挂载；后续追加了目标前景层稳定等待和窗口隐藏恢复复验（见下段）。对照 shell 的 home、两次打开、重新打开截图像素完全一致，菜单图为约 99.2% 像素一致（状态或时序造成局部差异，不宣称完整视觉同一）。网页自身前/后台截图按当时 CSS 尺寸换算像素，红/绿计数色块均真实更新。壳截图不包含所有原生子视图合成，系统体验仍须单独验证。

旧版初次 UI 驱动曾受 Electron 启动路径包含同名 JSON、任务检测夹具配置和键入 Enter 方式影响；最终正确固定测试工具与地址输入，并将控件坐标单次观测改为有界稳定等待。候选第一遍的控件坐标在布局变化中移动 14px，驱动拒绝派发并保留现场；未修改待验收交互或接受错误坐标。新旧最终以相同驱动重跑。初次候选启动在副屏成功并正常退出：[启动记录](ui/startup-candidate/result.json)。所有有结果的历史尝试见 [attempts](ui/attempts/)。

**追加严格前景层与窗口隐藏恢复对照：** [同一补充驱动](ui/driver/foreground-probe.mjs)在每次地址导航及回到页后等待两次原生层级实际匹配，逐项核对菜单打开时降层、关闭恢复前景，最后标签关后再次打开的**新原生页确已在最前**。再对精确绑定的独立 NativeWindow 使用 hide/showInactive，窗口隐藏时实测网页点击/截图，恢复时同一原生页、文档、按钮计数均保持。两组各 24/24、正常退出、0 renderer errors；候选主窗隐藏时只有一个（隐藏）原生窗口，旧版仍有独立 `WillYou browser background` 窗口。原生状态与隐藏页像素见[候选](ui/foreground-confirm/candidate/result.json)、[旧版](ui/foreground-confirm/baseline/result.json)和[离线复核](verified-actual.json)。首次补充驱动注册的检查标签大小写不符合 harness 的安全命名约定，未发恢复动作；修正该标签后以同判据复验两组通过，[原尝试](ui/attempts/candidate-ui-pxybsg/result.json)保留。这里是本次隔离应用的程序化窗口操作，不等于真实系统调度中心、Dock、最小化或全屏切换的 S 层通过。

### 3.2 冷隐藏实际注册表与固定 helper（BE02/08）

[固定本地注册表探针](native-registry/driver/registry-cold-probe.ts)从未显示唯一宿主，先挂静态壳，再用候选实际 `BrowserPageRegistry` 创建两个独立任务/项目的固定 file 页，使用项目自身 `BrowserReferences.snapshot`、固定版本 agent-browser（SHA 与资源清单一致）及既有页级截图通路。依次验 A 冷隐藏、B 前景层（系统窗仍隐藏）、A 背景和 A 真关后重新创建。四组均完成实际无障碍快照、真实固定按钮计数 +1、同文档、PNG 色块与几何复核。两个项目 profile 不同；三次关闭核对 helper/client、套接字和内容销毁，最后原生窗与 WebContents 都为 0。最终 27/27、退出码 0；快照约 10.5–131.8 ms、点击约 8.6–11.3 ms、截图约 24.7–37.3 ms，仅为这次固定夹具的观测，不是产品性能指标。[实际结果](native-registry/runs/registry-cold-2cbzxvvx/result.json)、[启动退出回执](native-registry/runs/registry-cold-2cbzxvvx/launch.json)。

两次发现场景特别值得正式实现注意：`registry.close()` 返回时逻辑页/层级与 helper 已收尾，但 WebContents 的实际销毁未必同步，第一次探针以立即销毁判据失败；第二次已等实际销毁，却被 Electron 默认的 `window-all-closed` 自动退出打断最终回执。第三次明确等待销毁、由本次实验显式结算退出，所有内容清场。原结果在同一 [runs](native-registry/runs/) 下保留。此为真实注册表和下层 helper 的 I 层证据；没有声称真实 Agent、完整服务授权/回执或系统焦点通过。

### 3.3 旧数据和原生 HTML 预览（BE06/07）

使用旧版实际 UI 生成、正常退出的合成样本。两份新试验各复制其已 checkpoint 的 SQLite 数据和配套资源归属/浏览器分区，保持旧库哈希相等；不复制运行时锁、调试端口、日常资料。以原合成回环端口重新提供固定页面，服务端**不再下发 Cookie**，核对旧 Cookie 既出现在真实请求也在页面文档中。两份均 12/12，原逻辑标签及 profile ID 恢复、已关闭页不复活，Cookie 可用、未保存表单按整进程重启重新创建；通过原生文件树实际点击 `fixture.html` 打开原 HTML 预览（实际文档文本、外层 view 几何、独立 PNG），切回浏览器后该页原生文档保持。两份均 0 renderer errors、正常退出。[旧版复验](ui/restore/baseline/result.json)、[候选复验](ui/restore/candidate/result.json)、[恢复驱动](ui/driver/restore-probe.mjs)。

首次恢复驱动只复制 `smartdd.db` 与 `Partitions`，在启动出现原有「数据库维护归属不一致」保护；测试驱动超时走已有启动失败的 SIGKILL 回收分支（仅本次独立进程，随后确认 PID 不存在；不计作正常业务退出），定位 `ResourceStore` 所属资源身份与库内 maintenance owner 不一致。**没有改生产数据库、没有关闭此校验**。第二次补齐资源目录后，只读 sqlite 命令在独立 WAL 文件前置上不能打开检查；最终先核对旧 WAL 已空，以只读 immutable 副本仅做静态归属预检，再让正式 App 的正常受管数据库启动逻辑接管。两个完整旧样本复验通过。首次失败和驱动预检问题保留，真实生产升级仍应直接沿用用户原完整数据根，不拆分复制数据库与资源所有权。[首次启动失败](ui/attempts/candidate-ui-SKxsAK/result.json)。

## 4. 软件层红测、兼容面及候选回归（BE04/05/06/07/08）

- [关闭重开／展示意图原始复现](software/reopen/README.md)：旧版在自动空状态收尾发生时错误撤销新展示意图，分别命中 select 前、select 返回后两个 guard；手动点击关最后页却没有及时撤销已在途的旧展示意图。确定性软件层时序重复复现；候选只让自动关闭面板不撤销新意图，并在用户显式 `close` 动作开始时同步撤销旧展示，保留最新任务/页核验；相同 BE05 8/8 及补充红 C 1/1 变绿（补充运行仅选定该用例，另外八条已有独立结果）。见 [候选回归](software/candidate/candidate-be05.log)、[补充 C](software/candidate/candidate-prior-close.log)、对应 jsonl。真实 Agent UI 端到端仍未执行。
- BE04 真实主进程软件实验与内存 SQLite 契约 4/4、现有 workspace 14/14、service open 3/3。当前宿主已有参数校验；生成命令 schema 尚未表达互斥，独立诊断验证通用 schema 可以表示，不等于 provider 实际投影或旧冻结会话已验证。参阅 [BE04/05 详细记录](software/reopen/README.md)。
- [兼容面与基线软件测试](software/compatibility/audit.md)：17 个既有文件 117/117；先前一项因缺静态输入收集失败，补齐同 Git blob 再通过；独立两个宿主形状诊断只作设计证据。其列表给出文件/HTML/MCP/父窗口/语音/业务数据及异常清理的具体调用面，不计作新候选通过。
- 候选的窗口／终端归属／HTML／浏览器展示与组件原有五个文件，经适配测试夹具后 44/44、node/web tsc 均通过；测试夹具以真实无 `.webContents` 的主窗+壳组合为基础。最初 TypeScript 暴露窗口模块将 `icon` 特定资源导入传入 Web 类型树等问题，后拆出仅含运行引用的 `window-host.ts`，而非用强制类型或伪造属性掩盖。候选重新类型检查和构建后相关五文件再跑 44/44：[最终回归](software/candidate/candidate-affected-tests-v2.log)；保留原类型检查及构建失败日志。测试计数有重叠，不相加作为 M16 用例数。

## 5. 五页绘制策略与长期资源（BE08）

两组独立合成策略保持同一锁定 Electron、从未显示的单原生宿主、五个固定本地页以及相同操作，仅闲置时是否 `setVisible(false)` 不同；每次实际点击／截图前恢复 paintable，按真实状态结算。测试使用相同机器连续串行运行，环境正常使用、非受控实验室，不把单次比较当性能因果证明。详见 [方法和统计口径](resource/driver/README.md)。

先各跑 30 秒短测，均 40/40（含暖身）、全关联进程覆盖、内容像素及清场通过；短测的 30/10 **秒** 比不是正式 30 分钟判据。[keep-short](resource/keep-short/summary.json)、[idle-short](resource/idle-short/summary.json)、[短测比较](resource/short-comparison.json)。随后两组各完整运行实际 **30 分钟**（测量分别 1800.17 / 1800.15 秒），每 5 分钟完成全部五页真实点击与截图，按 5 秒采样全 Electron 关联进程。没有改时钟或替代实际操作；两组均无本次进程组遗留。原始记录：[keep-long](resource/keep-long/summary.json)、[idle-long](resource/idle-long/summary.json) 及各自 raw.jsonl、截图和退出记录；[独立复核](resource/verified-long.json)、[同协议比较](resource/long-comparison.json)、[采样曲线](resource/long-trend.png)。

| 30 分钟合成策略 | 30/10 分钟 working set（探索门槛 ≤110%） | 最后四点非严格递增 | 空闲累计 CPU（单逻辑核口径，探索门槛 <5%） | 实际点击／截图及清场 |
| --- | --- | --- | --- | --- |
| keep（持续可绘制） | 101.64% | 不满足（严格递增）：864656→864736→865904→873456 KiB | 0.310% | 40/40、清场通过 |
| idle（按需恢复可绘制） | 99.83% | 满足（非严格递增）：862528→862384→853792→861152 KiB | 0.318% | 40/40、清场通过 |

- 两组分别有 368 / 368 个原始资源采样点，所有已知关联 PID 均在覆盖内；累计 CPU 的已观察空闲时间覆盖分别为 100.00% / 100.00%。五页固定定时器中位频率 10.00 / 10.00 Hz，说明本夹具隐藏后页面仍在执行。固定检查点页面操作（点击+截图等的同口径合计）中位 31.84 / 32.46 ms；不是实际产品命令 SLA。
- keep 10→30 分钟总 working set 净变化 +14128 KiB，其中主进程 +5904、Tab renderer（含壳）+8096 KiB；idle 对应总变化 -1440 KiB，其中主进程 -7056、GPU -2016、Tab renderer（含壳）+7664 KiB。两组页面 renderer 均有净增加，按需绘制组总量的回落不等于 renderer 已无增长；空闲 CPU 也不是 idle 更低，不能把此次结果宣称为 CPU 节省或内存泄漏已解决。同一组 10 分钟与 30 分钟的原生进程身份 一致 / 一致，两组均退出 0。保留 keep 的趋势失败，不能仅凭 1.6% 左右的增幅断言长期泄漏或用其他指标冲抵。
- 按需隐藏／恢复满足三项同形状探索判据；持续绘制组有趋势项未满足。支持以按需绘制占用为生产实现首选，而非始终强制各逻辑页都 paintable。 但累计内存是 Electron 报告的各进程 working set 汇总（共享页可能重复计），并非系统实际独占 RSS；固定计时/按钮网页不能代表真实站点、代理、CLI、PTY 或完整 WillYou。生产实现仍须把多持有者、底层捕获结算、并发关闭与恢复接入实际 BrowserService，再按 M12-T107/T111 的真实指令和全部关联进程口径做正式候选对照。这组结果不是正式 T111 或 G3 整组通过。

## 6. 复现与验收边界

1. 从冻结 Git 提交导出 [所记录的源码目录及额外静态输入](snapshot/frozen-source-metadata.json)，创建两个独立私有根，使用同一锁版本依赖及已验证的准备资源。本轮候选补丁可在隔离源码根 `git apply --check`，仅用于还原实验；在 candidate 根应用补丁并在两根使用同一私有构建配置，再 `pnpm exec electron-vite build`。禁止给生产根加实验专用环境变量或覆盖日常 App。核心构建产物/输入关联见 `snapshot/`。
2. [驱动](ui/driver/)硬编码本轮私有根与合成旧样本名，复跑时改为新建的私有根与由同轮旧版真实生成的样本；先 `node --check` 及仓库的 `check-cdp-expressions.mjs`。执行 `node <ui-probe.mjs> baseline fresh`、`... candidate fresh`；然后用 `restore-probe.mjs` 的两个 mode 对同轮已正常退出的旧样本各做独立副本。动态表达式由实际运行验证。不要复制本轮数据到日常目录。
3. [原生注册表驱动](native-registry/driver/)复制到隔离候选源根，使用该根 Vite 所依赖的 esbuild，`bundle:true, platform:'node', format:'cjs', external:['electron']`，解析 `@shared`、`@main`、`@source`、`@root` 至本根源码，输出 `registry-cold-probe.cjs`；`run-cold-registry.py` 改为同一私有父根并执行，每轮另建独立数据。固定 helper/identity 二进制与版本 SHA 核验不省略。所有截图的像素与真实操作/销毁回执均保留。
4. 软件层按[重开软件证据](software/reopen/README.md)、[兼容证据复现](software/compatibility/REPRODUCE.md)的独立指令复跑；使用同一红测判据而不是更改预期。在本目录 `python3 verify_actual.py` 可离线根据已保存 JSON/PNG 验证真实界面和原生注册表结果，须有 Pillow。资源比较程序见 `resource/driver/`，本轮另有 `python3 resource/verify_long.py`、`python3 resource/plot_long.py` 用已保存证据重新独立核验和作图。
5. 正式 M16 开发后应重新冻结实际新包，按 [原计划](../../浏览器单窗口承载实验计划.md) 和 [M16 用例](../../../验收/测试用例.md) 逐项完成尚未通过的层级；本轮数据不等于整条产品验收。主进程宿主、页面层级、绘制占用、关闭重开和文件/MCP 适配宜拆成可回归单位推进；正式 F16 联调独立评审。

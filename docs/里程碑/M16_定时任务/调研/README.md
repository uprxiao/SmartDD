# M16 调研

2026-11-14 编号调整（用户确认）：原 M14 定时任务顺延为 M15，原 M14-R01–R06 对应 M15-R01–R06；F16、业务范围和待规划状态保持。新增的 [M14 统一 Agent 工作区](../../M14_统一Agent工作区/README.md)先行；下方带日期的旧编号保留为历史。

2026-11-10 编号调整（用户确认）：新增 M13「已有应用、Skill、MCP 插件化重构」，定时任务由 M13 顺延为 M14；原 M13-R01–R06 对应 M14-R01–R06。F16、业务范围和待规划状态保持；下方带日期的旧编号保留为历史。

2026-11-01 编号调整：原 M11 定时任务顺延为 M12；业务内容、准备程度与未执行状态保持。

2026-11-02 编号再调整（用户确认）：「浏览器自动化」插队为 M12，定时任务顺延为 M13；业务内容、准备程度与未执行状态保持。

依据：[需求](../需求.md)。F16 M16-R01–R06 已完成参考源码的初步调研，并形成本轮评审原型；F36 M16-R07–R14 已完成现状与参考源码梳理，专项实验待推进。

## F16 定时任务调研（2026-11-25）

本机 T3 Code `31d95f850b` 与 Orca `17bd6da1098` 的定时任务实现、WillYou 现有模块复用点以及 P0.1 原型的待评审规则见 [F16 源码对照与初版交互建议](F16_T3Code与Orca定时任务源码对照_20261125.md)。参考行为已走读源码，生产调度选型、专项实验和规则确认留待后续。

后续围绕时间规则、退出／睡眠／错过执行、并发去重及任务结果记录使用场景、参考行为、证据版本与未确认项。已有用户目标以需求文档为准，不在本页复制完整业务规则；技术选型进入[技研](../技研/技术方案.md)。

## F36 单窗口浏览器承载调研（2026-11-25）

| 来源／版本 | 已核实事实 | 证据与边界 |
| --- | --- | --- |
| 现场用户反馈及只读调用记录 | macOS 调度中心出现 WillYou browser background 黑缩略图；另一反馈为关标签后再次开页。2026-11-25 10:20:20 同时传旧 pageId 与 URL 被拒（INVALID_INPUT），10:20:28 对旧页导航报 BROWSER_TAB_NOT_FOUND，10:20:40 新建请求受理，10:20:45 新页 ready；随后读取/截图有成功记录，截图中右侧仍未展示。 | 同任务的 browser_operations 和保存标签中可核验旧闭页、新页；仅记脱敏状态事实，未归档用户 DB、账号密码或网站内容。展示事件具体被忽略的环节需 BE05 复现，不把渲染猜测写成事实。 |
| WillYou 源码与已安装包代码 | 当前 park-window.ts 创建透明 BrowserWindow 后 showInactive，excludedFromShownWindowsMenu 只处理菜单；未配置 hiddenInMissionControl／fullscreenable。page-registry.ts 给普通页在该窗和主窗之间迁移。 | [park-window.ts](../../../../src/main/core/browser/park-window.ts)、[page-registry.ts](../../../../src/main/core/browser/page-registry.ts)。已确认窗口名称和配置，未对现场进入独立 Space 的确切系统事件取证。 |
| M12 原技术研究 | 当时确实参考 Orca；因 WillYou 当前主窗口已有特权 preload、M9 预览采用 WebContentsView、切任务 UI 卸载等，选择主进程管理页面。E1 发现无绘制时输入/截图退化，适配出透明停放窗口。 | [Orca 原研究](../../M12_浏览器自动化/调研/Orca浏览器CLI与Skill链路_20261103.md)、[K1/K3 选型](../../M12_浏览器自动化/调研/WillYou冲突核对_20261103.md)、[D6 实验含更正](../../M12_浏览器自动化/技研/D6_agent-browser核实与E1实验_20261103.md)。保留历史边界，不追写原通过。 |
| Orca 本机源码（/Users/liubu/hx/3.GitHubProject/orca） | 历史对标 bd9455b6165；11-25 读本地 17bd6da1098。BrowserPaneOverlayLayer 保留 WebView 稳定父容器，browser-page-viewport 通过 paintable/active 控制隐藏、透明绘制及不接受 pointer；主进程 capture paint hold 多持有者。Skill 对无标签/失效标签有恢复提示。 | 本地源码：src/renderer/src/components/browser-pane/host-guest/viewport/browser-page-viewport.ts、src/main/browser/guest-lifecycle/manager/browser-manager-visibility.ts、skill-guides/orca-cli/references/browser.md。普通桌面标签不靠独立透明窗；仅源码分析，未运行 Orca。 |
| T3 Code 本机快照 fdce61c0（2026-11-24） | ElectronBrowserHost 在 AppRoot 保持 WebView；hostedBrowserWebviewStyle 将需绘制的页放在主界面后方，其他页屏幕外或保持可绘制状态；源码针对 macOS WebView 黑屏有专门兼容说明。 | 本机 /private/tmp/src-snapshots/t3code 快照；apps/web/src/browser/ElectronBrowserHost.tsx、HostedBrowserWebview.tsx、hostedBrowserWebviewStyle.ts。仅读源码，不外推真实表现。 |
| Electron 官方（2026-11-25 核对） | [Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds/) 不推荐依赖 WebView 的长期稳定性，支持 WebContentsView 在同一 BaseWindow 组合；[BaseWindow](https://www.electronjs.org/docs/latest/api/base-window/) 子 WebContents 的资源需要显式关闭。 | 官方接口和项目本地 Electron 42.11.14；具体原生行为须在锁定版本实测。 |
| F36 初步技术实验 | 在本机真实 Electron 的独立合成页，显式 BaseWindow 多 view 架构完成规定的输入＋截图检查；WebView 透明/遮挡近似场景出现截图超时。 | [BE00 原始证据与核验](../技研/实验/BE00_20261125/README.md)，含首次夹具缺口与第二轮更正。不代表正式 App、Orca/T3 整体、全部平台或长期性能验证。 |

选择结论及实施详细方案仅维护在 [技术方案](../技研/技术方案.md)；后续专项 [实验计划](../技研/浏览器单窗口承载实验计划.md) 验证风险门槛及未知项。

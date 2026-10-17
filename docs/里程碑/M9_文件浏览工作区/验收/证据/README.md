# M9 原型浏览器取证

**P1证据入口（2026-10-17）：** 当前新增证据按[开发前执行账](../../开发前目标与执行记录.md)与[验收参数](../开发前P1_验收补充.md)关联。predev-*包含隔离实验、真实临时文件和引擎试包，均不是正式App验收；CLI截图明确为实际PTY字节回放。

文档修订：R3.3-20261017；当前原型已按 D01/D07 本机范围修订，本文旧浏览器载荷仍对应各批原始基线。本文归档各批合成数据原型的真实浏览器检查，不是 Codex 运行参考，也不是正式 App 的425条用例总账的执行结果（本期/后续远程适用性分列）。全部正式用例保持未执行。历史 JSON/PNG 与原运行时间、范围保持不变，早期文件内的385条口径对应当时R2，不能据此改写原始证据。

R3.1汇总：原型模型145项通过；R2有20组REA操作和3项补充检查，R3有Markdown18、PDF/Notebook23、业务闭环24项通过，交互矩阵30通过/7未验证。上一轮R3.1只核实证据完整性，未重跑浏览器场景；12张R3截图哈希均匹配，详见[执行记录§11](../执行与缺陷记录.md#11-r31-文档收口与当前原型复核)。17份隔离实验运行报告另见[实验入口](../../技研/实验/README.md)，不混入原型浏览器结果。

用户后续明确要求不再操作或查看 Codex，见[执行记录M9-D14](../执行与缺陷记录.md#8-r3-第二批gap-04-office-写回保真)。旧参考采样计划失效，不通过换工具、换入口或隔离副本重试；下列本地原型检查不构成该操作授权。

通过 REA `capture_browser_scenario` 的 `browser.mode=launch` 启动 provider-owned Chromium 155.0.8059.80；1512×949、DPR1、zh-CN、空白浏览器存储，仅打开 `http://127.0.0.1:4176/?preview=m9`。结束由 provider 关闭自有进程。没有连接现有 Chrome、读取浏览器历史或控制 Codex。此前连接现有 Chrome 的审批拒绝只作为工具尝试历史，此后安全替代已成功，不再等待该授权。

每组 JSON 保存 REA evidence ID、步骤状态、AX、console/page-error事件、截图哈希及工具完整性边界。PNG为原始浏览器截图，没有编辑、裁剪或伪造。聚合信息见 [机器摘要](prototype-ui-summary.json)。普通 `completed` 只表示动作执行成功；下表列出另外核对的预期，不等于全功能通过。

| 组 | 操作与实际核对 | 截图 / 记录 |
| --- | --- | --- |
| 默认浅色 | 文件区、目录树、AGENTS.md与中央终端同时可见；没有捕获页面错误 | [PNG](prototype-initial-light.png) / [JSON](prototype-initial-light.json) |
| 深色 | 点击主题后全局与文件区切到深色，字体和图标可见；未作参考深色像素断言 | [PNG](prototype-dark.png) / [JSON](prototype-dark.json) |
| 筛选/编辑/保存 | 筛选package→打开→输入合成JSON→等待3.3秒；内容m9-edited保留，固定标签，提示保存到原型示例数据 | [PNG](prototype-edit-save.png) / [JSON](prototype-edit-save.json) |
| 全文搜索 | 独立对话框搜索“文件”、mask `*.md`，打开首条；进入AGENTS.md源码，截图可见第3行匹配位置被选择 | [PNG](prototype-content-search.png) / [JSON](prototype-content-search.json) |
| 脏文件关闭保护 | 设置外部冲突→尝试关闭；保留原标签与本地修改，显示继续查看/放弃修改并关闭 | [PNG](prototype-dirty-close.png) / [JSON](prototype-dirty-close.json) |
| PDF | 打开PDF fixture→50%→评论请求；菜单、50%和评论文字存在；收起缩略栏文字挤压已修复后重拍 | [PNG](prototype-pdf.png) / [JSON](prototype-pdf.json) |
| Notebook | 打开→展开Code→查看HTML源码→Tab；标题/计数、源码、复制按钮可见，未执行单元 | [PNG](prototype-notebook.png) / [JSON](prototype-notebook.json) |
| Notebook环境复验 | 不改代码与iframe权限，只把测试浏览器service_workers改allow；重复4步，未捕获前次错误 | [PNG](prototype-notebook-recheck.png) / [JSON](prototype-notebook-recheck.json) |
| XLSX示例 | 编辑第一表B2、切第二表编辑B2、返回第一表并等保存；第一表仍显示“第一张表修改” | [PNG](prototype-workbook.png) / [JSON](prototype-workbook.json) |
| Markdown画廊 | 旧灯箱→下一张→放大→关闭；打开模拟开关→新只读叠层；终态1/2，未引入图片编辑/composer | [PNG](prototype-gallery.png) / [JSON](prototype-gallery.json) |
| 关闭/恢复 | 编辑package→自动保存→Meta+S→关闭→恢复；重新出现选中package标签及restore-proof内容 | [PNG](prototype-close-restore.png) / [JSON](prototype-close-restore.json) |

## R1发现和复验边界

- 初次PDF `has-text("50%")`同时匹配50%/150%，Notebook嵌套summary也匹配两项；工具按strict selector拒绝，后续步骤取消。改为精确匹配后重跑通过。这是测试选择器问题，没有凭失败动作填写通过；表中关联最终成功记录。
- Notebook默认测试环境出现 `SecurityError: Failed to read the 'serviceWorker' property from 'Navigator'`，stack为匿名初始化脚本。原型源码没有访问serviceWorker，HTML iframe使用`sandbox=""`且无脚本；只改变REA浏览器service_workers环境后错误消失，支持“测试环境注入与opaque iframe不兼容”的判断，但没有读到provider内部脚本，不把归因标为已证实。保留初次错误记录；没有添加allow-same-origin、allow-scripts来消除它。
- 以上没有执行真实文件读写、Office编解码、PDF渲染引擎、媒体codec、模型/LSP/MCP、原生watch/外开、真实崩溃恢复。未捕获错误仅限各操作窗口。
- 用户参考为1989×1248，来源设备密度/缩放未知。已查看完整原图与原型完整画面，确认总体区域关系；没有同尺度逐像素误差统计。工具栏/标签图标、正文换行、Office深层控件、各种键盘/触摸与条件状态仍待精确对齐。

当前可恢复源基线见 [原型快照](../../原型/快照/README.md)。截图保持各次真实操作时的内容；后续只补受影响复验，不把老截图改写为新实现结果。


## R2 新增取证（2026-10-17）

本轮新增20组REA操作、235个步骤（包含20个scenario_start），动作全部completed，未捕获page-error；另有3项普通Playwright补充验证。仅下列具体现象被核对，动作成功不等于完整功能通过。完整ID、步骤、SHA-256与截图见[机器摘要](r2-ui-summary.json)。R1截图和模型结果保留当时版本，不改写为R2。

| 分组 | 核对内容 | 记录 |
| --- | --- | --- |
| Markdown原位编辑 | 点击标题→源码块输入→Meta+S→退出编辑；新标题保留，文档恢复格式 | [PNG](r2-markdown.png) / [JSON](r2-markdown.json) |
| 多根保存 | 同名package在两个独立根分别保存；返回主根仍为main-root-proof | [PNG](r2-roots.png) / [JSON](r2-roots.json) |
| 树和菜单键盘 | ArrowDown/Right、Shift+F10、菜单ArrowDown/Escape、回父目录；焦点归父目录 | [PNG](r2-keyboard.png) / [JSON](r2-keyboard.json) |
| 图片菜单与画廊 | 打开/缩放/换图/关闭，GIF场景右键；菜单位于图片旁，无添加/复制图片项 | [PNG](r2-gallery.png) / [JSON](r2-gallery.json) |
| 嵌套根 | 从主根docs/需求.md编辑保存，再从嵌套根需求.md打开；仍同一标签与nested-alias-proof | [PNG](r2-nested.png) / [JSON](r2-nested.json)；之后仅补当前根选中样式，未重拍此图 |
| 跨任务恢复 | T1筛选main.ts、打开；T2筛选package；回T1恢复main.ts和标签/选中 | [PNG](r2-task-restore.png) / [JSON](r2-task-restore.json) |
| Office保存回执 | 公式栏输入SUM(2,3)，未失焦Meta+S后Enter；A1显示5，无未保存标记 | [PNG](r2-office-save-ack.png) / [JSON](r2-office-save-ack.json) |
| Office五组 | XLSX公式/格式/sheet/undo；PPT对象/图表/grid/notes；DOCX双路线/修订/草稿；sheet右键与能力门控；PPT快捷键/只读 | [五组清单与hash](r2-office-validation.json)、[逐组说明](../../原型/Office补齐说明.md)；gates场景当时发现的保存后dirty由上一行复验关闭 |
| PDF/Notebook八组 | PDF文字region、失败保留队列、重试清空、缩放clamp/错误/注释门控、review深色；Notebook description、MIME、空/错误 | [逐组ID与截图](../../原型/PDF与Notebook补齐说明.md)；统计分列在机器摘要 |
| 补充三项 | PDF矩形拖选、Working停止后保留队列；Notebook空sandbox/no-referrer、无脚本/外链及有效PNG/JPEG/SVG | [补充JSON](r2-artifact-supplemental.json)、[矩形](r2-artifact-pdf-rectangle.png)、[停止](r2-artifact-pdf-stopped.png)、[iframe](r2-artifact-notebook-html.png) |

### 失败与修正保留

- 图片菜单初次动作completed但实际离开图片，定位CSS被通用样式覆盖：[初次](r2-gallery-before.json)、[明确布局失败](r2-gallery-cascade-failure.json)。提高局部CSS优先级后，r2-gallery截图才作为菜单位置证据。
- 键盘初次菜单延迟归还焦点会抢回下一键：[旧记录](r2-keyboard-before.json)。同步归还后有r2-keyboard复验；叶子右箭头不跳行由模型补验。
- 跨任务首轮两个按钮含额外时刻/菜单文本，text-is精确选择器未命中：[首次](r2-task-selector-failure.json)、[返程](r2-task-return-selector-failure.json)。改has-text后才有最终成功记录；失败后的步骤保持cancelled。
- Office首次错误gridcell选择器、PDF早期超时/无匹配、Notebook早期无效JPEG见对应补齐说明，不算正式成功场景。部分artifact图保留修复前的父标题/工具栏，不能用作最终整页外观证据。

R2仍未观察Codex原生UI，未做同尺寸全状态像素比较。Office/PDF/Markdown/媒体展示均有合成限制；模型/能力开关、触屏、复杂parser及真实服务的未覆盖项见[差异账](../../原型/R2补齐与差异账.md)。真实文件系统/Office引擎实验另放[技研实验](../../技研/实验/README.md)，不能与本页原型取证互相替代。

## R3 Markdown 取证

日期：2026-10-17。M9-GAP-03。脚本 [r3-markdown-check.mjs](r3-markdown-check.mjs) 用 playwright-core 驱动本机 Google Chrome（headless、独立上下文、空白存储、1512×949、DPR1），只访问 `http://127.0.0.1:4176/?preview=m9`。**这不是 REA 取证，也不是 Codex 参考运行**；结果 [r3-markdown-check.json](r3-markdown-check.json) 含截图 SHA-256。18 项全部通过，没有 pageerror/console error（R3-MD15–18 为重构后回归与迟到 Mermaid 检查，后补入）。

| 检查 | 内容 | 截图 |
| --- | --- | --- |
| R3-MD01–MD07 | 公式、Mermaid 序列/类图、类图标签文字、表格对齐、HTML 转义、frontmatter 与引用定义、列表与任务项 | [语法全集顶部](r3-markdown-syntax-top.png)、[类图](r3-markdown-mermaid-class.png) |
| R3-MD08–MD09 | 勾选只改写 1 行（剪贴板前后逐行对比）；点击段落进入该块源文本、输入后行数不变 | — |
| R3-MD10 | 文件内查找“嵌套”命中 2 处 | [查找](r3-markdown-find.png) |
| R3-MD11 | 相对链接切到已有标签；外部链接只提示 | — |
| R3-MD15–MD18 | 图片画廊开关、右键菜单顺序、编辑自动保存后刷新仍在、快速切文件 5 轮无错误无残留 | — |
| R3-MD12–MD14 | 异常样例：无效 YAML、无效 Mermaid、无效公式、未闭合围栏；无残留节点；全程无页面错误 | [异常样例](r3-markdown-abnormal.png) |

发现并修复的缺陷（类图文字空白）只保留修复后的类图截图；修复前的现象来自调试时的临时截图，**未归档**，不补造历史证据。未验证：深色主题下的 Mermaid、触屏、跨块选区、公式内选区。运行方式：`NODE_PATH=<含 playwright-core 的 node_modules> node r3-markdown-check.mjs <输出目录>`，需先启动原型服务并保持 `4176`。

## R3 PDF / Notebook 取证

日期：2026-10-17。M9-GAP-05。脚本 [r3-pdf-notebook-check.mjs](r3-pdf-notebook-check.mjs)，本机 Chrome、独立上下文、1512×949、**DPR2**，只访问本地原型的合成 PDF 与 Notebook；结果 [r3-pdf-notebook-check.json](r3-pdf-notebook-check.json)。**23/23 通过**，没有 pageerror/console error。不是 REA 取证，不是 Codex 参考运行。截图：[r3-pdf-normal.png](r3-pdf-normal.png), [r3-pdf-encrypted-opened.png](r3-pdf-encrypted-opened.png), [r3-pdf-invalid.png](r3-pdf-invalid.png), [r3-notebook-light.png](r3-notebook-light.png), [r3-notebook-dark.png](r3-notebook-dark.png)。

| 检查 | 内容 |
| --- | --- |
| R3-PN01–06 | 3 页真实画布且非空白；中文/英文文本层；外部与内部链接；点击内部链接滚动到第 3 页；外部链接只提示；缩略图真实小图与悬停大纲标题 |
| R3-PN07 | 缩放到 150% 页面变宽并重新渲染 |
| R3-PN08–10 | 真实文本层选字出现评论编辑器；空白处拖出区域评论（坐标按真实页面尺寸）；批处理模式下评论标记 |
| R3-PN11–14 | 加密 PDF：弹出密码框且无文本层；错误密码提示重试；正确密码渲染 3 页；取消后显示“需要密码”且无残留对话框 |
| R3-PN15–16 | 截断与随机字节：不是有效 PDF 的可读错误与重试 |
| R3-PN17 | 14400×14400pt 页：画布 4096×4096（约 1677 万像素）并提示降采样 |
| R3-PN18 | 6 次快速切换来源：无页面错误，最终正常 |
| R3-NB01–04 | Notebook 通用 Markdown、代码与 JSON 高亮、无 script 且 HTML 仍在 `sandbox=""`、深色主题可切换并截图 |

**检查脚本自身的问题**（不是应用缺陷）：第一轮 5 项失败里，3 项是我的前置条件错误（PN10 评论标记要先开批处理；NB02/NB03 要先切到“所有 cell / MIME 分支”场景），2 项是真缺陷（PN14 取消密码后被覆盖、PN06 缩略图标题被 CSS 隐藏）并已修复。选择器过宽、折叠面板被重复点击也造成过超时，已改。

**未验证**：Safari/Firefox、真实 Worker 终止与崩溃、非嵌入 CJK 字体、成千上万页、review（canvas）路线的真实渲染、屏幕阅读器、深色主题 PDF 截图（只截了 Notebook 深色）、真实触屏。

## R3 搜索与微交互矩阵

日期：2026-10-17。M9-GAP-06。脚本 [r3-interaction-matrix.mjs](r3-interaction-matrix.mjs)，结果 [r3-interaction-matrix.json](r3-interaction-matrix.json)。**37 行：30 通过、7 未验证、0 失败**；T01–T18 逐项状态见[搜索补齐 §7](../../原型/搜索补齐说明.md#7-r3-复验t01t18-在当前原型上的实际状态)。每项开始前清本地存储，避免上一项状态污染。

- 通过的 30 行覆盖：树键盘（K01–K12）、文件名筛选（S01–S05）、右键菜单（M01–M04）、面包屑（B01–B02）、分隔条（D01–D02）、全文搜索对话框（F01–F03）、目录场景（X02）、无页面错误（E01）。
- 7 个未验证项（X01、X03–X08）都写明原因：无大目录 fixture、无打开方式加载状态、tooltip 无独立实现、无长树、无 generated 开关入口、无法驱动真实输入法、无真实触屏设备。**不以“没测所以通过”处理。**
- 历史：同一脚本第一次运行 17 项失败，原因是各项之间共享本地存储（上一项折叠了 `docs`），不是应用问题；隔离后降为 7 项，其中 5 项是真缺陷（K07 Shift 锚点、K11 ARIA、S02 输入法、D01 取整、F01 焦点）并已修复，2 项是我的预期写错（K08 空选择会回落到当前打开文件、X02 选择器）。修复 IME 时还引入过一次变量遮蔽回归（`composing2 is not a function`），被同一矩阵的 E01 抓到并修正。

## R3 业务接入闭环

日期：2026-10-17。M9-GAP-07。脚本 [r3-business-loop-check.mjs](r3-business-loop-check.mjs)，结果 [r3-business-loop-check.json](r3-business-loop-check.json)。**24/24 通过**（托盘 R3-BL01–BL14、选区修改请求 R3-ED01–ED10）。截图（SHA-256 记录在 JSON）：[tray-stopped](r3-business-tray-stopped.png)（任务未运行，插入禁用并说明）、[after-enter](r3-business-after-enter.png)（演示终端收到引用，用户 Enter 之后）、[review](r3-business-review.png)（CLI 修改后的审阅条）。

- 验证的是**原型的演示终端**：引用被放入输入行、不回车、用户 Enter 才“提交”；文本清理、括号/非括号两种模式、大小上限、归属校验由同一份模型实现，另在真实 PTY 下由[实验 TI01–TI08](../../技研/实验/terminal-injection-result-20261017.json)验证。
- **没有**验证：Claude Code / Codex 的真实 TUI、CLI 忙碌时的行为、真实输入法。
- 脚本自身问题（不是应用缺陷）见[执行记录 §10](../执行与缺陷记录.md)。

## R3.2 D01 更新

用户确认终端操作与文件视图独立，旧 R3-ED01–ED10 的 pending/review/keep/revert 流程已被取消，旧脚本/JSON/截图完整保留作历史，不作为当前预期。R3.2 新复验见[执行记录§12](../执行与缺陷记录.md#12-r32-d01-终端与文件视图独立)。普通 dirty 外改冲突仍保留，不能把它误删成所有外改都覆盖本地未保存编辑。

R3.2 focused复验：[24项报告](r32-independent-file-report.json)、[脚本](r32-independent-file-check.mjs)，24/24通过；[交接](r32-terminal-handoff.png)、[普通冲突](r32-manual-conflict.png)、[完整路径拖入](r32-file-path-drop.png)三张截图哈希匹配。独立headless浏览器、合成数据；新增拖路径包括图片，只插文本不附加文件。真实语音、CLI及正式425条App用例未执行，详细边界见执行记录§12。

## R3.3 D07 本机范围

用户已确认只做本机文件区，远程模拟从当前原型撤除；远程历史截图/实验不再作为本期目标。实际变更与验证见[执行记录§13](../执行与缺陷记录.md#13-r33-d07-确认仅本机文件区)。正式用例按本期/后续分列，全部未执行。

本轮[5项受影响界面报告](r33-local-scope-report.json)、[检查脚本](r33-local-scope-check.mjs)与[本机文件区截图](r33-local-file-workspace.png)：5/5通过，原型构建通过，1张截图哈希匹配。只验证远程演示移除及本机入口回归，未重跑旧155项模型/24项浏览器全套检查；本期419条正式App用例均未执行，6条纯后续另列。

## R3.4 九项专项修复

[本轮总账](../../九项问题处理结果_R3.4.md)、[Markdown](r34-markdown-实施与验证.md)、[搜索交互](../../原型/r34-interaction-补齐与验证.md)、[PDF/Notebook](../../技研/实验/r34-pdf-notebook-runtime.md)、[Office/PTY/保存](../../技研/实验/r34-office-pty-save.md)。合并模型最终192项见[r34-final-prototype-tests.tap](r34-final-prototype-tests.tap)，首轮183项见[r34-all-prototype-tests.tap](r34-all-prototype-tests.tap)，最终构建见[日志](r34-final-prototype-build.log)，App受阻loopback回归复跑见[日志](r34-app-loopback-tests.log)。这些均按各报告证据层级记录，不改正式425条用例状态，不覆盖旧截图/失败结果。

补充专项：[Office完整动作矩阵与引擎失败](../../技研/实验/r34-office-actions-矩阵与验证.md)、[Markdown真实Worker](../../技研/实验/r34-markdown-worker-report.md)、[原生watch](../../技研/实验/r34-watch-原生加载与生命周期验证.md)、[LibreOffice生命周期](../../技研/实验/r34-office-runtime-report.md)、[TeX隔离](r34-tex-选型与真实隔离验证.md)、[真实第三方viewer](r34-provider-capability.md)。失败、负对照、最小包与生产未验边界分别保留，不能汇总成全部格式已通过。

Office评论原型新增：[修复与13项浏览器报告](../../原型/r34-office-context-投递修复与验证.md)、[实际M9页终端截图](r34-office-context-workspace-terminal.png)。FileWorkspace后续只补两处path透传，原30项交互运行源码另存[r34-history](r34-history/source-snapshot-index.json)，旧哈希/结果不改。

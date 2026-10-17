# PDF 与 Notebook 原型补齐说明

状态：R2，2026-10-17。仅为 M9 合成数据原型与迁移依据，不是正式 App 实现，也不是 Codex 运行界面对比验收。

## 1. 交付及调用接口

`prototypes/m6-codex/src/FileArtifactPreview.jsx` 现在只负责路由：`pdf` / `pdf-review` / `tex` → `FilePdfPreview`，`ipynb` → `FileNotebookPreview`，其余 Office 类型 → `FileOfficePreview`。旧 `OfficeFixture` 已删除，Office 接口保持兼容；详见 [Office 补齐说明](Office补齐说明.md)。

本轮独立新增 `FilePdfPreview.jsx`、`FileNotebookPreview.jsx`、`file-artifact-model.mjs`、`file-artifact.css`、`tests/file-artifact-model.test.mjs`。没有改生产代码或现有终端。

| 组件 | 支持的输入及回调 | 边界 |
| --- | --- | --- |
| FilePdfPreview | `kind`、`path`（默认 synthetic.pdf）、`initialPage`、`onPageChange(number)`、`onDownload()`、`hostOptions`、`onStateChange(state)` | 页面只为 600×780 合成内容；不解析 PDF、不写 PDF、不发送模型任务 |
| PDF hostOptions | `pageCount:1` 生成单页，否则三页；`annotationsEnabled` 默认 true；`annotationBatchingEnabled` 默认 false；`pdfStatus` 为 ready/loading/error | 显式模拟宿主与 feature gate，不代表目标安装版用户实际开关 |
| PDF state | route/page/zoom/annotation/batching/loadState/comments/draftActive | comments 含 scope、requests、delivered、phase、operation；仅内存数据 |
| FileNotebookPreview | `initialValue`（JSON 文本或对象）、`title`、`onDownload()`、`hostOptions.notebookScenario` | 不使用内核；不修改 Notebook；不执行 Vega 或代码 |
| Notebook 场景 | current/all/empty/invalid-json/invalid-schema | UI 的“场景（模拟）”属于验收入口，不是复刻出的正式控件 |

父组件必须按会话／文件身份挂载不同 key，避免跨文件复用评论草稿。现有文件入口按 scope+identity+reload 挂载，格式演示入口按 kind+active 挂载。PDF 原型不调用 `onDraft`；评论与文件编辑分离。下载仍由父组件生成 `.preview.txt`，不伪装成真实二进制文件。

## 2. 静态证实的依据与边界

安装包身份仍为 Codex 26.1007.30912 build 20156，ASAR SHA-256 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。原始文件、字节范围、SHA 和此前 V9/V18/V19 锚点见 [查看器源码索引](../调研/证据/m9-viewers-source.json) 与 [文件类型与编辑状态全集](../调研/M9_文件类型与编辑状态全集.md)。

| 模块 | 原始身份 | 本次定位 |
| --- | --- | --- |
| notebook-preview-panel-f6b78a668e49.js | 21391 bytes，ASAR offset 346469943；SHA `a2a5095cd62dad520fa4bf5bb5b8dfde3d5b75aee8b63e9b08f30cd6bfc9a6d2` | 格式化 `release/m9-research/viewers/formatted/` 同名文件；解析 14–118；源码与折叠 `Ee` 200–241；输出 `ke/q/J` 244–318 |
| pdf-preview-panel-d46b52f0eb1a.js | 51926 bytes，ASAR offset 384110941；SHA `1532d5f6037ad4d7a869021279cf90fe04d220b28a430cd02f39a4299de338a7` | 格式化 `release/f22-research/file-route-formatted/` 同名文件；评论 `Et` 141–212，anchor 转换 `kt` 221，页面截图 `Mt` 233；主渲染 feature gate 与批处理约 900 行 |
| pdf-preview-diff-4d75113febe2.js | 32112 bytes，ASAR offset 384077177；SHA `db84a8bcf898ea471fcc389de64b5ba00a5ba6ec4785db0cd5954535eb5b986f` | Review PDF 单页 canvas 路线，与 artifact PDF 分开 |

REA notebook 聚焦 module trace：`ev_9033352da154b260af1ab4052df7cb8d40f08a19c7fc8e075e5f8f267857fb7f`，输入 E-V3 `ev_2d9f996b258b85025bb1ca9f545716b4879c9f3d3a5fd9ab63d97053004f3da6`。结果为 2 个 seed、16 个节点、51 条边、4 项 observed/100 项 inferred，范围是 complete-within-source，不是动态执行。较早字符串 seed 的 no-match `ev_62c743dcb5725acbfd0f339def19bbedcb1b196e41aeed7c522dc3999433c89b` 仍保留，不能把该次结果解释为功能不存在。

本轮实现是独立行为模型，没有复制未知许可的 Codex 私有组件或图标 path。以下“静态证实”均指选定安装包代码；“原型实测”仅指合成原型。

## 3. Notebook 行为全集与本轮勘误

### 3.1 输入、metadata、cell

- 顶层必须是含 cells 数组的对象。cell_type 必须是字符串；source 允许字符串／全字符串数组；id、metadata、execution_count、outputs 按源码所声明的可选形状校验。JSON 无法解析和 schema 不合法都进入错误态，合法空数组进入无单元态。
- cell 为 Markdown、Code、Raw；未知 cell_type 归为 Raw。三个类别均有空内容状态。仅 Code cell 消费 outputs。
- metadata 查找顺序为 codex、codexNotebook、codex_notebook、codex-app、根 metadata；title/cellTitle/cell_title，以及五个 description 字段别名均处理。outputSummaries 必须是数组且对应项为 record，空白 summary 跳过。
- 外层 cell details 初始展开。**代码折叠由非空 descriptionMarkdown 决定，与是否有 outputs 无关**。有描述、有代码时，描述在上，Code disclosure 初始收起；无描述则直接显示源码；无源码显示 Empty code cell。这修正旧 D18 的“有输出即折叠”表述。
- 代码和 Raw 源码可复制；Run 是只读占位图形，没有执行 handler；execution_count 仅为已有执行次数标签。原型没有新增运行、编辑、搜索或缩放 Notebook 的控件。

### 3.2 输出分支与优先级

| 输入 | 输出行为 | 说明 |
| --- | --- | --- |
| stream | 原文，或 summary + Raw output disclosure | name 被解析但实际渲染器未展示单独 stdout/stderr 标签 |
| error | ename/evalue；可用 summary 替代标题；原始错误与 traceback 可展开 | 默认 Error，原始文本不执行 |
| display_data / execute_result | 按下列 MIME 顺序选择一项 | 不会把一个 bundle 的所有 MIME 同时展示 |
| 其他 output_type／不支持 MIME | 跳过该输出 | 不虚构执行结果 |

MIME 优先级：PNG → JPEG → SVG → 非空 HTML → 非空 Markdown → text/plain（空字符串也算有效输出）→ application/json，否则 application/vnd.vega.v5+json。JSON/Vega 均为格式化文本，Vega 不被当作图表运行。HTML 和 Markdown 不应用 output summary；stream、text、JSON、error 应用。无 summary 的 JSON 不显示代码 action bar；HTML 与 error 支持 Raw output；所有 Raw output 初始收起。

合成 fixture 覆盖 Markdown/Code/Raw/未知类型、三个 cell 空态、7 种输出类别及 PNG/JPEG/SVG、JSON/Vega 两个 JSON 分支。JPEG 为本地生成的单色 48×24 图片；三种图像均已在 Chromium 验证 naturalWidth > 0。

### 3.3 HTML 隔离及尚未对齐部分

源码 HTML frame 使用空 sandbox 与严格 CSP；原型保留这两层，并增加更严格的惰性 template 清洗：去掉 script、嵌套 frame、form、object、事件属性及导航地址，不允许外部资源地址成为活动节点。CSP 禁脚本、connect、frame、form、object、base；图片/媒体限 data/blob，字体 data，样式 inline。iframe 高 288px，图像最大高 640px。

原型额外的清洗策略是安全设计选择，**不能声称与目标 HTML 支持集合完全一致**。Markdown 采用原生 React 输出的安全静态子集（标题、段落、粗体、斜体、行内代码），没有完整 CommonMark、目标 basic HTML 或代码高亮器。描述作为 cell 标题时的富文本去标记／截断也没有达到目标解析器等价性；这是明确差异。

## 4. PDF 路线、选择及评论状态

### 4.1 两种路线保持独立

Artifact PDF 保留 zoom menu（25/50/100/150/200/Fit）、下载、条件评论按钮、连续页面、可选文字、内部链接、缩略图及停靠。zoom 的 clamp 为 30–800，故点 25% 实际得到 30%，不会产生“25% 已选”状态；Fit 上限 100%。Ctrl+wheel 按限定 delta 和指数增量调整并对常用倍率吸附。

Review PDF 不显示 artifact toolbar、文本层、内部链接或评论；只在多页时显示上一页/下一页，并按 hover/focus 显示 pager。原型依此分别呈现，Review 页面仍是合成 DOM，不是真正 canvas 或 PDF.js。

没有新增目标普通 PDF 宿主未启用的打印、旋转、查找、页码输入框、加减缩放、Request edits 菜单。TeX 入口沿用 PDF 路线演示，**没有 TeX 编译器**。

### 4.2 可实际操作的选择与状态

- 点击留白创建 point；拖留白创建 region，反向拖动与页边界归一化；选择同页文字产生带 selectedText/selectionRects/selectionKind=text 的 region。坐标基于页面尺寸，缩放时锚点同步。
- 浮层按点／区域右上角锚定；滚动/缩放/窗口尺寸改变时重新定位；评论非空才可保存；可编辑、删除、按队列前后导航。
- 未保存文字不会被新的选择或 Escape 静默覆盖。空草稿 Escape 关闭草稿；无草稿再次 Escape 退出评论模式。
- batching=false 的提交直接进入模拟发送；batching=true 的提交先排队。working 锁住队列编辑，停止取消本次 operation；失败保留队列以重试；成功才清空当前队列。operation/scope guard 防止过期完成回调消费当前评论。
- 批处理控件仅在 ready、annotations_enabled、annotation_batching_enabled 条件满足时显示；加载／渲染错误不显示该栏。载入中、失败、重试通过模拟场景入口可达。

目标源码中的真实数据包括 conversationId、threadId、originatingTurn、localPdfContext/localPdfCommentMetadata 和可选裁剪截图。`submitMode=direct` 且未开启 requestEdits/batching 时走 `pdf-direct-comment`；否则排队，direct+batching 会触发批发送。原型不模拟这些私有宿主 API 的成功，也没有截图上传或 CLI 桥接。将评论引用送入 SmartDD 终端的业务设计仍须后续评审。

### 4.3 剩余差异

- 原型缺真实 PDF 解析、字体/图片、表单关闭规则的引擎验收、超大文件性能、错误类型细分、真实 annotation/link layer、真实裁剪截图及完整 selection floating pill。
- 区域与点的 3 个页面单位阈值、模拟发送 650ms 是原型选择；不宣称为目标阈值或延迟。Ctrl+wheel 的目标 120/200ms 时序与所有触控路径尚未逐项重现。
- 源码批处理中 latest changes／requestEdits 关联任务状态尚未完整模拟；本轮覆盖 queue/working/stop/failure/retry/success，不能据此将整个 PDF 业务标为完成。
- feature gate 的安装版实时取值未知；截图只证实人为选择的原型场景。私有图标、真实字体渲染及完整浅深色像素差异仍待合法资源与可用参考补齐。

## 5. 实测证据

环境：受控临时 Chrome/Chromium 155.0.8059.80，1512×949，DPR 1，service workers allow，本地 `http://127.0.0.1:4176/?preview=m9`，无真实文件／凭据。REA 每个 action deadline 5000ms，末尾等待 150ms，所有下列正式场景步骤 completed，无 page-error 或 error console。交互只发生在本地原型，不是 Codex。

| 场景 | Evidence ID | 截图 / 精简步骤记录 |
| --- | --- | --- |
| 同页文字选择生成 region 草稿 | `ev_ddba1fbd9ef284534105f8adb89a35e9aee70a449719d4b44552190b8a271e18` | [PNG](../验收/证据/r2-artifact-pdf-text-region.png) / [JSON](../验收/证据/r2-artifact-pdf-text-region.json) |
| 两条评论发送失败保留 | `ev_9a04e605ff8830951016925ac37a2ea62453a2063586f47f7af0c216910e0315` | [PNG](../验收/证据/r2-artifact-pdf-batch-failed.png) / [JSON](../验收/证据/r2-artifact-pdf-batch-failed.json) |
| 失败后重试成功清空队列 | `ev_127928c9ee9249b1d99980f045784e5734b80ca53e64080c8f54f3e849881bf9` | [PNG](../验收/证据/r2-artifact-pdf-batch-retried.png) / [JSON](../验收/证据/r2-artifact-pdf-batch-retried.json) |
| 25→30 clamp、错误重试、关闭 annotations | `ev_8dee3ec14c61babe07460152d6e3582248bba4716107ce2a46f921edc3341f20` | [PNG](../验收/证据/r2-artifact-pdf-gates-zoom.png) / [JSON](../验收/证据/r2-artifact-pdf-gates-zoom.json) |
| Review 前后翻页、深色与禁用 artifact 控件 | `ev_90a7384250b3dbe06ef5bb5b65a9572003f7d222b7f457b6a26f4f78e7ac5cc2` | [PNG](../验收/证据/r2-artifact-pdf-review-dark.png) / [JSON](../验收/证据/r2-artifact-pdf-review-dark.json) |
| Notebook description 初始收起→Code/Raw output 展开 | `ev_2cf35d9407bfd8f0c18eca1a20bd5eeae264b648ebda3529610b4a42375c018c` | [PNG](../验收/证据/r2-artifact-notebook-description.png) / [JSON](../验收/证据/r2-artifact-notebook-description.json) |
| 全部 MIME、无描述直接源码、错误 traceback | `ev_7b69b12141abf0635afd2448ce84719dddc09777d93e89d34a54b6beb08a05f9` | [PNG](../验收/证据/r2-artifact-notebook-mime.png) / [JSON](../验收/证据/r2-artifact-notebook-mime.json) |
| 无单元／非法 JSON／非法 schema 场景切换 | `ev_f8e368be41a3d0186b574a1feebafa1558b30b88dcb64ff1553aaaba38e93423` | [PNG](../验收/证据/r2-artifact-notebook-errors.png) / [JSON](../验收/证据/r2-artifact-notebook-errors.json) |

REA 工具当前 action schema 不含 pointer drag 或 evaluate，因此矩形拖拽及 DOM/iframe 精确断言另用已安装 Playwright 1.58.2 在同一原型补证，没有修改 REA、注入目标应用或绕过 Codex UI 禁止。脚本在 ignored `release/m9-research/artifact/probe-artifact-r2.mjs`；[结果](../验收/证据/r2-artifact-supplemental.json) 为 passed：

- [矩形区域草稿](../验收/证据/r2-artifact-pdf-rectangle.png)：真实 mouse down/move/up，编辑器显示“所选区域”，有归一化 overlay。
- [提交后停止](../验收/证据/r2-artifact-pdf-stopped.png)：停止后等待 800ms，仍有 1 条评论，没有被迟到完成回调清空。
- [HTML frame 与图像](../验收/证据/r2-artifact-notebook-html.png)：空 sandbox、no-referrer，活动 srcdoc 中无 script/外链；脚本标记未设置；3 张图像均解码成功；HTML 表格可见；网络记录无外部请求，pageErrors 为空。此结论只覆盖合成样例，不能代替完整攻击面审计。

部分较早截图含父级旧“AGENTS.md”演示标题及文本编辑工具栏；父级已在本轮修正，较晚 PDF gate / review / Notebook errors 截图显示“格式演示”及对应控件。这些较早截图用于证明当时的组件交互，不是最终整页外观证明。

完整 REA ledger：ignored `release/m9-research/artifact/rea-artifact-r2-bundle.json`，40 records，485004306 bytes，SHA-256 `bb78a4e168123d50994c17a5eaac7b40c5c3f6f8110dec887772ab7acb063421`。其中保留前期 selector 超时及 no-match，不能把全部 40 条都算作通过的 UI 场景。早期无效 JPEG 已换成本地产生的合法 fixture，正式 Notebook description/MIME 与补充断言使用修正后的数据。

## 6. 验证结论

`node --test prototypes/m6-codex/tests/file-artifact-model.test.mjs`：16/16 通过。涵盖 schema/metadata/MIME、描述折叠、CSP 输出、坐标边界、反向矩形、评论编辑删除、失败重试、停止／跨 scope／过期 operation 与重复提交锁。`npm run build`（原型目录）通过；仅有现有大 chunk 提醒。

本轮达到“静态规则可追溯、主要分支可操作、选定交互已实测”的原型交付。真实 PDF/Office 编解码、Notebook 完整 Markdown renderer、Codex 运行态、全部 feature gate 与完整视觉一致性继续列为未完成，不以本次验证覆盖。

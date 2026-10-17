# Office 原型补齐说明

更新：2026-10-17。范围：M9 设计阶段的合成 Office 交互原型。没有修改正式 App、连接真实文件、执行宏或调用模型；下载继续由文件工作区生成 `.preview.txt`。本轮补齐 XLSX/PPTX/DOCX 的可操作模型与条件控件，不将原型称为真实 Office 引擎或已完成精确复刻。

## 1. 文件与接入契约

| 文件 | 作用 |
| --- | --- |
| [FileOfficePreview.jsx](../../../../prototypes/m6-codex/src/FileOfficePreview.jsx) | 共享原型中的 Office 组件，提供工作簿、演示稿与两种文档路线；由 `FileArtifactPreview` 接入 |
| [file-office-model.mjs](../../../../prototypes/m6-codex/src/file-office-model.mjs) | 原创 JSON 合成模型、能力条件、选区、有限公式计算、编辑历史与快捷键判定 |
| [file-office.css](../../../../prototypes/m6-codex/src/file-office.css) | `fo-` 命名空间样式，沿用已有主题变量与公开 Lucide 图标 |
| [file-office-model.test.mjs](../../../../prototypes/m6-codex/tests/file-office-model.test.mjs) | 22 项模型行为检查，不能替代正式产品或像素验收 |

组件导出 `FileOfficePreview({ kind, readOnly, initialValue, onDraft, onDownload, hostOptions, onStateChange })`。`initialValue` 仅用于本次挂载初始化；外部重载应通过组件 key 开新实例，避免父层 draft echo 重置编辑会话。模型使用 `schema: m9-office-v2`，兼容旧原型的 `slides[].title`、`sheets[].cells`、`cells` 与 `comments`。

`onDraft(serializedJson)` 交给父工作区统一处理保存、冲突、关闭与持久化，不输出 OOXML。单元格和幻灯片文本输入在 `onChange` 先发候选快照，Enter/失焦提交到本地历史，Escape 发回提交前快照；未失焦的 Meta+S 因而能取得最近输入。注释请求只留在本次组件内，不发送给任何人。`onStateChange` 的 `dirty/version/canEdit/sourceState/error` 描述组件编辑历史，不代表磁盘保存成功；父层保存状态仍是用户可见保存结果的依据。

原型冲突注入应 `createOfficeDocument(kind, value)` 后仅修改目标字段，再 `serializeOffice(doc)`，保留已有格式、合并、对象、备注与标识；不可用旧简化模型重建整个文档。`markOfficeSaved` 的旧版本回执不能清除新版本 dirty，已有模型测试。

## 2. 证据与来源

控件依据为[类型与编辑状态全集 §10](../调研/M9_文件类型与编辑状态全集.md)及[定位 JSON](../调研/证据/m9-viewers-source.json)；以下 V/O 编号沿用该研究。安装版仍为 Codex `26.1007.30912 / 20156`，ASAR SHA-256 `75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。本轮没有复制专有实现入原型或跟踪文档。

静态依据使用已有 REA Evidence：`ev_fdcba5064bef76928a9dadc5474f2f7fa644c54267b14e9197f911300dddf4da`（Office 模块图）、`ev_d4b486133e7d83a8815eaf57763287e1d75927ead8e517e515fd394015baa828`（presentation 路径 trace）。已经存在的源码锚点足够支撑本次交互设计，不重复全量解析或导出 675 MB 证据包。

### 2.1 工作簿

| 控件／行为 | 源码锚点与静态条件 | 本轮可操作行为 |
| --- | --- | --- |
| live/starting/refreshing/fallback/blocked | O31；V8 `lo/uo` L1248–1328，只有 live controller 进入编辑 | 场景下拉逐种切换；非 live 保留只读格子、来源提示及恢复按钮；`readOnly` 始终优先 |
| 手动格式开关 | O32；V35 `Nv` L6328、`sv` L6129–6218、`cx` L7798–7815 | `manualEditUiEnabled` 与内容可编辑分开；关掉格式能力后仍可在合格 live 来源编辑值 |
| 地址与公式栏 | O33；V35 `E_` L5922–5948、`w_` L5912–5920 | 地址为标签，显示当前格/范围；formula 是 textarea；只读时禁用 fx、textarea 只读 |
| fx 实际动作校正 | V35 L5926–5928 的 `onClick → inputRef.current.focus()` | 按钮仅聚焦公式输入，不插入 SUM、不伪造公式选择器 |
| 单元格选区／输入 | O37；V35 controller L1132–1144、cell editor L5035–5055 | 点击、拖动、Shift 扩选、F2/字符编辑、Enter/Tab/方向提交与 Escape 取消；公式栏与格子编辑不抢焦点 |
| 文字与数值格式 | O35；V35 L6458–7796 | 范围加粗/斜体/下划线/删除线、字体/字号、文字/填充颜色、对齐/换行/边框、数值/货币/百分比与小数位 |
| 范围操作与右键 | O35；V35 L1970–2050 | 合并/取消合并、适应列宽/行高、向下/右填充、清内容/格式/全部；合并重叠报错且不改数据 |
| 条件工具 | O35；V35 custom inspector | 复选框、数字验证、阈值条件填充、图表/图片/形状示例插入；复杂规则差异见 §4 |
| sheet 导航 | O34；V35 `M_/N_/z_` L5962–6064 | 只读可切表；可编辑时新增、双击重命名、拖动重排；右键查看/重命名/删除；最后一表不许删 |
| sheet 名称 | 重命名本地模型验证；不冒充已证 Codex 的全部校验文案 | 空名称、超过 31 字符、非法字符与大小写重复被拒绝；取消保持原名；弹层为 modal dialog |
| 撤销与草稿 | 已证 controller 支持 history；实际快捷键枚举不等于绑定，见 O36 | 值、格式、sheet 和对象动作进入最多 50 步合成历史；支持按钮与原型 Meta/Ctrl+Z，分叉清 redo |
| 公式计算 | 真正 worker 未还原，见 U11 | 有限算术、引用及 SUM/AVERAGE/MIN/MAX/COUNT；循环、越界、除零、未支持函数显式错误；不使用 eval |

### 2.2 演示稿

| 控件／行为 | 源码锚点与静态条件 | 本轮可操作行为 |
| --- | --- | --- |
| 编辑条件 | O21；V8 L1966、L2029–2045 | 须手动编辑、源数据可读可写、非 library；只读优先。切到 library 后撤销/格式/插入消失，编辑按钮禁用 |
| 缩略图／grid | O22；V32 `lm` L3916–4111；header L1009–1024 | 对象缩略图、收起/展开、网格、切页、双击返回单页；没有擅自加入 header 页码输入 |
| 缩放与键盘 | O23/O24；V32 `ip` L2497–2509、`Yn2` L4051–4074；V36 L17–37 | 缩放菜单、Fit；Shift+1、单主修饰+0、主修饰 +/-、主修饰+Alt+1；排除输入、IME、repeat 和 Ctrl/Meta 同按 |
| 新增与插入 | O25；V32 L4075–4111、L5586–6600 | 新增页、文本/图片/图表/表格/形状；全部用本地合成对象，没有图片生成 provider |
| 对象选择与编辑 | O25/O27；V32 stage L3424–3535 | 选择、拖动位置、属性修改、双击文字编辑；拖动取消恢复原位；文本 onChange 发草稿 |
| 文字／段落 | O25 format 配置 | 字体/字号/加粗/斜体/下划线/删除线、对齐、项目符号/编号；合成模型以整对象为粒度 |
| 形状与样式 | O25 format 配置 | 11 种形状、填充/颜色/透明度、边框线型/阴影、位置/尺寸/旋转，属性即时改变画布 |
| 图表 | O25 format 配置 | bar/line/pie/area/scatter/histogram/waterfall/funnel/treemap 的合成绘制、数据输入、图例/坐标/网格；不是完整图表排版引擎 |
| 图片／表格 | O25 format 配置 | 图片替换为合成图样；表格单元格编辑、首行/列样式、箭头/Tab/Enter 聚焦；更完整表格选区仍见 §4 |
| 右键与层级 | O26；V32 `D_/k_` L5568–5583 | 页复制/隐藏/显示/删除（最后页保护）；元素置顶/上移/下移/置底；加速键文本不当作已实现全局绑定 |
| notes | O22；V32 L953–985 | 编辑模式或有非空内容时显示；非编辑为只读；修改进入历史与草稿 |
| 条件评论 | O21，commentThreads/feature 且排除 template | 场景启用后写请求草稿/本次请求列表；不改原文、不发出消息 |

### 2.3 DOCX 两条路线

| 控件／行为 | 源码锚点与静态条件 | 本轮可操作行为 |
| --- | --- | --- |
| 两路分发 | O11；V8 `ct2` L1418、L1706–1772、L2021–2027 | 场景显式切 Popcorn 或旧 docx-preview；不会把某一分支默认解释为安装版当前实际 flag |
| Popcorn 宿主 | O14；V31 `nm` L5137–5160；V8 L2024–2027 | 合成多页只读、可选择文字、缩放/Fit；不显示编辑/查找/注释/header 页码/旧分页栏 |
| 旧分页栏 | O12；V30 `en` L195–345；V20 | 三页示例、hover/focus 展开、停靠/取消、点击滚至页；不是页码输入框 |
| 修订视图 | O13；V30 L196、L223–224、L307–335、L646 | 条件开关与 hasRedlines；显示/隐藏插入删除；有未完成评论时阻止切换，不实现接受/拒绝修订写回 |
| Request edits | O12/O13 共用 header | 条件评论输入、本次请求列表、草稿保护；不宣称真实锚点、线程持久化或消息发送 |

## 3. 本轮验证与文件证据

运行环境：REA 新启动独立 headless Google Chrome，空浏览器存储，只访问 `http://127.0.0.1:4176/?preview=m9`；1512×949、deviceScaleFactor 1、zh-CN、浅色。没有连接用户原有浏览器，也没有控制真实 Codex。以下五组均保存逐步骤 accessibility、末帧 PNG 与事件摘要，均无 `page-error`；只说明列出的合成操作通过。

| 场景 | 实际步骤与可判定观察 | 证据 |
| --- | --- | --- |
| XLSX 基本编辑 | 打开数据.xlsx → 格式/加粗 → 公式 `=SUM(2,3)` → 提交得到 5 → 新增 sheet → 撤销恢复两表；格式与草稿保留 | [JSON](../验收/证据/r2-office-xlsx.json)、[PNG](../验收/证据/r2-office-xlsx.png)；`ev_637eb48b33ab55bc78656ecea8fab185306e44b056a2095d28fd10856a4d74a2` |
| PPTX 编辑 | 开编辑 → 插入图表 → funnel/8,5,2 → 修改 notes → grid 切页 → 返回单页 → 新增页/撤销；可见合成图表与更新备注 | [JSON](../验收/证据/r2-office-pptx.json)、[PNG](../验收/证据/r2-office-pptx.png)；`ev_8308390ddc59c331a1df7a3c28fb4be944f817f8134a278f58f0240207448e5f` |
| DOCX 双路线 | 初始 Popcorn 无分页栏/修订 → legacy 出现相应控件 → 隐藏修订 → 点击第 2 页 → 开评论/填写 → 再切修订被草稿保护阻止 | [JSON](../验收/证据/r2-office-docx.json)、[PNG](../验收/证据/r2-office-docx.png)；`ev_7b176d799d5266034ef7d8ac06903d489dd15264a9770f51a1ef73bba96eddf0` |
| XLSX 键盘/右键/只读 | textarea 未失焦 Meta+S 后保存标记消失、内容保留 → Enter → 右键重命名 → blocked；fx/新增sheet禁用，格式与撤销隐藏 | [JSON](../验收/证据/r2-office-gates.json)、[PNG](../验收/证据/r2-office-gates.png)；`ev_de8b3fcedd066edf8bf325ac240e2e2f16134d4a286bfde0bb4b98444c513565` |
| PPTX 键盘/能力 | 插入 star、设置位置 → Shift+1 变 88% → Meta+Alt+1 开/关 grid → library 开；编辑按钮禁用、插入/格式退出，已有内容不丢 | [JSON](../验收/证据/r2-office-pptx-gates.json)、[PNG](../验收/证据/r2-office-pptx-gates.png)；`ev_588d6f1c0c5ad417ef402e981f95671c0256dfb2fd47d16975db6968d6cb9a6b` |

XLSX 键盘场景也暴露父工作区的重复 dirty：未失焦 Meta+S 保存后，Enter 发出同内容快照仍被标为新草稿。已将确定步骤与结果交父任务处理；该证据保留原始现象，不以父层后续修复回写为历史通过。第一轮捕获还曾因代理写错 `B1` 的 aria-label 定位而主动终止，非应用异常，不计入以上五组；后续定位动作均设 5 秒上限。

`node --test prototypes/m6-codex/tests/file-office-model.test.mjs`：22/22 通过，覆盖只读与能力门控、旧模型兼容、序列化、范围裁剪、格式隔离、撤销/分叉、旧保存回执、sheet 名称/删除保护、合并冲突、填充/清理、验证/复选框、公式依赖与错误、数值展示、幻灯片/对象/notes/层级与快捷键 guard。日志保存在 ignored `release/m9-research/office-model-test-r2.txt`。

使用仓库 esbuild 对组件与实际 React/Lucide 依赖打包成功；未因此重复正式 App 的发版检查。本轮未执行深色、所有视口、所有输入法/快捷键、全部控件组合或真实 Office 文件验证；主生产测试用例继续“未执行”。

## 4. 明确保留的差异

| 差异 | 当前原型边界与后续任务 |
| --- | --- |
| 真实 Office 解析与写回 | 未引入 OOXML parser、Office worker/WASM、CRDT 或真实会话；没有原文件保存、宏执行、导出保真保证。研究 U11 指到 `runtime.worker-4664ab3e891e.js`、`controller-worker-270e891d4760.js`、`worker-98ad163d5f9e.js` 的交接，生产需独立选型与隔离 fixture 验证 |
| XLSX 大规模与复杂数据 | 最多 100 行/26 列/20 表，模型仅有限公式；不支持跨表/外部引用、日期系统、数组公式、完整数据验证/条件格式、冻结/过滤/排序/表对象、真实粘贴板、复杂图表绑定等；向下/右填充复制示例值，不等价 Excel 相对公式填充 |
| XLSX 插入对象 | 图表/图片/形状可插入及随历史恢复，但没有完整浮动对象选区、拖动/裁剪/锚定/绑定范围；插入功能是可操作示例，不应作为这些能力验收通过 |
| PPT 排版与对象 | 最多 40 页；文本按整对象样式，没有富文本 runs、组合、多选、智能对齐、真实拖拽缩放柄、动画、主题母版/字体回退或复杂图表布局；SVG 缩略图是对象摘要，未追求各形状/图表逐像素一致 |
| PPT 表格与快捷键 | 单格编辑、箭头/Tab/Enter 已做；原实现 Shift 多格选区、主修饰+A、表格级 Delete/Enter/F2 等状态未完整模拟。层级菜单加速键仅显示，不虚称已绑定。原型 Ctrl/Meta+Z 是明确的原型交互，不作为 Codex 全按键实测证据 |
| DOCX 内容与注释 | 页面为三页合成 HTML，未覆盖真实分节、页眉页脚、字段、复杂表格、图片浮动与字体。旧栏可用但缩略页不是引擎截图。修订切换不具原引擎滚动映射/精确选区清理；评论没有真实文本锚点、线程存储与导出 |
| 保存与错误 | 外层负责合成保存/冲突/关闭；Office 内部 dirty 仅为编辑历史。真实 revision、文件锁、写失败重试、二进制变更冲突与 crash recovery 待生产实现 |
| 视觉与运行时 | 已沿用当前主题与可合法图标，但尺寸、字体、图标、菜单位置、选区与深色未与真实 Codex 同状态逐项对照；参考程序实际 flags/provider 与 worker 能力仍未知，不宣称完整一致 |

这些差异留在 M9 全量范围，不能因本轮用合成模型而删除正式需求。后续开发需先完成真实引擎选型、输入/输出契约和有明确 expected 的二进制 fixture 验证，再将本原型操作迁移到正式组件。

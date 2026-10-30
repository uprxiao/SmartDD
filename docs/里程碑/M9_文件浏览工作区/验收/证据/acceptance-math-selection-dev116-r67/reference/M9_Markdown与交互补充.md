# M9 Markdown 与交互补充

修订：**R2-20261017**。本轮补齐 Markdown 编辑器真实接线、Notebook 条件校正，以及原型暴露的身份/恢复/保存边界。正式实现、安装端验收与真实 Codex 动态对照均未完成；本文件不把合成原型结果升级为参考程序事实。

## 1. 目标、证据与定位格式

沿用 Codex `26.1007.30912 / build 20156`，原 ASAR SHA-256：`75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。读取的是此前保留的发布包提取物，没有附加私有源码到本里程碑。

REA 本轮补查由根任务提供两条证据，并逐点核对以下原始输入：

- `analyze_javascript_application`：`ev_d01836bebe947d829209d5c9aa4da46330a29ce8138d739365bae6568f545ab4`。
- `trace_application_feature`：`ev_610834f933fd4da338c00cf1f503a68d871483d54e61a58632baa6d14ee8c663`。

已归档[机器证据元数据](证据/m9-markdown-source-r2.json)。分析完整结果超过MCP内联传输预算，已从retained evidence导出完整39条session包，hash见机器元数据；trace仅在三模块输入范围内完整，范围外import仍未解析。

输入元数据位于 ignored `release/m9-research/continuation/markdown-inputs.json`；三模块的分析副本在同目录 `markdown-input/`。下表哈希为原始 UTF-8 模块字节。`L` 是指定已有格式化文件中的行号；`byte` 是原始模块从 0 开始的 UTF-8 字节偏移，不能当 JS 字符索引。

| 代号 | 原始文件名 | bytes／SHA-256 | 本文定位载体 |
| --- | --- | --- | --- |
| M-EXT | `text-file-editor-extensions-631f19bf10c1.js` | 64075／`52f1dc3dbb78529aa7b04e00739ab03a342be4c49b1d1637700ed83c2d061150` | `release/f22-research/file-formatted/` 同名文件；格式化SHA `90a8f53420002f3510961b9dbd17a9794690d372615c5c6b8091d0dddb4462d7` |
| M-SEARCH | `text-file-editor-search-panel-770b9341188b.js` | 48325／`cf4903422d899d732e41cd49a49cdd5766a2498ec225ac8402b1d0460b8f829d` | `release/m9-research/continuation/markdown-input/` 原始模块，使用 byte offset |
| M-TAB | `text-file-editor-tab-content.electron-d591818a9d3b.js` | 56656／`87e137c2c66982e6942e3e65e158219852ec48fad31d9ab8999440ca7bdcb45a` | `release/f22-research/file-formatted/` 同名文件；格式化SHA `812f62b0a18d946d9847ebb5e7951c0da6d852f269991c2c6bf93fe3b3f438f4` |

原包未提供 source map，格式化行号仅是可重现定位，不冒充原 TypeScript 行号。REA 图中推断边不单独作为运行行为证据；以下“静态已证”来自实际函数、条件和参数。

## 2. Markdown 的真实编辑路径

| ID／状态 | 静态事实与边界 | 精确定位 | M9 迁移与验收含义 |
| --- | --- | --- | --- |
| M01 静态已证 | 富文档本身是 CodeMirror 文档/selection/extension；docChanged 调 onChange，Mod-s 调 onSave。selection 更新还受鼠标拖选期间延后、focus/geometry/viewport变化和生命周期取消控制。链接只接受特定左键、点击次数、修饰与空选区条件；文件回调优先，再走外链入口 | M-EXT `nr` L1620–1650；M-TAB EditorView 构造 L369–378、selection payload L418–437 | 原位编辑必须保持权威source模型；不能将渲染HTML反序列化成Markdown再覆盖文件。file identity/revision/selection归属是SmartDD设计要求，原型的简化offset并非参考实现本身 |
| M02 静态已证 | `ar` 按可见范围生成decoration；标题/强调/链接等在焦点与相关selection交集条件下显露标记。entity/图片widget也受选择、父节点和可解析路径约束。表格、列表、引用、水平线与完整fence分别处理 | M-EXT `ar` L1673–1768；插件更新 L1870–1874；代码行 `lr` 在该模块后续逻辑 | 装饰显示与source实际字符分开；选择与行列导航仍以source为准。不能将所有“点一下编辑”或整页contenteditable称为等价实现；具体边界需参考动态验收 |
| M03 静态已证 | `rr` 先看首行是否包含 `---` 再调解析器；仅有效结果产生开头replacement range与entries。`ir` 判断头部变化重算，否则map已有range；`Er` 随selection决定是否提供隐藏装饰。宿主从state取frontmatter并在非空时显示metadata区域 | M-EXT `rr/ir` L1652–1672、`Er` L1874；M-TAB L390、L641 | 完整YAML语法/格式保真尚未逐项证明。无效解析应保留可读正文，编辑源字符后重新解析；不可将原型只按冒号拆行当真实frontmatter解析能力 |
| M04 静态已证 | 数学有inline/block节点及selection decoration。`Gn` 初始放原始内容，惰性import KaTeX；用displayMode、strict=ignore、throwOnError=false。成功仅在DOM仍connected时写入并requestMeasure；失败catch不抛；mousedown将selection置到posAtDOM加contentEndOffset并focus | M-EXT `Kn/Un/Gn` L1475–1543 | 应验证合法/错误数学、回源编辑、加载失败与卸载竞态；不能把公式源码字样或固定公式图片称为KaTeX已迁移。该证据不证明所有TeX宏、扩展或字体都可用 |
| M05 静态已证 | `nr` 只有收到renderMermaidDiagram回调才挂 `qn`。`Jn` 仅对完整两CodeMark且CodeInfo首词严格为小写mermaid的fenced block建立block widget；code与边界相同可重用id。`er` 调外部renderer，注册ResizeObserver请求measure，destroy断开observer并调用renderer返回的cleanup | M-EXT `qn/Jn/Yn/Xn/er` L1544–1619；`nr` L1649；M-TAB L607传入回调 | 这是有条件的宿主桥，不是此模块内置所有Mermaid语法/主题。无callback、非完整fence、非匹配info保留源码；内容更新、移除、切文件必须释放旧渲染。真正renderer的安全与完整语法另验 |
| M06 静态已证 | 对缺URL节点的引用式图片，`ar` 从文档头取到 `fr` 构建引用token；`fr=131072`。若文档更长，把截取内容退到最后完整换行后再解析，并按syntax tree缓存引用表；只在local来源注册currentFilePath字段，图片路径另有反斜线/双分隔/代理码等guard | M-EXT `ar` L1691–1722、`nr` L1649、常量 L1844 | 131072是编辑文档字符串位置窗口（UTF-16 code units），不是bytes、整体读取上限或图片大小上限。窗口外引用解析失败不得截断正文。生产资源访问仍通过受控root/provider |
| M07 静态已证 | 库包有regex/replace等实现，但实际 `Jr → ii → Yr` 只接query、previous/next、计数/无结果和close；query变化构造新query时保留旧flags，不提供切换flags的UI。`Qr` 最多数999；看到第1000个匹配才将isCapped置true，正好999不截断 | M-SEARCH `Jr` byte44567、`Yr` byte44655、`Qr` byte46236、`ni=999` byte46645、`ii=class` byte47179 | 文件内Find不同于全文搜索100条结果；不从库源码推导产品已有regex/case/whole-word/replace按钮。原型通用matcher即使有这些参数，也不等于应暴露宿主未接入口 |

M-TAB 同时维护Markdown与源码各自的draft/scroll snapshot；切模式保存与关闭保护仍按此前[编辑全集](M9_文件类型与编辑状态全集.md)的状态机处理。本补充没有推翻已有大小、只读、冲突及保存规则。

## 3. Notebook 条件校正

**N01，静态已证。** [viewer索引](证据/m9-viewers-source.json) V9 `notebook-preview-panel-f6b78a668e49.js`，原始SHA `a2a5095cd62dad520fa4bf5bb5b8dfde3d5b75aee8b63e9b08f30cd6bfc9a6d2`；格式化文件 `release/m9-research/viewers/formatted/` 同名文件，`Ee` L202–224。

code分支先取 `descriptionMarkdown?.trim() ?? ''`，另外计算 `source.trim()` 是否非空。source非空且description非空时选 `Oe` 的内部Code折叠呈现；description缺失、空串、仅空白时直接显示代码。source为空/仅空白时是Empty code cell。outputs的非空判断随后独立控制输出区，**不决定内部Code默认折叠**。

| source.trim() | description.trim() | outputs | 正确呈现 |
| --- | --- | --- | --- |
| 非空 | 非空 | 空/非空 | 描述＋默认折叠的内部Code；有输出才另显示输出区 |
| 非空 | 缺失/空/仅空白 | 空/非空 | 直接代码；有输出才另显示输出区 |
| 空 | 任意 | 空/非空 | 空代码提示；描述和输出分别依自身条件呈现 |

此处修正旧描述“有output时内部Code折叠”。R2的需求R06.11和原编号M9-T-T33已改为完整交叉矩阵；不新增内核、运行或编辑能力。

## 4. 原型发现对迁移契约的补充

以下是**SmartDD迁移设计/原型事实，不是新增Codex动态取证**。不能从JS原型的字符串规范化推出真实文件系统身份或权限保证。

| ID／状态 | 问题与明确契约 | 对应材料与用例 |
| --- | --- | --- |
| I01 迁移设计，合成模型已有 | 嵌套根是导航入口；同host中 `/work/p` 的 `docs/a.md` 与 `/work/p/docs` 的 `a.md` 经main确认后是同文件，应共享内容身份。host不同即使绝对路径一样也不能合并。旧别名checkpoint若内容不同不可静默选最后值 | 原型 `file-workspace-model.mjs` 的documentKey/openDocument/migratePrototypeSaved是合成路径模型；生产仍走RootRequest→main签发root及canonical identity。新增D21/D22 |
| I02 迁移设计，合成模型已有 | 当前树root与active tab所属root可以不同。恢复、复制路径、读取、保存和外开使用active route的可信root；树筛选不能改变文件身份。root缺失保留不可用占位，不回退到另一根同名文件 | 原型FileWorkspace分别使用root与activeRoot；生产需重新签发root lease与request代际。新增D23/D24，补R04.7/R08.6 |
| I03 迁移设计，原型运行曾暴露 | Office未失焦输入必须进入保存/关闭flush；相同已保存快照再次Enter/blur不能重新dirty或重复write。保存途中产生新版本时，旧ack只更新对应base，不能清新dirty。冲突注入保留完整格式/合并/对象/notes | [Office补齐说明](../原型/Office补齐说明.md)及 `r2-office-gates`记录原型实际现象；后续修复/复验另记，不改历史证据。新增W27/W28，补R07.16 |

## 5. 当前Markdown原型能证明什么

[FileMarkdown.jsx](../../../../prototypes/m6-codex/src/FileMarkdown.jsx)与[file-markdown-model.mjs](../../../../prototypes/m6-codex/src/file-markdown-model.mjs)是原创合成实现：逐块保留from/to/raw，点击进入textarea，按source offset替换，task checkbox改源字符；相对链接按当前合成文件路径定位。`replaceMarkdownBlock` 校验原range文本，不以生成HTML重建文件。

它没有使用CodeMirror/完整CommonMark解析器；inline数学只是源码样式，math block显示源码，Mermaid是固定“需求→原型→验收”图并附真实输入的源码查看。frontmatter只是简化拆行，任意复杂嵌套Markdown、完整语法树与decoration、KaTeX字体/排版、Mermaid语法/主题、安全配置及selection映射均未完成等价迁移。原型资源来自合成fixture；真实相对图片/文件根权限仍属生产工作。

这能演示原位修改、保存/冲突关联、部分源码位置与界面条件，不能证明参考的真实编辑器/数学/图表引擎已经迁入WillYou。正式用例必须以真实实现和有expected的fixture执行；发现原型差异继续留在M9范围，不删除功能来宣称完成。

## 6. R2需求和用例同步

[需求](../需求.md)、[测试用例](../验收/测试用例.md)和[机器索引](../验收/用例覆盖索引.json)统一为R2-20261017。保留全部365旧编号，校正T33和W20，并新增20条：D21–D24、R19–R20、W27–W28、X01–X12。总计**385条／22组**，正式状态全部“未执行”，实际结果为空、证据数组为空。

新增组覆盖原位source/offset、装饰显露、frontmatter有效/失败、数学lazy及卸载、Mermaid callback/cleanup、131072单位引用扫描、链接与监听释放；跨组覆盖Find 999边界、宿主工具显隐、嵌套别名、active-root和Office保存输入。各表参数化分支必须分别记录子结果，不能将静态源码或原型成功计为正式通过。

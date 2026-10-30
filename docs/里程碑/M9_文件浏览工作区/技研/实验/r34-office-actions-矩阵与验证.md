# R3.4 Office 操作矩阵与依赖改写验证

2026-10-17。依据[需求 R06.8、R06.10、R07.11–18](../../需求.md)，核对当前 [Office 原型动作](../../../../../prototypes/m6-codex/src/file-office-model.mjs)与[控件入口](../../../../../prototypes/m6-codex/src/FileOfficePreview.jsx)。本报告把每个现有动作落实为候选生成、预期差异、失败处理及用例，不改变 R3.4 范围，不新增行列插删或复制工作表产品入口，不修改正式 425 条用例结果。

**结论：可以沿操作适配器＋精确补丁＋受控候选引擎继续实现，不能统一声称 Office 编辑已经完成。** 本轮 sheet 改名、重排、删除的有限依赖与部件门禁得到证据；被引用 sheet 删除的独立重算失败，且当前 LibreOffice 自己生成的文件也复现相同错误。该场景在当前引擎下必须返回失败、保留原文件与草稿，待修复引擎或接入可信计算/读取实现后复验；功能仍属于需求，不能通过永久禁用来结项。下列没有新实验的动作只是已明确的实现约束。

## 统一实施契约

1. 原始 OOXML 包是保真基线，原型 JSON 只是交互模型，不能拿简化 JSON 重建整份文件。每个动作携带文档实例、base revision、稳定 sheet/slide/object 身份、局部操作与 stateVersion；操作日志和 undo/redo 以同一权威模型为准。
2. 适配器先计算 `expectedChanged / expectedAdded / expectedRemoved`，再生成隔离候选。除了部件名，须验证对象身份、关系目标、Content Types、预期公式/布局语义及未编辑部件 SHA-256。允许删除用户指定对象的私有依赖；仍被其他对象引用的部件必须保留。仅“ZIP 能解压”“XML 可解析”不算通过。
3. 简单文字、数值、明确结构修改优先精确补丁。共享字符串、样式、图表或资源被多处引用时采用新建独立项/部件再重定向的方式，不顺手改变其他使用者。未知字段/扩展保留；不能证明依赖闭包或格式语义时在候选阶段拒绝，保留草稿及具体原因。
4. LibreOffice/UNO 只能操作自有临时副本，用于计算、布局或生成动作候选；禁止把整包重写结果直接覆盖原件。提取候选时按稳定身份映射，仅取声明字段/部件，重新执行完整门禁。计算缓存按公式版本取回，不能复制不相干的旧缓存或用错误缓存假冒正确重算。
5. 候选通过后才进入 R07.17 的本机保存 broker：串行提交、基线检查、opId 幂等、保存中再编辑不被旧回执清除。提交前失败不动原件；提交后不确定/冲突保留 current/displaced/draft，不自动交换回去。关闭 flush 包含还在 formula textarea、对象文字或 notes 中的输入。UI 不得先显示“已保存”。
6. 读取、候选生成、公式重算、ZIP 物化和保存各有取消/超时/实例检查，迟到结果不能覆盖另一文件。宏不执行、外链不访问；XLSM 完整编辑与宏保真没有从 XLSX 实验推得。签名失效提示及未知签名/保护条件须在写入前处理。

## XLSX 动作矩阵

表中“待实现/验证”表示仍需实现并完成该场景证据，不代表移出 M9。`Xnn` 是本报告的操作子场景，不新增正式用例编号。所有写动作同时覆盖 J05–J10、W26–W28 的来源门控、更新排空/物化、失败/冲突/关闭与回执要求。

| 子场景／当前动作 | patch / engine 路线 | 预期部件、关系与语义差异 | 冲突／失败与边界 | 用例及已有证据 |
| --- | --- | --- | --- | --- |
| X01 `cell` 普通文字、数值、布尔值 | 原单元格类型感知补丁；inline/shared string 各按原存储处理，共享字符串需计数或复制项 | 目标 worksheet 的对应 `c`；确有新增字符串时才改 sharedStrings 及其关系/类型；不改变邻居公式、样式、批注 | 不把 TRUE/FALSE 字面文字自动当真正布尔；歧义富字符串/受保护单元格拒绝候选；数字校验按当前选区规则 | W20/W24/W25，Y10/Y11；旧精确补丁仅覆盖其合成样本 |
| X02 `cell` 公式输入、formula textarea | 解析为公式语法；依赖计算由适配器/计算引擎负责，旧缓存失效；不可 `eval` | worksheet `f`/typed `v`；显式登记 calcChain/计算属性失效；改引用后更新对应依赖结果，字符串常量不当引用 | shared/array/dataTable、动态依赖与错误捕获等未支持分支不得猜；保留输入并解释；原型小型算式求值不等于 Excel 引擎 | W19/W20/W26，Y12/Y13；OA07/OA13 拒绝样本，OA11 有限重算 |
| X03 `format` 字体/字号/粗斜下划线删除线、颜色/填充、对齐/换行/边框 | 修改目标 cell 的样式引用；新增/复用等价 xf、font/fill/border/alignment，避免更改共享样式定义 | worksheet 的样式索引及 styles.xml 必要节点；仅目标范围外观改变，非选区仍逐值/逐样式等价 | 主题色、富文本 run、继承样式须分别适配；不能把 CSS 样式直接序列化为 OOXML | W18/W24；OOXML 格式组合及重开效果待验证 |
| X04 `format` 常规/数值/货币/百分比、小数位 | 依据数值类型新增/复用 numFmt 和 xf，不改变单元格本值 | worksheet/style；显示倍率/舍入按 number format，不能写回格式化后的字符串 | 日期/区域格式与已有自定义 numFmt 不应被无关覆盖；输入校验与显示格式分离 | W24，Y13；待验证 |
| X05 `clear` contents/format/all、`clear-format` | 三种独立操作：内容清除 `f/v/is`，格式重置目标样式，all 为两者组合 | 对应 cell/样式引用，必要时依赖缓存失效；原型 all 不解除 merges，不随意删批注、图表、验证规则、关系或其他未知数据 | 清除共享字符串不改变其他引用；不使用整行/整表重建清空元数据 | W24/W25，Y10/Y12/Y13；待验证 |
| X06 `fill` 下填／右填 | 解析相对/绝对引用并按目标位移翻译公式；值复制仍保持类型 | 目标范围 cell、公式与必要缓存失效；源值不改；`$A1/A$1/$A$1` 各按语义 | 原型当前字符串复制不能作为公式填充实现；shared/array/structured/外部依赖须有适配再开放 | W24/W26，Y12/Y13；真实公式填充尚未实验 |
| X07 `merge`／`unmerge` | 已知合并区间补丁；先验证矩形/交叉/覆盖数据；取消合并只解除指定区间 | worksheet `mergeCells`；沿现有原型保留被覆盖 cell 的值，只改变显示合并，不借合并清空内容；undo 可恢复 | 若目标引擎读写会丢非空从属格则拒绝候选并说明；已有交叠合并拒绝。未定义的破坏性合并不能悄悄取代当前保值行为 | W24，Y13；原型交叠判断不证明 OOXML 内容保全 |
| X08 `fit-column`／`fit-row` | 目标字体/换行/合并上下文的测量或布局引擎；回填有限行列属性 | worksheet `cols/col`、row `ht/customHeight` 等；仅指定行列尺寸改变 | 缺字体/测量失败明确失败，不用字符数估算冒充真实排版；原型尺寸是演示 | W24/W26，Y13；待实际字体和重开验证 |
| X09 `validation` 数字或公式／不限制 | 对目标 sqref 的 validation 规则合并/拆分；保留范围外规则 | worksheet dataValidations 及 formula1/2；若规则依赖命名区域则纳入依赖图 | 输入文字、空值、公式的允许边界逐项验证；未知规则不能被整组清空 | W24/W26，Y13；旧 fixture 仅证明未编辑验证规则被保留 |
| X10 `conditional` 条件填充阈值 | 对选区生成具体条件及 dxf，保留 priority/stopIfTrue 与外部规则顺序 | worksheet conditionalFormatting、styles dxf；显示与数值含义一致 | 冲突范围、扩展 x14 规则需要适配；不得把静态 fill 当动态条件格式 | W24/W26，Y13；待验证 |
| X11 `checkbox` 插入／勾选 | 明确当前 OOXML 复选框表示及绑定 cell 的适配器；值与控件共同维护 | 视所支持的 OOXML 控件族涉及 cell、feature/metadata 或 drawing/control 及关系；须列精确清单 | 写字符串 FALSE 不证明复选框；未证明真实可读回控件前不可伪保存成功；需求保留 | W24/W26，Y13；仅原型控件，真实格式适配未验 |
| X12 `sheet-add` | 新建最小 worksheet＋稳定 sheetId/rId；沿已证结构补丁 | workbook、workbook rels、Content Types、新 worksheet；旧表及共享资源不改 | 重名/ID 碰撞、最后可见性及限额真实校验；原型 20 表上限只是演示限制，不是新增产品上限 | W21/W24/W26，Y13；OS01/OS09 有限样本通过 |
| X13 `sheet-rename` | 以 sheet 身份改名，语法 token 层改直接引用、命名区域与 chart `f`；字面字符串不替换 | workbook、引用该表的 worksheet/chart 等实际依赖部件；sheetId/rId 不变；名称引号按语法转义 | 名称大小写冲突、31 UTF-16 units、非法字符/首尾引号拒绝；3D/INDIRECT/shared/array/calcChain 当前有限适配器拒绝；不能全包正则替换 | W22/W26，Y12/Y13；OA01/OA05/OA07/OA08，OA11 重算 7/7/100 通过 |
| X14 `sheet-move` 重排 | workbook sheet 序列重排，同时按身份重映射 localSheetId、activeTab/firstSheet | 本样本仅 workbook.xml；局部命名区域及当前表仍指同一身份；part/rId/公式不变 | 不可只移动显示数组而把局部名称绑到另一表；遗漏视图/名称语义即失败 | W22/W26，Y13；OA02 通过，复杂 workbook views 等仍需扩展 |
| X15 `sheet-delete` 无被引用依赖 | 删除 sheet 与该表私有依赖闭包，按剩余图的可达性保留共享部分 | workbook/rels/Content Types；专属 worksheet、drawing/chart/comment 等按清单删；局部名称删除/重编号 | 最后一张或最后可见表拒绝；未知关系不能猜可删；新增非预期丢件即拒绝 | W23/W26，Y10/Y13；OA03/OA06/OA09；尚无任意文件兼容结论 |
| X16 `sheet-delete` 被其他公式/名称/图表引用 | 依赖引擎更新引用为正确失效语义；受控 UNO 候选可只提取字段回原包 | X15 加实际引用部件；保留字面字符串，缓存须符合最终公式；共享资源不误删 | **当前引擎门禁：OA12 重算为 #NAME? 而非 #REF!；失败保留原件/草稿，不能交付此分支。** IFERROR 等不可盲写 #REF 缓存；下一步修复/替换可信计算读取实现 | W23/W26，Y12/Y13；OA04/OA10 结构检查与 OA14 提取通过，不抵消 OA12 失败 |
| X17 `insert-sheet-object` chart／image／shape | 独立对象适配器；shape/drawing、image bytes、chart＋数据源分别生成 | worksheet drawing 关系、drawing.xml/rels、media/chart/必要嵌入数据、Content Types；稳定对象 ID/anchor；未编辑对象不变 | chart 不是示例标题；图片必须真实本机资源；不访问外链；拒绝断链、未知图表类型/锚点语义 | W24/W26，Y13；当前只是固定对象卡片，无 workbook 对象选择/移动/编辑/删除，不由本矩阵新增这些入口 |

## PPTX 动作矩阵

所有写动作同时覆盖 J01–J04、W08、W26–W28：必须具备正确来源与 read/write 能力，按完整 bytes/etag 基线串行保存、冲突/失败保留输入。`Pnn` 是本报告子场景。

| 子场景／当前动作 | patch / engine 路线 | 预期部件、关系与语义差异 | 冲突／失败与边界 | 用例及已有证据 |
| --- | --- | --- | --- | --- |
| P01 `slide-add` | 建新 slide，显式关联可复用 layout/master/theme，分配稳定 ID | presentation/rels、slide/rels、Content Types；不修改原模板部件 | 没有适用 layout 时不能复制近似样式冒充保真；主题继承与新页布局仍需验证 | W13/W16/W26，Y13；待真实文件实验 |
| P02 `slide-duplicate` | 复制 slide；独立 notes 与可变 chart/embedded workbook 按需复制，安全共享不可变媒体/layout | presentation/rels、clone slide/rels、notes/backref、必需依赖与类型登记；原页/备注不改 | 不可把新旧备注绑定同一 slide 或共享可变 chart 后互相污染；复杂 master/动画/媒体关系需能力检查 | W13/W26，Y10/Y13；OS02/OS10 独立 notes 样本通过，非任意幻灯片复制证明 |
| P03 `slide-delete` | 删除 presentation 对应 ID，释放仅该页所有的关系依赖 | presentation/rels、该 slide/notes/专属对象部件/类型；共享资源保留，导航移到有效页 | 原型最后一页禁删保持；自定义放映/章节/动画跳转的引用须修正，不能漏掉页外依赖 | W13/W26，Y13；完整删除依赖未验 |
| P04 `slide-hidden` Show/Hide | 修改目标 slide 显示属性，不删除页 | 目标 slide XML；页身份、顺序、notes/对象关系不变 | 暂不具备写能力时按钮不可假启用 | W13/W26，Y13；OS04、OS10 有限样本通过 |
| P05 `slide-notes` | 定位 notes 正文 shape/run，仅改用户输入区；缺 notes 时显式创建对应部件/backref | notesSlide XML，必要时 notes rels/master关系/Content Types；页号/占位符不误改 | 正文多 run、占位符、复杂文本边界需对应适配；readonly 来源只读；最新输入纳入 flush | W10/W27/W28，J03/J04；OS02 证明复制 notes 独立，不是所有 notes 编辑通过 |
| P06 `slide-background` | 目标 slide 的局部背景覆盖；保留继承链 | slide `cSld/bg` 等明确节点；不改全局 master/theme | 主题色、图像填充/效果未知时不替成纯色近似；取消保持原背景 | W16/W26，Y13；待验证 |
| P07 `element-insert` text／shape | 新独立 shape、唯一非视觉 ID、变换与合法几何/text body | 目标 slide；必要本地关系；仅新增对象改变 | 原型图形 CSS clipPath 不等于 OOXML preset/custom geometry，需逐 shape 适配 | W16/W26，Y13；待验证 |
| P08 `element-insert` image／`imageVariant` 演示替换 | 真实图像适配器创建 media 与 picture rId；替换时只重定向目标对象 | slide/rels、media、Content Types；共享图片按需另建，其他使用者不改 | 当前 imageVariant 是合成样式切换，不能当真实图片替换/上传已做；本机资源权限/格式失败保留原图 | W16/W26，Y10/Y13；真实格式路径未验 |
| P09 `element-insert` chart／`element-update` chartType、values、axes、gridLines、legend | 图表 adapter 同步 chart XML、series caches、内嵌 workbook/外部数据引用语义 | slide/rels、新/现 chart、必要 embedded workbook 及其关系/类型；避免图形数据与缓存不一致 | 共享 chart 写时复制；外部数据不主动抓取；未知 chart/坐标轴/公式依赖拒绝，不能仅替柱状图截图 | W16/W26，Y12/Y13；待逐类型真实读写 |
| P10 `element-insert` table／`table-cell`／headerRow、headerColumn | DrawingML table/grid、目标 cell runs、tableStyle 标志补丁 | slide 内 graphicFrame/table；继承样式索引按原关系保留 | 合并单元格、行高、跨格键盘/输入法、富文本不可以纯二维字符串覆盖；原型固定 3×2 表，没有结构增删/合并入口 | W15/W16/W26/W28，Y13；当前箭头/Tab/Enter 焦点不等于 Shift 扩选/Cmd+A/F2/Escape 全套，真实表格读写待验 |
| P11 `element-update` text、字体/字号、粗斜下划线删除线、颜色、对齐、项目符号/编号 | 局部 run/paragraph/body 属性补丁，明确选区与继承语义 | 目标 slide 文本节点/格式；不重建整页或清掉未编辑 run/超链接 | shape 文本与 textbox 同规则；字体不存在/布局变化须反馈；局部替换不能吞富文本关系 | W16/W26/W28，Y10/Y13；旧文字补丁仅覆盖其有限目标，不证明全部格式 |
| P12 `element-update` x/y/width/height/rotation；拖动／取消 | 转换为 OOXML EMU/角度单位，仅修改目标变换，拖动结束提交单次操作 | slide 对象 `xfrm`；组变换/裁剪/旋转中心保留语义；取消恢复原坐标 | 原型像素/缩放换算不等于真实页尺寸；group-child 变换与越界规则须测试 | W16/W26/W27，Y13；待验证 |
| P13 `element-update` fill、opacity、shadow、border/style、shape | 对应 solid/alpha/effect/line/preset geometry 属性适配 | 目标 slide 对象属性；全局主题与其他对象不改 | 继承、渐变/图片填充、复杂阴影/线型未识别时不降成 CSS 近似后写盘 | W16/W26，Y13；待验证 |
| P14 `element-layer` front/forward/backward/back | 在对应父 spTree 内重排对象序列，保持 ID/内容/关系 | 目标 slide spTree 序列；其他对象相对顺序按操作保持 | 组内/组外及非绘制属性节点不可混排；菜单快捷键文字不证明绑定可执行 | W14/W26，Y13；待真实层级重开验证 |
| P15 `element-delete` Delete/Backspace | 删除目标对象及不再引用的私有资源；选择/焦点回落 | slide 与确需删除的关系/私有 media/chart/嵌入数据/类型；共享资源保留 | 输入框/IME 下删除键不能删对象；未知依赖/动画引用需要适配再提交 | W14/W16/W26，Y10/Y13；待验证 |

既有 OS03 验证了演示稿顺序补丁，但当前原型没有 slide 拖排/重排动作，故列为已有结构能力证据，不借本报告增加产品入口。工作表复制、行列插删也没有本次现有入口，不以新实验扩大范围；它们涉及的公式依赖复杂性仍是选型风险。

## 共用动作、纯视图和来源边界

| 动作／状态 | 实施约束与预期差异 | 用例／未验证边界 |
| --- | --- | --- |
| `undo`／`redo` | 恢复完整操作与受影响依赖状态、选区/对象身份及版本，不只恢复字符串值；应用撤销后重新物化候选；保存 ack 不清掉后续 undo 产生的新 dirty | W08/W18/W27/W28，R07.2；原型至多 50 份 JSON 快照不证明文件级撤销或重开恢复 |
| XLSX sheet 选择/View page、地址标签、fx 聚焦、formula 只读、范围统计 | 视图状态不写 OOXML；fx 不插公式，地址非可编辑定位框；活动表切换时须先处理未提交输入；如未来确需持久化活动表，单独列 view 状态动作 | W19–W21/W25/W28；不得把 UI 选择顺手加入任意保存 diff |
| PPT 缩略图/网格/当前页、Zoom/Fit、Shift+1、Ctrl/Meta+0、加减、网格快捷键、notes 展示、格式面板 | 均为本地视图状态；输入/IME/menu guards 生效；切页不丢文字输入，不修改页内容 | W09–W12/W16/W28；图层菜单加速文字不推断真实快捷键 |
| starting/live/refreshing/blocked/fallback、manualEditUi、来源 read/write／library/readOnly | 先按来源与运行能力判定，再决定可用操作；展示具体不可用原因。格式门控不同于基础单元格编辑门控；服务失败不伪装只读保存成功 | J01/J05–J10/W17/W18/W26；能力门控不是删除尚未交付功能的方式 |
| DOCX redlines/Request edits、Office 条件评论 | DOCX 显示修订不代表接受/拒绝并写回；应按上下文交接，不通过本矩阵编辑 OOXML 或恢复 CLI 审阅流程；DOCX 分页/停靠/红线只是视图 | R06.9/R07.14；本报告初次核对时 Office 评论仍是本地 requests 列表；后续已接原型终端交接，见[评论投递专项](../../原型/r34-office-context-投递修复与验证.md)，不借此扩大 OOXML 能力结论。独立条件用例保留，不将 XLSX/PPTX 探针扩展为 DOCX 全格式写回 |
| XLSM、CSV/TSV | 上层原型复用了 spreadsheet 控件，不足以证明格式允许写入；XLSM 宏/签名保留不执行须另验；CSV/TSV 分隔/引号/编码及样式不可持久化边界单独适配 | R06.7/R06.8；本轮只生成 XLSX，不能沿用为 XLSM 或分隔文件验收 |

原型另有限定的 20 sheets、100×26 cells、40 slides 演示规模；公式只支持本 sheet 的 A1、有限函数/四则，PPT 图表数据最多 8 个非负值、9 种图表与 11 种形状为合成渲染。它们都不是经评审新增的产品上限或完整格式兼容声明，不得用这些 JSON 简化行为替代上表的真实文件适配。

## 本轮独立实验与真实失败

新脚本：[office-actions-probe.py](office-actions-probe.py)，[最终结果](office-actions-result.json)。全部输入是临时创建的合成工作簿；包含 3 张表、直接/区域公式、字符串常量、全局/局部名称、图表、合并、批注、验证规则与未知二进制部件。未打开用户文档，未修改生产 Office 实现；运行结束检查原输入 SHA-256 不变并清理私有文件/进程/profile。

| 证据层 | 结果 | 能证明什么／不能证明什么 |
| --- | --- | --- |
| 结构候选 OA01/02/03/04/10 | 5/5 | 改名、重排、无引用删除、被引用删除 XML、共享关系保全；包括 openpyxl 独立读取，但它不重算公式 |
| 拒绝门禁 OA05/06/07/09/13 | 5/5 | 非法名称、最后可见表、未支持依赖、非预期丢件、错误捕获语义被正确拒绝；不是被拒功能已支持 |
| token 单元 OA08 | 1/1 | 直接引用与字面字符串/另一工作簿 token 区分；不是完整外链工作簿实验 |
| 独立计算 OA11/OA12 | **1 通过、1 失败** | 改名候选重算为 7/7/100；删除被引用表候选重算为 #NAME?/#NAME?/100，预期 #REF!/#REF!/100，故失败 |
| 引擎候选提取 OA14 | 1/1 | UNO 生成隔离候选，按 sheet 身份定位并仅提取 B2/B3 的 f/v/type；合入原包后 4 个部件改变、7 个该表专属部件删除、7 个保留部件逐字节相同；独立读取公式及 typed cache 为 #REF!；**不证明重新计算兼容** |
| 引擎自身负对照 | 缺陷复现 | [自回读报告](office-actions-reference-self-roundtrip.json) 保存完整前后 worksheet XML；同一引擎自己导出再打开也发生 #REF!→#NAME?，不能把 OA12 改成通过 |

最终脚本退出码为 1，总计 13 个检查通过、1 个失败，**没有“全部通过”结论**。各层独立列出，不能把正确拒绝和格式支持混在一个成功率里。旧 [结构实验 10/10](r34-office-pty-save.md#office-结构编辑) 仍是旧样本证据，不被覆盖，也不消除本次失败。

### 删除公式的定位与候选提取

独立 [UNO 校准脚本](office-actions-reference-calibration.py) 新建 2 表工作簿，删除 Data 后引擎内部公式为 `=#REF!.B2+#REF!.B3` 与 `=SUM(#REF!.B2:B3)`，错误码 524。它自己导出的 OOXML 是 `#REF!+#REF!`／`SUM(#REF!)`，cell `t="e"`，缓存 `#REF!`。同进程重新打开刚导出的文件，公式变为小写 `#ref!`，错误码 525，显示 `#NAME?`；再次 calculateAll 也不恢复。因此本机 LibreOffice 的这个 OOXML 自回读路径不满足删除引用语义，不能通过仅修正我们自己的 token 替换来关闭问题。

之前三轮失败如实保留：[bare token](office-actions-result-attempt1.json)、[保留 cell/range 后缀](office-actions-result-attempt2.json)、[匹配引擎 bare token＋typed error cache](office-actions-result-attempt3.json)；对应源快照在 history。新 [UNO 候选脚本](office-actions-uno-candidate.py) 使用当前完整合成 fixture 进行删除，内部计算为 524/524/0，再把生成结果的声明字段提取回原 ZIP。OA14 证明这一保全方法可做：原始 styles、theme、Spare worksheet、属性、根关系、未知二进制等 7 个保留部件哈希全同，详见结果中的 `retainedOriginalPartHashes`。

引擎整包中缺少/重命名的 part 路径仅记录作清单差异，不能逐项直接当数据损失：删除 Data 本来会移除私有 chart/comment，引擎还可能给剩余 sheet 重新编号。本实验始终用原包关系图控制 expectedRemoved，不依据引擎重写的路径清单盲删。引擎候选未覆盖源文件；独立读取 typed cache 成功也不能抵消其计算器重新打开失败。

## 尚需完成的工程与验收

- **具体能力前置**：修复或替换被引用 sheet 删除所用的可信计算/读取实现并重跑本负对照；补 shared/array/3D/动态/structured reference、calcChain、图表/名称等完整依赖适配；checkbox 与可编辑 chart/嵌入工作簿需真实格式契约。当前门禁保留修改和原因，不将失败转换成有损另存成功。
- **按矩阵实现**：真实 Office 状态模型、各工具到 OOXML 的适配器、操作日志/undo、取消/超时/资源预算、最新输入 flush、候选差异与关系门禁，以及生产保存通道接入。矩阵已经给出工程默认路线，不需要让用户选择 ZIP/XML 协议。
- **开发后验收**：格式/字体/布局与真实 Office 本体重开、复杂文档、平台与安装包、崩溃/满盘/权限/冲突恢复、完整 UI 与真实输入法。原型控件和单项探针不能替代这些结果。
- **没有新增用户产品决定**：D01 独立终端与磁盘视图、D07 本机文件区继续有效；没有新增 Office 功能或缩减需求。若未来只能接受明确的兼容性损失或降低范围，才须向用户提出具体变化；不能在技术报告里暗中实施。

实施背景参考：[openpyxl 官方文档说明其行列插删不负责依赖管理](https://openpyxl.readthedocs.io/en/3.1.1/editing_worksheets.html)、[Open XML 公式与缓存说明](https://learn.microsoft.com/vi-vn/office/open-xml/spreadsheet/working-with-formulas)、[CellFormula 的 shared/array 等存储语义](https://learn.microsoft.com/en-gb/dotnet/api/documentformat.openxml.spreadsheet.cellformula?view=openxml-2.8.1)。这些说明支撑依赖适配不能省略；具体通过/失败仍以本报告的实际实验为准。

复现入口（只生成自有临时文件；LibreOffice 需允许本机进程运行）：

```sh
python3 docs/里程碑/M9_文件浏览工作区/技研/实验/office-actions-probe.py --output /tmp/m9-office-actions-result.json
/Applications/LibreOffice.app/Contents/Resources/python docs/里程碑/M9_文件浏览工作区/技研/实验/office-actions-reference-calibration.py --output /tmp/m9-office-self-roundtrip.json
```

环境、时间、源哈希保存在 JSON；当前可复现源清单见 [manifest](office-actions-manifest.json)。history 内源快照用于追溯，需要恢复到原实验目录相对位置后才可直接运行，不能宣称它们是独立安装包。

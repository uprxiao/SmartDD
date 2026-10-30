# P09 ChartEx 固定引擎实测与后续路线

2026-10-18；依据 M9 R3.4-P1/P09。本报告记录开发中发现的缺陷，不改变九种图表和 419 条本期用例范围。

## 已证实

固定 LibreOffice 26.2.4.2 / `0229ac93fcf0d7cbc6376066c6f35021cef002dc` 可以读取 ChartEx 数据，但不具备本期四种现代图表的正确绘制器。[精确版本的 VSeriesPlotter](https://github.com/LibreOffice/core/blob/0229ac93fcf0d7cbc6376066c6f35021cef002dc/chart2/source/view/charttypes/VSeriesPlotter.cxx) 在未匹配类型时选择折线绘制器；类型名、服务注册和成功导出 PDF 均不能证明类型已实现。

- [生成探针](pptx-chartex-fixture-probe.py) 使用官方 `funnel-pp1.pptx` 容器（Git blob `df34aa1618d0d4900739753f779560b24926197d`），移除图片回退，替换为四种真实 ChartEx 类型和 6/3/4/2/5 缓存、内嵌工作簿。
- [排版探针](pptx-chartex-render-probe.ts) 使用生产原生 broker、固定资源签名/哈希校验、受限离线工作区。四个 PDF 均导出成功，但四张 PNG 完全一致，SHA-256 为 `27443a9df0e7b5b43492df5958eb7d6b796ce7397d82093ecc264c3d77cf91c2`，实际是折线。该原生结果记为失败。
- 再对官方原样漏斗图和仅移除图片回退的版本分别排版：仍是三条折线，两张 PNG 同哈希 `ba85bd2f30119a4e25cb0af1502714e24f31b612d34ae668106eb951d38e256b`。不是本项目改写数据后才发生的问题。
- [官方 26.8 说明](https://blog.documentfoundation.org/blog/2026/09/17/libreoffice-26-8-and-interoperability/)仍明确区分保留现代图表定义与显示/编辑能力；本轮不把升级版本当成已验证修复。

样本与详细输出在 `/private/tmp/willyou-chartex-{fixtures,render}-r1/`、`/private/tmp/willyou-chartex-upstream-{input,render}-r1/`；[机器证据](../../验收/证据/m9-development-office-pptx-chartex-20261018.json)记录完整来源、版本、哈希、失败及修复边界。外部 Office 样本只在临时实验目录保留，没有作为应用资源分发。

## 已实施的错误边界

M9-DEV-029：`preview-capabilities.ts` 在 Worker 内识别仍被文档引用的 ChartEx，DOCX/PPTX 的预览入口在原生排版前明确拒绝；孤立图表定义不误伤普通预览。未知 layoutId 使用固定文案，不直接显示不受信任标识。仅阻止错误投影，保留编辑文档、保存通道和原图表/内嵌数据。

修复前 5 项回归均错误返回成功；修复后主进程/共享 262 项和渲染层 95 项通过，55 项 opt-in 当时未执行，类型检查通过。原生错误未被消除，现代图表能力仍待实现；包内与实际 App 的最新状态分别见机器证据，不能把错误提示当作 P09 完成。

## 后续技术路线（下节记录当前增量）

继续保留可编辑 ChartEx 和真实内嵌数据作为唯一保存来源，研究单独的、随源数据变化的受控矢量投影，交给现有原生隔离服务排版。投影不得进入文档历史、草稿或保存候选。必须独立核对数据语义、几何/比例、类型、颜色、轴/网格/图例、变换、版本/取消和保存重开；未经这些验证不能启用。

直方图需区分数值分箱与按分类汇总，不能把任何柱状图仅改名为直方图。[Microsoft 的按分类规则](https://support.microsoft.com/en-us/excel/create-a-histogram)和 [CT_Aggregation](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/e112cc82-0d94-4532-bc7a-c1daf8ebac4e)、[CT_SeriesLayoutProperties](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/1ff5c9ad-828a-4d0c-be72-07754eba3588)提供可对应既有原型分类柱高的路线，但本轮尚未验证其生成与投影，不写为完成。复杂既有图表和完整保真矩阵仍保留在本期适配工作中。

## 2026-10-18 接续：真实数据编辑与矢量几何可行性

生产 `pptx-chartex-data.ts` 已接入四类单系列、同长度数值编辑：按真实 `dataId` 解析数据维度，修改前核对内嵌工作簿与缓存一致；通过既有写时复制路径同步单元格和 `cx:pt`，保留原共享图表/工作簿及无关部件。数据项变化、外部来源、公式依赖、稀疏/多层缓存和未知扩展继续明确拒绝，不静默破坏源件。现代图表类型转换、插入、显示开关及完整预览仍未接入；错误预览拦截保持有效。

[矢量探针](pptx-chartex-vector-probe.py)只替换临时包的幻灯片图表框，保留其他部件逐字节不变；原始输入未修改。四个图形均实际导出，[独立像素测量](pptx-chartex-vector-measure.py)核对漏斗宽度、矩形树面积、瀑布累计台阶及直方图数值分箱 2/1/2，最大比例误差依次为 0.8/0.8/0.4/0 像素。已查看四种图形。这仅证明几何路线可行，尚不含源样式/标题/轴/图例，未接入产品预览；不能替代完整 P09 或批准原型中的分类直方图语义。

本次同时按 [CT_Binning](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/2e5dfc5a-d3b7-4390-bc00-188a2fefcb3a) 修正实验夹具：`binCount` 应为元素文本；按 [CT_ExternalData](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/9a9d715b-dcae-4b03-89e9-a6362994e1a2) 将 `autoUpdate` 改为无命名空间属性。r1 原样保留，r2 重建后原生四图仍产生相同的错误折线 PNG，故引擎缺陷结论不变。首次矢量脚本的 `name` 参数冲突在输出前修复，保留执行事实。

276 项主进程/共享回归及 95 项组件回归通过，57 项 opt-in 当时未执行；类型检查通过。源码快照、r2 输入/输出哈希、像素结果及最新包内状态见[本批证据](../../验收/证据/m9-development-office-pptx-chartex-data-20261018.json)。真实 App 复查仍被锁屏阻塞，正式 3/419 不变。

## 2026-10-18 接续：受限源件预览正式接入

生产 `pptx-chartex-create/display/geometry/preview.ts` 已接真实 ChartEx 源件生成、明确 RGB/字体/轴/图例的解析及独立排版副本。基本图转现代和现代四类型之间的转换保留真实数据引用及旧依赖；现代转基本仍未实现，类型选择器保留全部九种，失败返回明确原因并保留原件，不能因此缩减已确认矩阵。直方图生成使用 `cx:aggregation`（分类汇总），解析也区分显式数量和左右闭合数值分箱；没有把两种语义混同。自定义标题、关联主题/样式、多层分类、多系列和其他未适配格式仍拒绝预览并保留数据；这些继续属于本期待完成工作。

`PptxDocument.previewSource` 与 `materialize` 分离；只读 pages Worker 使用 `prepare` 返回独立预览字节。临时副本只替换被引用的幻灯片图表框，保留框/组的坐标、旋转和反射，保留全部图表、内嵌数据及其他非幻灯片部件。原图表不是图片或重命名的基础图表。预览前核对实际工作簿单元格与缓存，保存/草稿/历史始终使用源件；已开始的 Worker 操作不因预览取消而销毁持有编辑状态的 Worker，迟到版本不能替换当前结果。只缓存小型数据验证凭据，避免保留全部已解析内嵌工作簿。表格定位的临时副本也应用相同图表投影，标记不进入保存候选。

385 项 Office/共享/渲染层回归通过，58 项 opt-in 当轮未执行；内存缓存调整后 33 项受影响回归通过，与前轮不累加。最终类型检查通过。实际 Worker/原生 r3 用真实 6/3/4 数据得到四类不同图形，独立测量最大比例误差为漏斗 0.462px、分类直方图 0.462px、瀑布 0.616px、矩形树 0.231px；瀑布累计台阶一致。开关前轴/网格对应色像素为零，开启后四类均可见，PDF 文本含真实分类图例 1·2·3；只读入口、保存重开、未完成数据输入恢复及 20 步撤销恢复所有原部件通过。已查看四种带开关图形；这些是原生排版证据，非 App UI 验收。

r2 首次新增网格像素断言失败：树图覆盖背景网格后只有边缘 45 像素，统一 >100 的阈值错误。核对原型先画网格、后画数据的顺序后，为覆盖大部分绘图区的树图检查可见边缘，r3 通过；原失败报告保留。类型检查曾暴露字体收窄与测试 mock 参数类型/旧无参调用，均已修复，失败日志保留。

仍存在原型差异：当前树图按真实数值分配完整面积，原型每块另扣 2 个逻辑单位形成间隔；尚未对齐，不能宣称视觉完全一致。完整图例语义/布局、源样式保真、真实 Office 互操作、组/旋转/反射矩阵、数量变化、完整九类型往返和 App 键盘/IME/主题矩阵继续。[614 文件快照、新包及包内验证记录](../../验收/证据/m9-development-office-pptx-chartex-preview-20261018.json)是本轮接续依据；M9-DEV-029 保持开放，正式 3/419 不变。


## 2026-10-18 接续：源图表双向转换与散点颜色

R3.4-P1 P09 已知单系列转换已接真实 Worker；原生九类型文件独立确认缓存及内嵌工作簿数值 6/3/4、类型、颜色定义、字体，保存重开和44步撤销通过。此处的九种类型覆盖不代表所有来源/样式/数量组合已支持，图像非空与不同哈希也不代表原型像素一致。详见[完整轮次与失败证据](../../验收/证据/m9-development-office-pptx-chart-roundtrip-20261018.json)。

散点出现新的 M9-DEV-030：颜色已在 dPt/spPr 和 marker/spPr 中，但原生仍显示默认单色。固定 LO 26.2.4.2 / `0229ac93fcf0d7cbc6376066c6f35021cef002dc` 的 [seriesconverter.cxx](https://raw.githubusercontent.com/LibreOffice/core/0229ac93fcf0d7cbc6376066c6f35021cef002dc/oox/source/drawingml/chart/seriesconverter.cxx) 中，DataPointConverter::convertFromModel 只有 symbol 或 size 不同于系列默认时才调用 convertMarker；相同圆形/尺寸、仅颜色不同被忽略。已只读核对精确版本，文件 SHA-256 `f42306096a9b6f1a5cf6a00832c539f19a4233424c54bf8a6f56399e44fd9dc1`。OOXML 逐点 marker 定义参见 [DataPoint](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.charts.datapoint?view=openxml-3.0.1)。没有复制上游实现进入产品。

当前适配为全部已知点显式 circle/6、系列默认 none。原生 r4 的精确三色检查失败 0/0/0；r5 为66/66/68，三点位置/颜色可见。包内相同检查也得到66/66/68；最终四项选定专项通过，七项未选定。四现代图的比例误差继续小于1px，漏斗→散点→漏斗、只读预览、保存重开、未完成输入恢复和18步撤销通过。

此适配会使系列图例默认标记不显示；基础图 Value 图例、刻度和折线/面积样式仍与原型有差异，不能宣布完整视觉修复。Strict 命名空间仅有模型层往返验证；未知标题/主题、多系列、分箱/聚合点数、数量变化、横轴网格/自定义轴位置及饼图轴配置往返仍待实现。实际 App 仍待工具可用，M9-DEV-029开放，M9-DEV-030代码/原生/包内通过但App待验。

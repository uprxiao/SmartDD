# DEV113 Mermaid 复用与清理

依据R3.4-P1/R06.2/R08.7/X10，接续DEV112正式220/419。保留原用例：图外修改且代码/边界相同时复用稳定id，代码/边界变化重算；ResizeObserver触发measure；destroy调用renderer返回cleanup、断开observer并删除记录，旧图不写新实例。

当前缺口：docChanged直接清掉所有items、Block.eq依全局revision，导致不相干修改重建diagram；host.diagram返回void，Block没有接返回cleanup或图表ResizeObserver。现有signal取消/迟到保护保留并补足，不删除原用例或用简单重渲染替代稳定复用。

方案：仅对原始范围/源码仍相同且CM边界未移动的mermaid保留等待重解析的装饰；新Worker窗口再次以code+from/to匹配每编辑器局部记录。记录数量随当前60块窗口裁剪，DOM销毁注销其owner和记录；每DOM仍使用DEV111独立signal，旧节点不能重新获得活动身份。图表id与原RPC任务UUID区分。host可返回幂等cleanup，Block在signal结束调用并断开图表RO；loadMarkdownDiagram返回cleanup且检查disposed/signal/connected，主题及旧回执继续按原epoch处理。

没有新增UI或产品范围。共享React原型原有相同key/source保留组件，不重写P为生产CM；本批先核对对应基线，不声称新P/V通过。U按公开控制传输验证loader生命周期，I用真实native文件/编译Worker/EditorView验证复用/重建/清理；A使用新包真实Mermaid、真实编辑/尺寸变化及原回执迟到门闩，不伪造SVG。巨长块额外滚动观察、数学lazy及其它419条仍继续。

状态：X10完整U/I/A已收口，正式进度221/419（52.74%），余198（196未执行、2阻塞），195条含App要求；整个M9仍开发中，未发布。

## 实现与代码证据

原I红测0过1失败（33未选）证明图外改字确实重建真实DOM，HTML序列化相同并不代表复用。生产保留仅raw原范围/CM边界未移动的mermaid等待新parse；每编辑器Map按from/to及code复用记录，新parse同code/边界保留对象/id，非相关全局revision不再触发renderer。记录随60块窗口裁剪，销毁时清除owner/记录；旧DOM始终捕获该次signal，返回cleanup和RO disconnect绑定同次abort。普通widget、源码映射、元数据与其他回退保持既有路径。

loadMarkdownDiagram返回幂等cleanup，同时支持signal；旧epoch、disposed、aborted或detached结果不写DOM。完成URL撤销、主题监听释放、pending原RPC取消；CodeMirror图表RO回调在连接状态下调用原requestMeasure。U7受控RPC/SVG/blob和I2真实Worker/native/EditorView（仅RO受控）分层检验。96相关代码全部通过，零失败/跳过/Unhandled；新9条U7/I2，历史并集2101不是本轮全套。首次类型检查为测试Mock可调用类型及URL static类型错误，补类型后最终通过；原生测试在打包前结束。

## 实际App与构建

r64 App8首次全通过：图外真实输入/resize保持id/blob/原renderer次数；代码变化、边界变化、移除块正确重算。真实拖动面板产生7个native RO宽度325.265625..403.265625，原callback内6次requestMeasure，未注入geometry。3个原真实SVG成功回执在改代码/关闭/切文件后原样交付，旧结果不分配blob/覆盖新selection或图像；5个实际Worker、12条diagram/cancel RPC、4个SVG blob各释放一次。所有diagram RO断开，原方法/构造器/handlers恢复，App正常退出0，进程审计关闭。两次真实保存只操作私有fixture，5份最终字节与独立预期一致。

类型、六native smoke、81运行文件包内一致通过。ASAR f0047fcf14037b0cf44ed32817f4f1b72f7bed1c7b7fd2c566c467e9484ec7d6，broker/watcher与DEV112相同。构建1077源SHA 754e27d024a7531adb15be4b83574f8851365dfb457cbd718b419bba35ddc245，实测1079源SHA 9fa3f6377e378193eda05e3479e84d60430d366773753fcb84fd357055857a2a，只增外部App驱动/原diagram RPC观察器，生产输入未再改。两份预算不变。[35项证据](../验收/证据/m9-acceptance-diagram-lifecycle-dev113-r64-20261019.json)，报告SHA e9d9564e84a876c9134227a778732d17e320da8805442d35d071cc18a8e965fe。

归档首次广泛project glob遇到原子保存staging目录而停止；改按已知5份regular fixture归档，先核对已有部分副本哈希再接续，不覆盖/删除，未把staging元数据当普通文件入库。原型源码/样式0变，沿用DEV111 P241/构建基线，未新跑P浏览器；系统/参考/其他平台、数学lazy与巨长block额外滚动观察继续待验。不发布，不操作日常AIS/旧r6/r4/凭据/Codex/剪贴板或模型。

# DEV112 Mermaid 回调和 fence 门控

依据R3.4-P1/R06.2/X09，接续DEV111正式219/419。只收口原X09的U/I/A：callback可选、双fence完整、CodeInfo首词严格为mermaid；大小写/相似词/非mermaid/未闭合保留源码。额外info按首词判断，不误当必须整串完全相同。空代码完整fence也检查callback调用/错误可读回退。

原解析器已有严格首词和completeFence判定，新增共享15场景fixture与真实parser/raw/index U。生产editor当前diagram接口必选且decorate未按callback能力过滤；无callback仍创建空/报错widget，空代码因truthy分支漏掉callback。拟改为可选host能力、无callback不替换原fence，保留既有源码显露/样式；范围内修复，不扩展产品范围或重新索取授权。

I使用真实FileService/native文件、实际编译Worker和EditorView，callback只记录原调用，不冒充Mermaid引擎成功；A用新包实际renderer解析多种图形及错误，native原RPC只观察不伪造。生产App总是提供callback，无callback前置在实际extension集成层覆盖并明确标注，不伪造App能力配置。共享原型已有固定实际renderer，不引入新的开关/UI；P模型只用于语法回归，完整视觉验收仍独立。

当前：开发/复验中，正式数仍219。X06/X08/X10及DEV111额外巨长block重复触底观察继续待验，不提前通过，不发布。

## 代码复验

原始红测16通过/3失败（29项未选）：callback缺失的非空图在toDOM调用缺失函数，空图则仍生成装饰；callback存在的空图漏调。修复diagram为可选能力、无function不装饰、空字符串也调用。随后87相关代码全部通过，零失败/跳过/Unhandled，19条新测试（U15/I4）；测试类型声明最初把parsed视为unknown，补显式结构后最终类型检查通过，生产解析器未变。原生I资源从r62包只读复用，源Worker按当前源码编译；真实图形解析仍待r63 App，不能把I记录型callback当渲染结果。

1076源r63构建快照SHA 63ddbf312875167cbd12e1322d0879af659bd23af7d88d97f572661dabc37325。原型源码和样式0改，沿用DEV111的P模型241/构建基线，不声称本轮新跑或P浏览器验收。实际App15场景已通过，正式累计220/419（52.51%），余199（197未执行、2阻塞），196条含App要求。

## 实际App与最终基线

r63实际App15组使用原sandbox Mermaid引擎；flowchart/sequence/state真实SVG与实际blob图像解码，空图的实际回执/错误和源码按钮留证。负例无diagram RPC/widget，保留高亮code或光标覆盖时的完整fence源码。首轮8过后未闭合fence的EOF光标处于code范围内，驱动误断言必须有pre/code；修正实际源码态判定，原始Worker/RPC/完整source预期未改。最终15组通过，零renderer exception，无save，原handlers/Worker恢复，正常退出0，进程审计关闭。

包六项native smoke、类型与81个运行文件包内哈希通过。ASAR1691d3d3a768e4eaca05702d969c20ee578c58aebfada4f8080d130f804d3d08；broker/watcher与DEV111相同。1076源构建SHA63ddbf312875167cbd12e1322d0879af659bd23af7d88d97f572661dabc37325，最终实测SHA3bf19616264ba72bcb590cd35621ba293cdcf1159c64009cf4f59946fdb31071，仅外部App驱动调整，生产输入未变。[69项证据](../验收/证据/m9-acceptance-mermaid-gate-dev112-r63-20261019.json)，报告SHAe3af58bd0751c21cb6a852e862de0ca3f10cb41485cd000a2e7b7a9e74c0dfb4。

19新测试U15/I4，当前87代码通过，历史并集2092不是新全套；外部CLI/PDF opt-in分别保留。缺callback只在I实际extension层覆盖，App并无切换该能力的设置。没有假SVG、替身引擎、source/Store注入、剪贴板、真实模型或Codex操作。原型源码/样式0变，沿用DEV111 P241/构建，未执行本批P浏览器。其它数学lazy/diagram稳定记录/系统/平台以及额外滚动观察继续；不发布。

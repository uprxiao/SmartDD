# DEV161 DOCX与CSV写回边界

依据M9 R3.4/R3.4-P1、J11及R06.9/R06.7/R07.18；同范围既有开发/完整测试授权，feature/0.0.1。本轮未改生产源码、UI布局、原型或依赖。

**最新接续（2026-10-20，DEV161，复用r96）：** 正式 **269/419（64.20%）**，147未执行、3阻塞，147含App。新增J11完整U/I/A：CSV/TSV局部源码编辑严格保留原bytes规则、未知编码与复杂DOCX无未实现写回；20代码（8新真实I）0skip、浅深16真实App通过，8真实保存/8只读分支、98原JSON/输入hash及重开内容独立核验。复杂DOCX原10部件保留、实际两页/修订模型正确；CSV独立字段/EOL/BOM验证，clean no-op不算写回。7原RPC/2线程/自有App清理、正常0/null；类型/新鲜82运行通过，原r96六smoke继承。生产/P/native/依赖/版本0改，1345恢复输入/4验证delta；类型适配错误及CI无runtime8skip边界见[52项证据](../验收/证据/m9-acceptance-text-writeback-dev161-r96-20261020.json)与[DEV161](DEV161_DOCX与CSV写回边界.md)。F18附件host/fallback及F20全范围仍未执行，不以源码测试代替；继续独立用例，M9未完成、未发布。

## 实际边界

DOCX通过真实OfficePages模型/原生排版，以只读预览提供复杂文件；不存在可编辑文本模型或Office工作簿写模型，入口按实际类型拒绝，源ZIP部件/锚点/作者/时间/未知XML都不变。通用native原子bytes持久化不是已经实现DOCX编辑provider的证据，未据此声称可编辑DOCX。CSV/TSV在独立只读表格中不能改值；源码EditorState则通过真实文件服务保留UTF8、BOM、引号、混合EOL与字段。UTF16/不能无损解码的旧编码保持原bytes，不静默转UTF8。

8新I与12原U共20，真实A浅深16；全部原步骤/预期不变。实际Find选Hello后插入World，独立byte oracle只替换该ASCII词、另用标准库CSV读字段；不通过全篇重输抹掉原EOL再声称保真。源码4个MetaS事件均trusted/prevented/focused；其它8个只读菜单MetaS未prevented，依据无入口/无RPC/无bytes变化证明边界，不偷换为快捷键拦截已通过。深色源码实际Save菜单4次有原native saved receipt。

首次20运行过而测试适配器drafts少Promise包装导致类型失败，修正并再验。随后将夹具读取移入测试体按需生成或显式输入，避免CI导入依赖本机临时路径；最终20/类型通过，无runtime时单独8skip仅验证收集，不计正式通过。初稿与失败日志保留，生产无改、不重复打包。

可复用脚本：scripts/files/text-writeback-fixtures.py、text-writeback-ui.mjs，I位于src/renderer/features/files/office/text-boundary-native-acceptance.test.ts。共用CDP方法已补源码局部保真与clean no-op判据。当前所有本批App/测试handle终止，无待轮询运行；r96原82运行和六smoke沿用/重核边界详见报告，安装包/正式发布未做。

F18另要求artifact unsupported fallback，缺实际附件宿主时保留未执行；F20的完整PPT预览/来源能力等不由本条替代。后续继续原419条全部范围，系统/参考V/平台等缺项照旧。

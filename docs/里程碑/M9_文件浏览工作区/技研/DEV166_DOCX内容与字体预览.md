# DEV166 DOCX内容与字体预览

依据R3.4/R3.4-P1、F19/R06.9及已有开发测试授权，复用r97。F19要求逐项记录fixture与实际渲染，不借预览证明修订交互/写回或全版式等价。生产/P/native/依赖/版本未改。

复用J11自有复杂OOXML生成三份输入：原修订、明显不存在的Latin/CJK字体、生成的无修订对照。各含2页A4、2x2表、64×32绿PNG显示144×72pt、中文/emoji、页眉页脚、批注锚点与未知XML。clean只是在夹具生成期去掉del/unwrap ins，不是App接受修订。源ZIP顺序/全部部件hash不变，不声称批注气泡/文档写回已经实现。

3新I经当前FileService/根授权、包内原Worker和nativeLibreOffice，实际PDF逐chunk校验hash。独立Poppler/stdlib比较文本、225pt列距、两页header/footer、2页A4尺寸、修订两个片段或clean无删除片段；64×32RGB全像素25/150/110、alpha全255，PDF图ppi32所以144×72pt。对另一owner及释放后预览byte请求均拒绝，activeDocuments0且native进程清理。与15原OfficePages回归共18通过0skip，类型通过。

正常App三输入×浅深6组，实际打开、100%缩放、滚页到2/2、关闭释放。12实际canvas非空，首图绿色18145像素、第二页0；实际UI读取的原PDF chunks拼接校验、再作独立解析。6源bytes/inode/mtime相同，零save/无editor/只读。30原JSON输入/输出、12V8请求/回包hash核验，6parse线程退出（主动terminate为exitCode1，不冒称线程0），8handler/Worker构造恢复；单App正常0/null，已知父PID/私有token消失。

字体差异：正常源声明Liberation Sans/Noto Sans CJK SC，PDF字体集合LiberationSans/Bold、ArialUnicodeMS、AppleColorEmoji。明显缺字体输入PDF集合改LiberationSerif/Bold、ArialUnicodeMS、AppleColorEmoji；不凭源名推断字体已安装/每glyph映射。实际看两份第一页面canvas：中文可读、页眉页脚/2×2表/绿图可见，ins为橙色下划线、del为橙色删除线，缺字体输入Latin确变serif。其它页有内容/几何/像素检查，未冒称全部逐像素人工检查。没有字体相同、MSWord/Codex像素、Show/Hide redlines/RequestEdits/修订接受拒绝或写回等价结论，相关原用例照旧。

初I15过3红因独立oracle仅按尺寸匹配到RGB图和同尺寸白alpha；按pdfimages对象type分开，精确RGB/alpha断言都保留。原helper/PDF/PPM/红日志保留，最终18过。实际A一次6全过，无失败App或延长deadline。离线auditor误用delivered而真实Office观察器是deliveredAt，修正并重验全部6原回包及6原请求；UI driver最后谓词同步由vacuous条件改为deliveredAt+hash，postrun只此断言改动，由独立审核对保存完整数据重放同条件。交互/源/产品不变，测试时driver快照留存，无必要重跑6界面动作。

1360父输入+guide/3新验证文件为1363恢复输入/4delta。82实际out/ASAR新鲜比较及原r97六smoke继承；无新构建/原型/安装包。公共CDP流程补PDF原字节参照、alpha区分与字体差异记录。

[142项证据](../验收/证据/m9-acceptance-docx-preview-dev166-r97-20261020.json)，SHA `d2a7ebcb38e65e291fe968676408b94f0e91736733fea9d4158fd3209c4184a0`。仅F19推进274/419（65.39%），142未执行/3阻塞。T19原生raw0缺项保持，其他附件宿主/参考V/系统人工/平台和原范围继续，未完成M9、未发布。

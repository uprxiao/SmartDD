from pathlib import Path
import json
r=Path.cwd();s=r/'docs/里程碑/M9_文件浏览工作区';name='m9-acceptance-pdf-safety-dev135-r79-20261019.json';report=s/'验收/证据'/name;data=json.loads(report.read_text());n=len(data['artifacts'])+2;assert n==73
p=s/'验收/用例覆盖索引.json';d=json.loads(p.read_text());before=json.loads((Path('/private/tmp/willyou-dev135-before')/p.relative_to(r)).read_text());assert d==before
actual={
'M9-T-Y15':'DEV135，R3.4/P1原P/I/A、步骤及预期不变。完整共享原型与正常r79分别浅深12项密码检查通过：缺失提示无页面内容；取消后等待真实销毁仍为需要密码/可重试而非通用错误；重试新框、连续两次错密不泄漏、正确密码实际canvas像素/text渲染且框消失；重开仍需密码，错密重试中关闭无残框。P28原生浏览器Worker创建/销毁计数相等、active0；P web storage及Electron日志无输入密码，公开示例密码本身存在原型源码，不把代码缓存当真实输入持久化。最终A正常退出后逐字节扫描自有userData50个普通文件及App日志，两个合成密码均无匹配；不证明内存或其他目录。5条真实native资源/原生产校验reader/真实PDF.js legacy解析I（其Node fake-worker不冒充浏览器Worker）及20U共25通过，原型模型9、最终构建和类型通过。修复P动态workerURL命名空间非字符串，以及提交时旧密码框/回调仍可重复使用；P4超时同时暴露驱动未等待新提示，不据此声称所有正确密码均失败。生产原已清提示且未改，复用r79六smoke/哈希并新核对82运行文件。最终P/A两次正常退出0/null、自有实例全闭；四源inode/mtime/ctime/hash不变，无任务/模型/系统剪贴板/外部App启动。1229源由已存基准及本批9文件增量恢复，失败和层级边界见证据。正式247/419（58.95%），平台/系统IME/参考及其余用例仍未完成，未发布。',
'M9-T-Y16':'DEV135，R3.4/P1原P/I/A、步骤及预期不变。真实共享原型及正常r79各浅深6项：原截断PDF、%PDF-开头随机字节、纯文本改名PDF，实际引擎均明确不是有效PDF或已损坏；无文本/成功画布、可真实重试，文件字节及inode/mtime/ctime全不变；标题区主打开按钮可用且打开方式菜单有已解析应用项，仅查看不启动OS应用。实际A首次错误219–222ms、P129–143ms，有限等待符合原边界，不另立性能预算。密码错误状态由Y15实际覆盖，损坏/密码/读取/Worker/超时分类有独立受控U；5条真实native资源/生产校验reader/真实PDF解析I与20U共25通过，P模型9、最终P构建、类型通过。I内fetch仅把本次可信grant交原资源handler，原Swift真实数据及hash不替换；Node legacy fake-worker只记I，实际浏览器Worker另由P/A。首次A读到菜单加载占位导致驱动断言失败，改等待真实应用名称元素，不硬编码默认应用品牌，原可用入口要求保留。原型Worker URL导入修复及每文件合成来源显式映射不改App生产输入，复用r79六smoke并新核对82运行与哈希。最终P/A两次正常退出、自有实例全闭；1229可恢复源、原失败/层级限制与证据归档。正式247/419（58.95%），其他PDF/平台/IME/参考未据此通过，未发布。'}
for cid,text in actual.items():
 c=next(c for c in d['cases'] if c['id']==cid);assert c['status']=='未执行';c.update(status='通过',actual_result=text,evidence=['证据/'+name],defects=[])
c=next(c for c in d['cases'] if c['id']=='M9-T-F15');assert c['status']=='通过';c['evidence'].append('证据/'+name);c['actual_result']+=' DEV135补充r79密码/三类损坏实际App浅深18检查及5条真实源/解析I通过，自有50文件与日志无合成密码；本批未重跑字体/表单/旋转矩阵，原DEV067范围及限制保留，不重复增加通过数。'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
brief=f'**最新接续（2026-10-19，DEV135 r79复用）：** 正式 **247/419（58.95%）**，余172（170未执行、2阻塞），169含App。Y15/Y16完整P/I/A通过：25代码（5真实native/解析I、20U）、9原型模型、P18及正常App18浅深检查；取消/反复错密/正确解密/关闭与三类损坏错误、重试和打开方式入口均核对。自有userData50文件及App日志无合成密码。修复原型Worker地址及旧密码提示待响应状态，生产不变；r79原六smoke/哈希复用，新核对82运行。两次最终P/A正常退出，自有8实例全闭。[{n}项证据](验收/证据/{name})与[DEV135](技研/DEV135_PDF密码与损坏输入.md)保留Node fake-worker、公开示例密码源码及驱动失败边界。接续PDF真实链接/大纲与超大页等剩余用例；系统/人工/平台/参考限制保留，未发布。'
for rel in ['README.md','实施计划与进度.md','交付说明.md']:
 p=s/rel;t=p.read_text();needle='**最新接续（2026-10-19，DEV134 r79）：**';assert needle in t;t=t.replace(needle,brief+'\n\n**前批接续（2026-10-19，DEV134 r79，历史）：**',1)
 if rel=='README.md':t=t.replace('已结案Y20/Y22，接续其余未完成用例','已结案Y20/Y22；[DEV135](技研/DEV135_PDF密码与损坏输入.md)已结案Y15/Y16，接续其余未完成用例',1)
 if rel=='实施计划与进度.md':t=t.replace('正式累计245/419（58.47%），余174（172未执行、2阻塞）','正式累计247/419（58.95%），余172（170未执行、2阻塞）',1).replace('当前批次以上方DEV134为准，当前r79；最近完整新增Y20/Y22','当前批次以上方DEV135为准，当前r79复用；最近完整新增Y15/Y16',1)
 p.write_text(t)
for rel in ['docs/需求池.md','docs/里程碑/README.md']:
 p=r/rel;t=p.read_text();assert '当前245/419完整通过（58.47%）' in t;p.write_text(t.replace('当前245/419完整通过（58.47%）','当前247/419完整通过（58.95%）',1))
(s/'技研/DEV135_PDF密码与损坏输入.md').write_text(f'''# DEV135 PDF密码与损坏输入

依据R3.4/R3.4-P1，Y15/Y16原P/I/A完整通过。正式247/419（58.95%），170未执行、2阻塞。生产/native/依赖不变，复用r79，未发布。

## 结果与层级

| 层级 | 已执行与边界 |
| --- | --- |
| I5/U20 | 原生产FileService、实际Swift、可信grant/原资源handler/校验reader与真实PDF.js legacy：三类损坏、两次错密后正确、密码等待取消五条；另1条受控错误分类U、6模型U、13预览传输U，共25。I的fetch只转发原minted URL，不换字节；Node PDF.js使用fake-worker，不冒称浏览器Worker |
| P18 | 完整共享FileWorkspace的真实树打开四个显式合成来源，原PDF.js/浏览器Worker。浅深密码12项、损坏6项，28个Worker均销毁；P合成数据不证明native文件IO |
| A18 | 正常r79，真实原生文件/鉴权资源/浏览器PDF Worker和可信键鼠；密码12项、损坏6项。四源inode/mtime/ctime/hash不变，真实画布有墨迹/文本，错误状态无内容；主打开按钮与加载完成的实际应用菜单可用，仅看入口不启动应用 |
| 检查 | 9原型模型、最终原型完整build、类型通过；同r79包三hash/原六smoke复用，新增82运行文件比较。最终P/A各正常退出0/null，自有8实例无残留，失败/诊断仅cleanup |

缺失密码无文本/画布；取消后等待真实销毁仍显示需要密码及重试；两次错误提示不泄漏内容；正确密码关闭提示并渲染真实页，重开仍要密码，错密重试时关闭无残框。三损坏分别为原截断、带%PDF-的随机字节、纯文本改名。实际A首次错误219–222ms、P129–143ms，满足原有限等待，不把它当新性能预算。

最终A正常退出后，扫描自有userData50个普通文件和App日志，两个合成密码均无匹配；P核对应用web storage及Electron日志，不对进程内存/其他目录作结论。原型源码公开写有固定示例密码，不能把合法缓存的公开源码文字当作真实输入持久化，也不声称扫描其全部代码缓存。P与A各查看浅色正确解密及深色纯文本假PDF两张图，页面文字/错误可读；不宣称Codex全像素一致。

## 修复与失败保留

原型动态import Worker的?url拿到非字符串default，直接引擎诊断捕获Invalid workerSrc type。改为静态导入小型URL字符串，PDF.js解析引擎仍按需；最终P实际Worker和build通过。每文件显式pdfSource传给既有预览hostOptions，使合成encrypted/truncated/garbage/plain与树标签一一对应，新增P夹具页不新增产品业务页面或样式。

P密码提交保留旧框/回调，快速重复可交旧update；现在提交期间清框，等待真实新提示。P4正确密码等待超时同时涉及驱动未等待新提示，不单凭它宣称所有正确密码都会失败。驱动增加旧DOM提示身份变化等待，不修改密码值/实际结果；生产原已清框且未改。初P选择器转义、原生select不改值、测试最初放主进程目录导致类型路径错误均保留；没有把select工具限制当产品键盘缺陷。首A看到应用菜单加载占位，随后真实菜单已显示应用；最终等名称元素完成，不按Preview等默认品牌硬判，也未降低入口可用要求。

[{n}项证据](../验收/证据/{name})保存失败、原三份P源码、1229源基准/增量、真实输入和扫描结果；早期驱动中间版本没有独立快照，不补造哈希。P完整成功后，外部驱动仅补A分支菜单等待及移除未使用常量，P源码/路径不变，未重复整组P。共用方法补[自动验收流程](../../../真实App自动验收流程.md)。

其他PDF链接/大纲、超大页、Worker取消/崩溃、Office、拖放及系统/人工/平台/参考缺项仍需按原范围执行，未预填通过。
''')
p=s/'验收/执行与缺陷记录.md';p.write_text(p.read_text()+f'\n\n## DEV135 · Y15/Y16 PDF密码与损坏输入（2026-10-19）\n\n正式247/419（58.95%），170未执行、2阻塞。[DEV135](../技研/DEV135_PDF密码与损坏输入.md)及[{n}项证据](证据/{name})记录完整P18/A18、5真实I/20U、P模型9、构建与类型通过；P/A各正常退出，自有8实例全闭。原型Worker URL与待响应旧密码框修复，生产未变，复用r79六smoke并新比较82运行。A自有50文件及日志无合成密码；Node fake-worker/P公开示例密码缓存边界、驱动与类型失败均保留。仅Y15/Y16新增整条通过，F15补证不重复计数，未发布。\n')
p=s/'原型/原型说明与变更.md';p.write_text(p.read_text()+f'\n\n## DEV135 · Y15/Y16原型一致性（2026-10-19）\n\nR3.4/P1已确认范围缺陷修复：file-pdf-engine.mjs静态导入Worker URL，解析引擎继续lazy；FilePdfPreview.jsx提交密码时先清旧框、等待新提示，场景控件补纯文本假PDF；FileWorkspace.jsx向PDF预览传每文件显式pdfSource，仅控制合成文件对应来源。原页面/布局/样式未增，既有未设来源文件仍用normal。新增tests/pdf-safety-runtime.html/harness与合成plain.pdf为P验收夹具，树真实打开四源、可信密码/取消/重试/菜单操作，浅深18项、9模型及最终build通过，28Worker清理。修前源码、基准/增量与证据见[DEV135报告](../验收/证据/{name})；P不替代native、系统IME或全部Codex视觉证据。\n')
print('Y15/Y16 complete;247/419;'+str(n)+' artifacts after final audit')

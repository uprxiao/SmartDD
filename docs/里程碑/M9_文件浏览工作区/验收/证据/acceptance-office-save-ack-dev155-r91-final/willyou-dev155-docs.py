from pathlib import Path
import json,hashlib
repo=Path.cwd();base=repo/'docs/里程碑/M9_文件浏览工作区';name='m9-acceptance-office-save-ack-dev155-r91-20261020.json';report=base/'验收/证据'/name;sha=hashlib.sha256(report.read_bytes()).hexdigest();assert sha=='75d14e47ea75d20cbf290715769f9d6f6cdd8e2b8753d3d5a1dd2319374eeb89'
p=base/'验收/用例覆盖索引.json';d=json.loads(p.read_text());before=json.load(open('/private/tmp/willyou-dev155-cases-before.json'));c=next(c for c in d['cases']if c['id']=='M9-T-W27');assert c['status']=='未执行';c['status']='通过';c['evidence'].append('证据/'+name);c['defects'].append('DEV155-OBS01（PPTX焦点内保存快捷键缺失，r91已修复复验）');c['actual_result']='DEV155完整U/I/A：修复PPTX页面在textarea/input入口提前return导致Meta/CtrlS无直接保存的问题，保持焦点并调用既有buffer.save，组合/重复/修饰键/菜单/只读条件保留。严格红测4失败1guard通过（18未选）及旧r90真实App无保存/按键未处理留证，最终96代码（7新）全选0skip。2真实native/包内Worker回执I覆盖V1一次保存、flush/timer3500不重写、原生实际已保存V1后只延迟原回执、期间V2输入，旧ack不清V2且采用真实baseHash，最终V2落盘、共3次写入。r91正常App浅深×XLSX公式栏/PPT对象文本4组，12trusted原按键保持焦点并被处理，V1回执后ExcelEnter/PPTblur仍clean且不重复write；4旧原成功回执返回时V2仍dirty、焦点/样式保持、磁盘仍V1，再保存/重开V2正确。独立ZIP/XML核对公式/格式/对象/notes及无关部件，允许实际重算的普通/共享/数组缓存；4坏数据控制可检出，额外3源只读calcPr/14缓存核对通过。72原V8回执字节hash独立校验一致，11RPC/观察监听恢复、8Office线程退出，7自有App及4采样PID均退出、最终正常0/null。新r91六smoke/82运行hash/类型通过；1326输入构建前全量快照+7文件delta可恢复。原型无新P/V、W28/J02/J09/J10未冒算通过；驱动等待、Inspector观察与初读取器错误留证，生产仅本保存键处理改变。';c['prototype_status']='沿用P12/P13既有合成入口，本轮无原型代码/视觉变化';c['prototype_note']='根原型有Meta/CtrlS入口；本轮只按约定U/I/A完成真实Office回执和快捷键，不宣称重新完成P/V或专有格式像素一致。'
allowed={'status','evidence','actual_result','defects','prototype_status','prototype_note'}
for a,b in zip(before['cases'],d['cases']):assert all(b.get(k)==v for k,v in a.items()if k not in allowed),(a['id'],'reviewed contract changed')
current=[c for c in d['cases']if c['scope']!='future-remote'];assert len(current)==419;assert sum(c['status']=='通过'for c in current)==263;assert sum(c['status']=='未执行'for c in current)==153;assert sum(c['status']=='阻塞'for c in current)==3;p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
para='**最新接续（2026-10-20，DEV155 r91）：** 正式 **263/419（62.77%）**，153未执行、3阻塞，153含App。新增W27完整U/I/A：修复DEV155-OBS01，PPT文本/备注获得焦点时Meta/CtrlS漏保存；严格红测及旧r90实机红保留，新r91真实焦点保存正常。96代码（7新）、浅深×XLSX公式/PPT正文App4组、新六smoke/82运行/类型通过；12实际按键/保存、4旧原成功回执、72原V8字节校验，V2及样式不被旧ack清除，Enter/blur不重写，最终落盘重开正确。8Office线程/7自有App/4采样PID清理、最终正常0/null。独立保真读回/4控制/3原始计算metadata与14缓存核对；1326构建前输入快照+7文件delta，[118项证据](验收/证据/'+name+')及[DEV155](技研/DEV155_焦点保存与旧回执.md)保留全部驱动/读取器/Inspector观察错误，观察异常具体触发未完全定性，不当成生产失败。生产仅PPT保存键改变，P/native/依赖/版本无变；共用CDP方法同步。W28/J02/J09/J10及系统/参考/平台矩阵继续；阶段未完成、未发布。'
for file in ['README.md','实施计划与进度.md','交付说明.md']:
 p=base/file;s=p.read_text().replace('**最新接续（2026-10-20，DEV154，复用r90）：**','**前批接续（2026-10-20，DEV154，复用r90，历史）：**',1);pos=s.index('\n\n');p.write_text(s[:pos+2]+para+'\n\n'+s[pos+2:])
for file in ['验收/执行与缺陷记录.md','原型/原型说明与变更.md']:
 p=base/file;s=p.read_text().replace('**最新接续（2026-10-20，DEV154，复用r90）：**','**前批接续（2026-10-20，DEV154，复用r90，历史）：**',1);pos=s.index('\n\n');note=para.replace('(验收/证据/','(../验收/证据/').replace('(技研/','(../技研/');p.write_text(s[:pos+2]+note+'\n\n'+s[pos+2:])
tech='''# DEV155 焦点内保存、相同快照与旧成功回执

依据R3.4/R3.4-P1、M9-T-W27及R07.11/R07.12，2026-10-20；feature/0.0.1、HEAD89de9af4b631abdef5673ce8949fb02a32f6fcad加工作区。W27由未执行转通过，263/419（62.77%），153未执行、3阻塞；未完成、未发布。

## 生产缺陷与实现

DEV155-OBS01：PPTX页面keydown先排除input/textarea，未处理保存键；文本与notes焦点内Meta/CtrlS没有直接调用保存。旧组件严格4红/1guard绿及旧r90真实PPTX无save、按键未prevent证据留存。当前把无额外修饰的单primary S放在编辑器排除前，调用原buffer.save并prevent/stop、不blur；组合、repeat、双primary、Alt/Shift及菜单/dialog/embed边界仍拒绝，业务可写条件仍由buffer判断。仅这一生产函数改变，原保存/Worker/native模型未改。

共享原型根keys已有Meta/CtrlS示例入口，本轮核对其源码；无UI控件/布局或原型代码变更，无新P/V结果。真实Office不是合成原型保存回调；W27约定U/I/A，本轮按此完成。PPT正文Enter仍是换行，本用例按ExcelEnter提交／PPT失焦的适用语义检查。

## 当前验证

| 层 | 结果与证据边界 |
| --- | --- |
| U/I | 96全过0skip（88主体+8页面导航/布局，互异），7新＝5焦点键组件＋2真实native回执。组件立即观察原buffer.save，不让500msnotes自动保存冒充快捷键；含object/notes×Meta/Ctrl、组合/只读/重复/修饰guard。原有buffer/React/native回归89个不计新正式用例 |
| Native I | r91原Worker＋真实FileService/FileBuffer/native，XLSX/PPTX各1：V1只写一次、重复flush/3500ms仍clean；原已保存V1回执只延迟返回，输入V2后旧ack不清pending、baseHash采用实际receipt；显式V2落盘后flush/timer仍clean、每格式3次write。无计算engine时真实cached fallback，未编造成功/模型回执 |
| A | 正常r91浅深×XLSX公式栏/PPT真实shape正文4组，12原trusted MetaS且前后焦点保持。V1回执后Enter/blurclean且不写第二次；4原生已落盘的V1回执挂起，原控件输入V2，释放原回执后V2仍dirty/焦点/样式稳定、盘仍V1，再保存并重开V2。每组3真实native保存，共12 |
| 独立字节与源校验 | 72原handler输出保留V8字节，独立以r91Node解码和SHA256核对before/after；4门闩只改投递时间。ZIP/XML验证PPT目标格式、其他对象/notes/无关parts，XLSX公式/非目标值/样式/名称/结构不变。实际POI重算可填充其他sheet普通/共享/数组缓存；只归一化目标及计算缓存，4受控错误（公式/样式/非目标常量/名称）均可检出。额外3源只读audit保留非衍生calcPr属性、核对14真实缓存，dev/inode/hash/times不变 |
| 清理与构建 | 11原RPC和被动按键监听、原watch帧恢复，8保留Office线程退出，零renderer异常，最终正常App0/null。7自有App父PID及project/userData token消失，4实时采样PID/starttime也消失；不声称采样覆盖全部瞬态Java/LO/native子进程。新r91原配置build/afterPack/6smoke与82包内JS/CSS/HTML逐hash匹配、类型通过，仍0.0.5/macOS arm64应用目录，未发安装器/发布 |

## 校验修正与历史

- 第一轮旧组件2红/3绿被notes500ms自动保存掩盖，不能证明notes保存键；加强立即spy后严格4红，1guard通过、18为过滤未选；最终96全选0skip。组件合成IME不证明系统候选。
- 首native I的PPT目标选择错用kind=text；真实导入shape也能有正文，改按生产支持的text-bearing对象选择。初38绿/1夹具红、最终2真实I都留存，未改生产模型。
- 首r91实际XLSX已保存，但校验器错要求sheet2原字节不变；实际变化仅重算缓存。现严格比较公式/非目标内容/格式，允许已识别普通/共享/array缓存；保留原失败，并用4反例及独立原始metadata/缓存核对约束归一化。
- 一个r91观察期10s早于PPT共享原生排版队列后的saveRPC，不能判快捷键失败；原checkpoint/edit链及按键已处理都留证，改90s观察但不动生产预算。快捷键处理、RPC排队、最终落盘三者分别观察。
- 两个r91实例遇Inspector通用观察错误；底座文字为Credential audit，属于通用错误文案，本轮只观察自有App测试状态，不是用户审批拒绝。具体触发未完全定性。改轻量JSON轮询、100ms间隔、明确内部错误信息，完整原生payload只最终取V8字节；最终完整4组及72原字节通过，不用改业务回执/Store来绕过。
- 首旧r90驱动之后修正了尚未执行的readonly reopen分支；不冒称保存了首次red完整驱动快照。其失败分支和原App/原代码红证据真实保留，后续驱动版本/构建前/最终delta可恢复。按键被动记录最终prevented在事件传播后读取，不改变原事件；trusted不是物理键盘/系统IME证据。

## 恢复与下一步

1326工程输入＝1322parent＋4新；构建前全量归档，最终7文件delta（生产页面、对应测试、共用CDP文档＋4验证文件）。构建后仅外部测试驱动/观察器/读取器与文档改，生产/native/依赖/配置逐hash不变。新入口为[ACK观察器](../../../../scripts/lib/office-ack-observer.mjs)、[App驱动](../../../../scripts/files/office-save-ack-ui.mjs)、[独立源读取器](../../../../scripts/files/verify-office-ack.py)及[真实native回执测试](../../../../src/renderer/features/files/office/save-ack-native-acceptance.test.ts)。

[权威报告](../验收/证据/REPORT) SHA256 `HASH_VALUE`，118项带hash证据保留7App/所有红绿/控制/真实基线及4最终OOXML/原回执字节/构建与恢复链。[共用CDP流程](../../../真实App自动验收流程.md)补焦点键与自动保存区分、旧原回执门闩、轻量轮询及计算缓存保真核对。只新增W27通过；W28关闭/失败/冲突/只读完整矩阵、J02/J09/J10等以及系统/参考/平台限制继续，不因本轮部分覆盖而改其状态。
'''.replace('REPORT',name).replace('HASH_VALUE',sha)
(base/'技研/DEV155_焦点保存与旧回执.md').write_text(tech)
for file in ['docs/需求池.md','docs/里程碑/README.md']:
 p=repo/file;s=p.read_text();old='当前262/419完整通过（62.53%），DEV154 J04完整U/I/A、53代码/实机浅深4及独立读回5通过，复用r90并核对82运行/73父证据；154未执行、3阻塞，其他独立测试继续；';new='当前263/419完整通过（62.77%），DEV155修PPT焦点内保存键并完成W27完整U/I/A，96代码/实机浅深4、新r91六smoke/82运行通过；153未执行、3阻塞，其他独立测试继续；';assert old in s;s=s.replace(old,new,1);p.write_text(s)
print({'formal':263,'current':419,'unexecuted':153,'blocked':3,'reportSha256':sha})

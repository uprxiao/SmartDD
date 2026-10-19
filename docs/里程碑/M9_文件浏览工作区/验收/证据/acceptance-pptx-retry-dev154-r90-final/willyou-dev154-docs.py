from pathlib import Path
import json,hashlib
repo=Path.cwd();base=repo/'docs/里程碑/M9_文件浏览工作区';name='m9-acceptance-pptx-retry-dev154-r90-20261020.json';report=base/'验收/证据'/name;sha=hashlib.sha256(report.read_bytes()).hexdigest();assert sha=='0674855ef390bbb02147c5f428e1540a4b69b062d658d3823dae717108e965b3'
p=base/'验收/用例覆盖索引.json';d=json.loads(p.read_text());before=json.load(open('/private/tmp/willyou-dev154-cases-before.json'));case=next(c for c in d['cases']if c['id']=='M9-T-J04');assert case['status']=='未执行';case['status']='通过';case['evidence'].append('证据/'+name);case['actual_result']='DEV154完整U/I/A：53代码（2新真实native I+51回归）全部启用0skip；r90正常App浅深4组通过。原鉴权/回执不替换，单次原保存调用期间对临时父目录0555制造真实Permission denied，恢复0755。首次失败仍dirty且原源不变，继续输入较新notes有真实checkpoint，冻结自动写但不停止恢复草稿；关闭触发真实失败保存队列后拦截并显示未保存提示，显式保存重试落盘最新notes，关闭/重开正确。非法图表raw1,可恢复，flush失败且无源write、关闭被阻止；修正15,27保存并关闭。后续schedule按R07.11继续恢复及显式保存/关闭save重试，不冒称打字后自动无限重试。8实际save调用中4真失败+4成功；6PPTX线程退出、7RPC及watch原帧恢复、零renderer异常、正常App0/null。独立ZIP/XML沿活动slide/chart关系核对新部件，另5份基线/最终包的嵌入工作簿值与缓存相同，原文件dev/inode/hash/时间不变；其余原部件按补丁闭包保持。前夹具chmod源改变ctime触发正确版本拒绝、10/20s驱动等候不足、误读孤立chart1及绝对OPC关系读取器问题均留红并修正后复验；非产品源码修复。当前82运行hash与r90六smoke/73父证据复核，1322输入=1318parent+4新及1共用CDP文档修改。原J04步骤/预期/层级不变，J02/J10/W27/W28未冒算通过。';case['prototype_status']='沿用P13/P09；本轮无界面或原型改动';case['prototype_note']='J04约定U/I/A已验，P源码/UI未变，未做新P/V，不据此声明视觉一致。'
allowed={'status','evidence','actual_result','defects','prototype_status','prototype_note'}
for a,b in zip(before['cases'],d['cases']):assert all(b.get(k)==v for k,v in a.items()if k not in allowed),(a['id'],'reviewed contract changed')
current=[c for c in d['cases']if c['scope']!='future-remote'];assert len(current)==419;assert sum(c['status']=='通过'for c in current)==262;assert sum(c['status']=='未执行'for c in current)==154;assert sum(c['status']=='阻塞'for c in current)==3;p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
para='**最新接续（2026-10-20，DEV154，复用r90）：** 正式 **262/419（62.53%）**，154未执行、3阻塞，154含App。新增J04完整U/I/A：53代码（2新）及r90正常App浅深4组通过，真实父目录写入拒绝后继续编辑/保留草稿、失败关闭拦截、显式重试/重开最新notes；非法图表flush阻止关闭、修正保存通过。6PPTX线程/4自有App全闭、目录均恢复0755，5份独立活动图表/嵌入工作簿读回一致且身份/时间不变；原始化错误、驱动观察期不足与读取器错误均保留并纠正，不归为生产缺陷。生产/P/native/依赖/版本0改，1322输入/5文件delta，82运行核对及r90原六smoke/73父证据复核通过。[65项证据](验收/证据/'+name+')与[DEV154](技研/DEV154_PPTX失败重试与关闭保护.md)记录真实串行排版耗时和边界；共用CDP流程补故障恢复与活动关系读取方法。J02/J10/W27/W28及系统/参考/平台等未完成项继续；阶段未完成、未发布。'
for file in ['README.md','实施计划与进度.md','交付说明.md']:
 p=base/file;s=p.read_text().replace('**最新接续（2026-10-19，DEV153 r90）：**','**前批接续（2026-10-19，DEV153 r90，历史）：**',1);pos=s.index('\n\n');s=s[:pos+2]+para+'\n\n'+s[pos+2:];p.write_text(s)
for file in ['验收/执行与缺陷记录.md','原型/原型说明与变更.md']:
 p=base/file;s=p.read_text().replace('**最新接续（2026-10-19，DEV153 r90）：**','**前批接续（2026-10-19，DEV153 r90，历史）：**',1);pos=s.index('\n\n');note=para.replace('(验收/证据/','(../验收/证据/').replace('(技研/','(../技研/');s=s[:pos+2]+note+'\n\n'+s[pos+2:];p.write_text(s)
tech='''# DEV154 PPTX 写入失败、重试与关闭保护

依据R3.4/R3.4-P1、M9-T-J04、R07.11/R07.9，2026-10-20。feature/0.0.1，HEAD89de9af4b631abdef5673ce8949fb02a32f6fcad加已恢复工作区。J04由未执行转通过：262/419（62.53%），154未执行、3阻塞；未完成、未发布。

## 当前验证

| 层 | 实际验证 |
| --- | --- |
| U/I | 53全过0skip：19PptxBuffer、6草稿、23实际Worker/服务＋内存持久化适配、2真实native保存幂等、1真实串行保存以及2新FileBuffer/PptxBuffer/完整FileService/r90Worker/native写入故障。共2新、51回归，不把51回归算新正式用例 |
| A | 正常r90浅深各两流程，共4组；原鉴权及原消息不改。写失败→新notes真实checkpoint→冻结自动write→关闭重试真实失败并拦截→显式保存最新→正常关闭并重开；非法图表1,→原始输入草稿、flush失败且0write/关闭拦截→15,27修正保存关闭 |
| 独立读取 | 只读ZIP/XML先沿活动幻灯片chart r:id读实际图表缓存；再用独立系统Python脚本对1原基线和4最终PPTX沿chart externalData到工作簿指定sheet/range比较缓存与嵌入数值，5份都相同。读取前后dev/inode/hash/size/mtime/ctime不变；notes只改目标部件，chart复制部件再切引用，其余原部件按明确闭包全hash保留 |
| 清理 | 8原save调用（4真Permission denied/4成功）、4故障源hash不变、目录模式每次0555→0755；6保留PPTX Worker线程退出，7原RPC和原watch帧恢复，零renderer异常，最终App正常0/null。4自有App已知PID及临时project/userData token都不存在，所有目录0755 |
| 包边界 | 生产/P/native/依赖/配置/版本均未变，沿用r90/0.0.5/macOS arm64；当前82运行JS/CSS/HTML与包内逐hash一致，重新验证DEV153报告73项hash及App/native。沿用原6smoke，不声称重新打包/新P/V或其他平台通过 |

R07.11规定失败冻结自动写入。后续schedule保持恢复checkpoint，用户显式保存或关闭时save触发新串行重试；新输入不会抹去失败或偷偷无限重写。本条不宣称仅打字就解冻自动写，原用例步骤/预期不改。

## 校验过程中的错误与纠正

1. 最初新native夹具chmod源文件使ctime改变，得到正确的版本/身份拒绝，而非所需IO写失败；还存在新closeDocument适配未返回Promise和当前draft.pending为数组的夹具断言错误。初次19绿/2红保留。改为临时父目录0555，原文件版本未变，native返回真实`create volume transaction: Permission denied`。当前53全过。
2. 首App20s观察期结束时，实际排版/table-layout占用共享native作业队列，原保存调用尚在途，不能当已失败或已通过。进程清理使原handler finally未完成，额外恢复自有目录0755留证；新观察器在异常清理先恢复在途fault目录。
3. 次App首个真实写失败通过，随后关闭保护10s观察期不足；等待改为90s但仍须原真实回执和dialog状态，未改生产timeout或队列。实际保存/关闭常需约20–30s排版队列，本轮未做性能合格声明。
4. 第三App一组完整write通过，chart修正实际已保存并clean，但读取器错读被保真的孤立chart1.xml/旧3,4。只读复核活动引用rIdWillYouChart1到willyou-chart-1.xml是15,27。改读取器沿引用，原部件仍保留；重新跑完整浅深4组后才通过，不仅把旧failed结果改写绿。
5. 后置独立嵌入工作簿读取器最初把`/xl/...` OPC包绝对关系拼为xl/xl；红读回留存，修正包根路径解析，系统Python最终5份核对通过。仅校验器变更，未动源数据或App。

## 工程与证据

1322恢复输入＝DEV153的1318＋4新测试源码；父输入仅共用CDP流程改变，最终delta5文件，生产输入逐hash不变。新增[`office-save-observer.mjs`](../../../../scripts/lib/office-save-observer.mjs)、[`pptx-retry-ui.mjs`](../../../../scripts/files/pptx-retry-ui.mjs)、[`verify-pptx-retry.py`](../../../../scripts/files/verify-pptx-retry.py)、[`pptx-retry-native-acceptance.test.ts`](../../../../src/renderer/features/files/office/pptx-retry-native-acceptance.test.ts)。工程恢复链、红/绿原始日志/截图/完整RPC及Worker、原基线与4最终PPTX、只读读回和进程/权限审计归档于[权威报告](../验收/证据/REPORT)。报告SHA256 `SHA`。

共用[CDP流程](../../../真实App自动验收流程.md)补充了父目录IO故障的版本/清理边界、排版队列状态等待与活动关系读取，可供后续阶段复用。本轮无新UI/P变更，J04不约定P/V；不把无原型改动说成重新完成视觉验收。J02基线、J10全部XLSX关闭阶段、W27/W28活动输入/旧回执矩阵未完成，原419+6范围不变，继续独立工作。
'''.replace('REPORT',name).replace('`SHA`','`'+sha+'`')
(base/'技研/DEV154_PPTX失败重试与关闭保护.md').write_text(tech)
for file in ['docs/需求池.md','docs/里程碑/README.md']:
 p=repo/file;s=p.read_text();old='当前261/419完整通过（62.29%），DEV153 C09完整P/I/A及116代码，新r90六smoke/82运行核对，C13/C14实机回归5通过；155未执行、3阻塞，其他独立测试继续；';new='当前262/419完整通过（62.53%），DEV154 J04完整U/I/A、53代码/实机浅深4及独立读回5通过，复用r90并核对82运行/73父证据；154未执行、3阻塞，其他独立测试继续；';assert old in s;s=s.replace(old,new,1);p.write_text(s)
print({'formal':262,'current':419,'unexecuted':154,'blocked':3,'reportSha256':sha})

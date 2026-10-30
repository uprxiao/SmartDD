from pathlib import Path
import hashlib,json
base=Path('docs/里程碑/M9_文件浏览工作区');name='m9-acceptance-xlsx-close-dev157-r94-20261020.json';report=base/'验收/证据'/name;assert hashlib.sha256(report.read_bytes()).hexdigest()=='180957801e13dbfe26634bcfc7d357216f39b0d2acb47608df50bc0275756fad'
p=base/'验收/用例覆盖索引.json';d=json.loads(p.read_text());before=json.load(open('/private/tmp/willyou-dev157-cases-before.json'));assert d==before;c=next(x for x in d['cases']if x['id']=='M9-T-J10');assert c['status']=='未执行';c['status']='通过';c['evidence'].append('证据/'+name);c['defects'].append('DEV157-OBS01（clean模型在途编辑未排空即关闭，r94已修复复验）')
c['actual_result']='DEV157完整U/I/A：修复工作区只按dirty/recovery决定prepareClose，导致已接受模型仍clean、真实格式编辑在途时直接dispose的问题。Office关闭总经既有prepareClose；序列操作从入队到finally计数，关闭等待所有在途/排队操作，再保存或阻止；当前操作拒绝显示原saveError并保留编辑视图，clean只读零write可关闭。原U2红/1只读控制绿及r93真实格式回执挂起时标签被关闭红测保留；最终111代码（10新＝3U+7真实native I）0skip。正常r94浅深各7场景共14：checkpoint/drain、edit/append、save/materialize分别成功/失败，另clean格式在途；原回执挂起期间关闭保留标签/Worker，失败继续查看、解除故障、显式聚焦/重试后关闭重开最新值/格式。6失败分支源字节保持原版，checkpoint实际恢复root权限约束、非法公式原验证失败、实际父目录写拒绝均记录真实边界。独立174原V8返回/错误（6原错误）、14门闩及逐保存→关闭时序、最终源hash/无关ZIP部件核验通过；28Office线程退出，9原RPC和被动watch恢复，3自有App父PID/私有目录token消失及模式恢复，最终正常0/null。新r94六smoke/82运行/类型通过，1335构建前输入+8文件delta可恢复。首新包驱动未等待返回编辑器焦点，保存重试观察超时，原返回及末态focusTrue不足以证明按键时目标；加真实click/focus等待后完整14过，未改生产或延长超时。J02/W28全范围及其他平台/系统/参考V仍未完成。'
c['prototype_status']='沿用P12/P09既有文件关闭对话框，本轮无原型或布局变化';c['prototype_note']='本条约定U/I/A，验证本机文件标签关闭、所需Worker排空与原生持久化；不外推W28多输入宿主、窗口/任务关闭或完整V。'
allowed={'status','evidence','actual_result','defects','prototype_status','prototype_note'}
for a,b in zip(before['cases'],d['cases']):
 assert a['id']==b['id'];assert all(b.get(k)==v for k,v in a.items()if k not in allowed);assert a==b or a['id']=='M9-T-J10'
cur=[x for x in d['cases']if x['scope']!='future-remote'];assert len(cur)==419 and len(d['cases'])==425;assert {s:sum(x['status']==s for x in cur)for s in ['通过','未执行','阻塞']}=={'通过':265,'未执行':151,'阻塞':3};p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
para='**最新接续（2026-10-20，DEV157 r94）：** 正式 **265/419（63.25%）**，151未执行、3阻塞，151含App。J10完整U/I/A通过：修复clean模型在途格式编辑被关闭直接销毁，现先排空队列、成功保存或保留失败视图。111代码（10新）、浅深14组真实App、六smoke/82运行/类型全过；174原返回/错误、14门闩及保存→关闭顺序独立核验，28线程/3自有App退出，最终正常0/null。1335构建前输入+8文件delta与原红测/驱动失败保留于[98项证据](验收/证据/'+name+')，详见[DEV157](技研/DEV157_XLSX关闭排空.md)。J02/W28及其他独立未完成项继续；阶段未完成、未发布。'
for file in ['README.md','实施计划与进度.md','交付说明.md','验收/执行与缺陷记录.md','原型/原型说明与变更.md']:
 p=base/file;s=p.read_text().replace('**最新接续（2026-10-20，DEV156 r93）：**','**前批接续（2026-10-20，DEV156 r93，历史）：**',1);pos=s.index('\n\n');note=para
 if '/'in file:note=note.replace('(验收/证据/','(../验收/证据/').replace('(技研/','(../技研/')
 p.write_text(s[:pos+2]+note+'\n\n'+s[pos+2:])
old='当前264/419完整通过（63.01%），DEV156修XLSX外改排空/旧stat及公式栏恢复并完成J09完整U/I/A，71代码/实机浅深10、新r93六smoke/82运行通过；152未执行、3阻塞';new='当前265/419完整通过（63.25%），DEV157修XLSX在途关闭保护并完成J10完整U/I/A，111代码/实机浅深14、新r94六smoke/82运行通过；151未执行、3阻塞'
for file in ['docs/需求池.md','docs/里程碑/README.md']:
 p=Path(file);s=p.read_text();assert s.count(old)==1;p.write_text(s.replace(old,new,1))
print('OnlyJ10advanced;265/419,151unexecuted+3blocked;notcomplete/notreleased')

from pathlib import Path
import hashlib,json
base=Path('docs/里程碑/M9_文件浏览工作区');name='m9-acceptance-pptx-baseline-dev159-r95-20261020.json';assert hashlib.sha256((base/'验收/证据'/name).read_bytes()).hexdigest()=='626cee017f316dda165e6c9297191f2c762d38aece33cadaa5b9acb46807b3a4'
p=base/'验收/用例覆盖索引.json';before=json.loads(p.read_text());d=json.loads(p.read_text());c=next(x for x in d['cases']if x['id']=='M9-T-J02');assert c['status']=='未执行';c.update(status='通过',actual_result='DEV159完整U/I/A：原schema与真实native三场景通过，匹配64位bytes基线时r95原PPTX Worker可编辑/实际保存回读；原FileService打开后实际源notes字节变化，旧基线拒绝CHANGED且保持外改源/无活动文档；空baseHash由原schema拒绝/零Worker/源不变。实际App复用r95浅深正常notes两组，独立源SHA=原metadata hash=原openPptx baseHash/sourceHash，实际Meta/CtrlS、更新后不blur关闭、两真实保存回执及重开最新通过；另浅深四组异常真实UI，源改变时延迟原metadata后独立同inode外改，基线空时显式只改传输clone的revision.hash，原native结果/认证/args/error不变，原schema拒绝。四组均显示打开失败、无编辑器、保存禁用、零edit/save RPC与零Worker；源保持原版或外改版。266原V8字节/对象与仅hash传输差异独立核验，7原RPC/原watch/Worker构造恢复，负向App正常0/null且两引用自有App父PID/私有目录token消失。1340输入与r95构建前全同、82运行/原六smoke/类型证据复用，生产0改；3独立契约场景不重复计入174 Vitest或正式用例。W28整条仍待XLSX16及全32审计；不外推P/V/系统或其他平台。',prototype_status='沿用P13既有预览/错误入口，本轮无原型或布局改变',prototype_note='J02原约定U/I/A；负向空hash明确为故障provider克隆传输，不宣称正常provider会生成空hash。不增加需求或删减原步骤。')
c['evidence'].append('证据/'+name)
for a,b in zip(before['cases'],d['cases']):
 assert a['id']==b['id'];assert a==b or a['id']=='M9-T-J02'
cur=[x for x in d['cases']if x['scope']!='future-remote'];counts={s:sum(x['status']==s for x in cur)for s in ['通过','未执行','阻塞']};assert counts=={'通过':266,'未执行':150,'阻塞':3};p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
para='**最新接续（2026-10-20，DEV159，复用r95）：** 正式 **266/419（63.48%）**，150未执行、3阻塞，150含App。新增J02完整U/I/A：3原schema/真实native基线场景、r95正常匹配基线浅深A2继承、异常基线浅深A4通过，266原V8核验。源变化拒绝CHANGED，空hash由原schema拒绝；异常零edit/save/Worker，源字节保持。空hash为明确标注的provider克隆传输故障，原认证/输入/metadata/error不变，不冒充正常环境；原watch/7RPC/Worker构造恢复，App正常0/null。1340构建前输入完全一致，82运行/原六smoke沿用，生产0改。[30项证据](验收/证据/'+name+')及[DEV159](技研/DEV159_PPTX首次基线.md)记录完整边界。W28的r95 PPT16已全过、XLSX16运行中，待全32与最终审计才结案；阶段未完成、未发布。'
for file in ['README.md','实施计划与进度.md','交付说明.md','验收/执行与缺陷记录.md','原型/原型说明与变更.md']:
 p=base/file;s=p.read_text().replace('**最新接续（2026-10-20，DEV158 r95，验收进行中）：**','**前批接续（2026-10-20，DEV158 r95，历史进度）：**',1);pos=s.index('\n\n');note=para
 if '/'in file:note=note.replace('(验收/证据/','(../验收/证据/').replace('(技研/','(../技研/')
 p.write_text(s[:pos+2]+note+'\n\n'+s[pos+2:])
p=base/'技研/DEV159_PPTX首次基线.md';p.write_text('# DEV159 PPTX首次基线\n\n依据 M9 R3.4/R3.4-P1、J02/R07.11。当前macOS arm64实际r95；同范围开发授权持续有效，无生产/原型改变。\n\n'+para+'\n\n原三场景完整保留：源bytes/hash匹配才可编辑保存；实际源变化以原CHANGED拒绝；hash空不得盲写。独立native探针使用真实当前main源码与包内Worker/native，无引擎分支按实际cached能力，不称GUI。真实匹配A精确继承已完成W28 PPT14里的浅深notes-normal两组，保存/不blur关闭/重开最新、原baseHash/源hash均直接核验。其余四负向A独立执行：延迟原metadata期间物理外改；传输clone只清空hash，原结果不动。受损provider元数据不是正常native输出；故障边界、被动watch暂扣及原帧释放详见证据。\n\n本条只要求U/I/A；不宣称视觉完全一致、系统/外部App、跨平台通过，也不要求在无有效基线时创建可编辑文档来触发写入。原schema/原native先拒绝、编辑/保存入口禁用及零真实write，是该拒绝分支的保护行为。未放宽条件或改期望。\n')
old='当前265/419完整通过（63.25%），DEV157修XLSX在途关闭保护并完成J10完整U/I/A，111代码/实机浅深14、新r94六smoke/82运行通过；151未执行、3阻塞';new='当前266/419完整通过（63.48%），DEV159完成PPTX首次基线J02完整U/I/A，3契约+浅深正常A2/故障A4通过、复用r95六smoke/82运行；W28 PPT16已过、XLSX16继续；150未执行、3阻塞'
for file in ['docs/需求池.md','docs/里程碑/README.md']:
 p=Path(file);s=p.read_text();assert s.count(old)==1,(file,s.count(old));p.write_text(s.replace(old,new,1))
print('Only J02 status advanced:266/419=63.48%;150 unexecuted+3blocked;W28 still unexecuted')

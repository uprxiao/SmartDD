from pathlib import Path
import hashlib,json
base=Path('docs/里程碑/M9_文件浏览工作区');name='m9-acceptance-xlsx-refresh-dev156-r93-20261020.json';report=base/'验收/证据'/name
assert hashlib.sha256(report.read_bytes()).hexdigest()=='8043f17840e75aaaccd7a315df418a2bd7c2e175c246289979ea489f828cc392'
p=base/'验收/用例覆盖索引.json';d=json.loads(p.read_text());before=json.load(open('/private/tmp/willyou-dev156-cases-before.json'));assert d==before;c=next(x for x in d['cases']if x['id']=='M9-T-J09');assert c['status']=='未执行'
c['status']='通过';c['evidence'].append('证据/'+name);c['defects']+=['DEV156-OBS01（刷新排空、版本与旧stat保护，r93复验通过）','DEV156-OBS02（clean刷新后公式栏为空且只读，r93修复复验）']
c['actual_result']='DEV156完整U/I/A：按R07.12允许的版本化Worker等价实现，刷新前后排空编辑/保存队列，合并重复请求并核对本地版本/客户端/基线。busy事件不丢，raw输入撤回clean仍保留冲突，重复刷新不擅自采用磁盘；旧stat跨自身保存/显式采用磁盘后重读。修复clean刷新网格更新而公式栏空白只读（ready/version effect缺依赖）。5竞态U及1组件红、旧r91/r92真实App红均保留，最终71代码（11新）0skip；5新真实native I及浅深5场景各1共10组正常r93 App通过。独立same-inode/fsync外写8次，6份clean/pending/revert源最终hash等于原外写，busy只经明确保留本地落盘；104原V8回执/6门闩hash解码及4精确时序核对通过（先drain/stat后保存、旧stat重读实际saved hash）。56原watch帧全被动投递、8原RPC恢复、16Office线程退出，3自有App父PID/私有目录token消失，最终正常0/null。r93六smoke/82运行hash/类型通过，1330构建前全量输入及10文件delta可恢复；已有订阅测试冻结时钟超时改真实时钟复验，未改生产watch预算。无CRDT、完整P/V或其他平台通过声明。'
c['prototype_status']='沿用P12/P09既有冲突操作，本轮无原型代码或视觉变化';c['prototype_note']='J09约定U/I/A，本轮完成真实本机XLSX协调；原型及Codex完整视觉、其他来源/平台边界沿用原记录。'
allowed={'status','evidence','actual_result','defects','prototype_status','prototype_note'}
for a,b in zip(before['cases'],d['cases']):
 assert a['id']==b['id'];assert all(b.get(k)==v for k,v in a.items()if k not in allowed)
 assert a==b or a['id']=='M9-T-J09'
cur=[x for x in d['cases']if x['scope']!='future-remote'];assert len(cur)==419 and len(d['cases'])==425;assert sum(x['status']=='通过'for x in cur)==264;assert sum(x['status']=='未执行'for x in cur)==152;assert sum(x['status']=='阻塞'for x in cur)==3;p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
para='**最新接续（2026-10-20，DEV156 r93）：** 正式 **264/419（63.01%）**，152未执行、3阻塞，152含App。J09完整U/I/A通过：修复刷新忙时丢事件/旧stat覆盖基线及clean刷新公式栏只读两项缺陷。最终71代码（11新）、正常App浅深10组、新六smoke/82运行核对/类型通过；104原V8回执、6门闩、56被动watch帧及磁盘hash已独立核验。16Office线程、3自有App退出，最终正常0/null。1330构建前输入+10文件delta及全部失败留存于[104项证据](验收/证据/'+name+')；实现与边界见[DEV156](技研/DEV156_XLSX外改与队列排空.md)。继续J02/J10/W28等独立未完成项；系统/参考/平台限制保留，M9未完成、未发布。'
for file in ['README.md','实施计划与进度.md','交付说明.md','验收/执行与缺陷记录.md','原型/原型说明与变更.md']:
 p=base/file;s=p.read_text().replace('**最新接续（2026-10-20，DEV155 r91）：**','**前批接续（2026-10-20，DEV155 r91，历史）：**',1);pos=s.index('\n\n');note=para
 if '/'in file:note=note.replace('(验收/证据/','(../验收/证据/').replace('(技研/','(../技研/')
 p.write_text(s[:pos+2]+note+'\n\n'+s[pos+2:])
old='当前263/419完整通过（62.77%），DEV155修PPT焦点内保存键并完成W27完整U/I/A，96代码/实机浅深4、新r91六smoke/82运行通过；153未执行、3阻塞'
new='当前264/419完整通过（63.01%），DEV156修XLSX外改排空/旧stat及公式栏恢复并完成J09完整U/I/A，71代码/实机浅深10、新r93六smoke/82运行通过；152未执行、3阻塞'
for path in ['docs/需求池.md','docs/里程碑/README.md']:
 p=Path(path);s=p.read_text();assert s.count(old)==1;p.write_text(s.replace(old,new,1))
print('J09 only advanced;264/419,152unexecuted+3blocked;stage remains in development, no release')

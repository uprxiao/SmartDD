from pathlib import Path
import json,hashlib,datetime,gzip,shutil,tarfile,platform
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';ev=base/'验收/证据';h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def result(log):
 x=json.loads(Path(log).read_text().splitlines()[-1]);p=Path(x['artifacts'])/'result.json';return p,json.loads(p.read_text())
a,A=result('/private/tmp/willyou-dev178-A-final2.log');p,P=result('/private/tmp/willyou-dev178-P-final2.log');rt=json.load(open('/private/tmp/willyou-dev178-runtime-r105.json'))
assert rt['verified']==81
for x in [A,P]:
 assert x['status']=='passed' and len(x['checks'])==12 and x['before']==x['after'] and x['exit']['code']==0 and x['exit']['signal'] is None and x['asarSha256']==rt['asarSha256']
 assert sum(len(c['keys'])for c in x['checks'])==192
 for c in x['checks']:
  assert all(k['trusted']for k in c['keys'])
  if c['scenario'].startswith(('Space','Enter')):
   assert len(c['keys'])==12 and all(k['prevented']for k in c['keys']) and sum(k['repeat']for k in c['keys'])==11
  else:
   assert c['before']['playing']==c['after']['playing'] and all(s['playing']==c['before']['playing']for s in c['samples'])
   if x is P:assert c['receiver']['mockTextarea'] and c['receiver']['value']==' '*12+'\n'*12
assert A['receiversAfter']['T1']['bytes']==96 and A['receiversAfter']['T2']['bytes']==0
assert len(bytes.fromhex(A['expectedHex']))==96 and set(A['ptyExits'].values())=={0}
assert all(A['restored'].values()) and len(A['restored'])==8
rows=A['rpc']['rows'];assert len(rows)==4 and all(x['before']==x['after'] and x['delivered']for x in rows)
assert len(A['media'])==4 and all(x['before']==x['after'] and x['input']==x['inputAfter'] and x['delivered']for x in A['media'])
assert [x['method']for x in A['media']].count('openMedia')==2 and [x['method']for x in A['media']].count('releaseMedia')==2
assert all(x.get('output',{}).get('hash')==A['before']['sha256']for x in A['media']if x['method']=='openMedia')
assert '25 passed (25)'in Path('/private/tmp/willyou-dev178-tests.log').read_text() and '2 passed (2)'in Path('/private/tmp/willyou-dev178-native.log').read_text()
assert 'built in'in Path('/private/tmp/willyou-dev178-P-build-final.log').read_text() and 'Prepared Sites build'in Path('/private/tmp/willyou-dev178-P-sites-build-final.log').read_text() and 'pass 4'in Path('/private/tmp/willyou-dev178-P-sites-final.log').read_text()
assert not Path('/private/tmp/willyou-dev178-processes.txt').read_text().strip()
assert json.load(open('/private/tmp/willyou-dev178-receiver-process-audit.json'))['status']=='passed'
parent=ev/'m9-acceptance-media-controls-dev177-r105-20261020.json';assert h(parent)=='03723064a125dd23146dadf52e00947da56e4a3186d0f20cb4b25ebb92ce66fb'
prev=json.load(open('/private/tmp/willyou-dev177-source.json'));names=list(prev['files'])+['scripts/files/media-keyboard-ui.mjs','scripts/lib/media-keyboard-matrix.mjs'];files={n:h(n)for n in names};changed=[n for n,v in prev['files'].items()if files[n]!=v];new=[n for n in names if n not in prev['files']]
assert set(changed)=={'src/renderer/features/files/media/preview.test.tsx','prototypes/m6-codex/tests/media-controls-harness.jsx','docs/真实App自动验收流程.md'} and len(files)==1403
source={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'parent':'DEV177 1401 inputs','files':files,'changedParentFiles':changed,'newFiles':new,'boundary':'No production/product-prototype/runtime/native/dependency/version changes. Only component tests, synthetic P test harness, external drivers and reusable guide changed. Reuses r105 build/native smoke plus fresh 81 runtime comparisons.'}
Path('/private/tmp/willyou-dev178-source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
with tarfile.open('/private/tmp/willyou-dev178-source.tar.gz','w:gz')as t:
 for n in changed+new:t.add(n,arcname=n)
reportName='m9-acceptance-media-keyboard-dev178-r105-20261020.json'
casePath=base/'验收/用例覆盖索引.json';data=json.loads(casePath.read_text());case=next(x for x in data['cases']if x['id']=='M9-T-T25');assert case['status']=='未执行'
case.update(status='通过',evidence=['证据/'+reportName],actual_result='DEV178 R/P/I/A：R沿用已确认D16静态事实；生产及产品P零改，r105同包81运行哈希新核对。25代码（新组件2）＋2真实Swift/FileService完整字节I、P构建/Sites4/类型通过。浅深真实App12/P12：每键开/停后11次连续repeat，逐次保持状态且video事件防默认；每层192可信按键。A真实xterm/PTY接收12空格+12CR×4组共96bytes，另一终端0；原始raw.bin精确、PID/PTY身份不变，0命令/模型执行。4原文件RPC/4媒体RPC原hash同、2grant/release、8handler恢复、源SHA/inode/mtime不变，两PTY退出0、最终A/P正常0/null。P仅共享Media模拟进度＋每组明确独立textarea输入，不冒称真实终端/解码。capture微任务观察过早、旧cleanup变量和P无关清空快捷键失败均留存；未改原步骤/预期，不涉及T27/物理系统repeat/完整像素或跨平台。',prototype_status='P15 本条视频键盘与焦点状态已核验',prototype_note='DEV178 浅深P12，原共享Media模拟播放；每组独立textarea明确非终端。验证Space/Enter开停、防默认、repeat与旁侧输入隔离；无新Codex动态/像素或真实PTY结论。')
casePath.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
out=ev/'acceptance-media-keyboard-dev178-r105';out.mkdir(exist_ok=True);art={}
def add(p,name=None):
 p=Path(p);name=name or p.name;b=p.read_bytes();gz=len(b)>1024*1024 and p.suffix in['.json','.log'];q=out/(name+'.gz'if gz else name)
 if gz:q.write_bytes(gzip.compress(b,mtime=0))
 else:shutil.copy2(p,q)
 art[q.name]={'path':str(q.relative_to(root)),'sha256':h(q),'bytes':q.stat().st_size,**({'compression':'gzip','originalSha256':h(p)}if gz else{})}
for folder in sorted(Path('/private/tmp').glob('willyou-media-keyboard-*-*')):
 if(folder/'result.json').exists():
  for f in folder.iterdir():
   if f.is_file():add(f,folder.name+'-'+f.name)
for label in ['T1','T2']:
 for name in ['state.json','raw.bin']:
  f=a.parent/label/name
  if f.exists():add(f,'final-A-'+label+'-'+name)
for f in Path('/private/tmp').glob('willyou-dev178-*'):
 if f.is_file()and not f.name.endswith('archive-result.json'):add(f)
add(A['manifest'],'fixtures-used.json');add(parent);add(base/'调研/M9_文件类型与编辑状态全集.md','reference-D16.md');add(base/'技研/DEV178_视频键盘与真实终端焦点.md')
r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','caseIds':['M9-T-T25'],'revision':'R3.4-P1','requirements':['M9-R06.12','M9-R09.6'],'branch':'feature/0.0.1','head':'89de9af4b631abdef5673ce8949fb02a32f6fcad','environment':{'platform':'macOS','version':platform.mac_ver()[0],'arch':platform.machine(),'data':'Existing synthetic silent30s H264/AAC video; two actual input-only Python receivers. No user media/credentials/clipboard/picker/model/external App/current Codex access.'},'app':{'path':'/private/tmp/willyou-m9-acceptance-batch-r105-build/mac-arm64/WillYou.app','asarSha256':rt['asarSha256'],'runtimeFiles':81,'build':'Reused unchanged DEV177 full build/afterPack/six-native-smoke; fresh81 comparison. No new production build required.'},'results':{'code':25,'newComponent':2,'realNativeI':2,'uniqueVitest':27,'prototypeBuild':'passed','sites':4,'typecheck':'passed','appChecks':12,'prototypeChecks':12,'trustedKeydownsEachLayer':192,'actualPTYBytes':96,'otherPTYBytes':0,'executedCommands':0,'fileRPC':4,'mediaRPC':4,'originalHandlersRestored':8,'protocolGrants':2,'protocolReleases':2,'ptyExits':A['ptyExits'],'finalNormalAppExits':2,'sourceInputs':1403,'ownAppProcessesRemaining':0},'coverage':{'passedBefore':290,'passedAfter':291,'currentTotal':419,'percentage':round(291/419*100,2),'unexecuted':125,'blocked':3,'futureOnly':6,'total':425,'newPassed':['M9-T-T25']},'evidenceScopes':['R original approved D16 static source facts, no new reference dynamic/pixel read.','A actual focus, Space/Enter and 11 autoRepeat keyDowns followed by keyUp; nonrepeat toggles and all repeats individually retain playback state and preventDefault in video.','A actual terminal Space/Enter+repeat while video playing and paused: raw input exact96bytes, second task zero, same PID and PTY, no command execution. Original decoder/protocol/IPC active.','P shared synthetic Media with explicit independent textarea receivers, no actual terminal/decoder claim. Same keyboard matrix and per-event assertions.','I original native FileService/media complete-byte/owner/release tests; U mock decoder and scheduling separate. Source SHA/inode/mtime unchanged; original4file/4media RPC hashes unchanged,8 handlers restored.','Final A/P normal0/null, two actual PTY exits0; failed predecessors retained separately and not counted as passes. All known own receiver PIDs and own r105 App processes exited.'], 'history':['Capture microtask defaultPrevented observed before React handler. Changed passive observation to next task, production unchanged.','One full A12 passed but cleanup used missing unrelated __m5 variable. Introduced independent pty:exit observer and reran complete matrix.','P shared textarea reset precondition failed; native Backspace removed one character but Select All still failed, root cause unclassified. Final P original steps use explicitly independent blank input per sequence; no value mutation or native shortcut pass claimed.','Final A12 rerun from final shared driver after P-only harness/input-destination adjustments; P12 final and A12 final asar equal.'], 'sourceSnapshot':{'manifest':'willyou-dev178-source.json','delta':'willyou-dev178-source.tar.gz','parentInputs':1401,'inputs':1403,'changed':changed,'new':new},'parent':{'path':str(parent.relative_to(root)),'sha256':h(parent)},'limits':['T27 overlay isolated contrast and other media cases not covered. No OS physical repeat timing or Codex pixel equivalence claim.','T32/T34/Y29 manual/environment blockers unchanged; remaining original419scope retained. M9 incomplete/unpublished.'],'artifacts':art,'releasePerformed':False}
f=ev/reportName;f.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(f.relative_to(root)),'sha256':h(f),'artifacts':len(art),'progress':'291/419 (69.45%)'},ensure_ascii=False))

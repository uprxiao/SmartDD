from pathlib import Path
import json,hashlib,datetime,gzip,shutil,tarfile,platform
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';ev=base/'验收/证据';h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(log):
 x=json.loads(Path(log).read_text().splitlines()[-1]);p=Path(x['artifacts'])/'result.json';return p,json.loads(p.read_text())
a,A=read('/private/tmp/willyou-dev179-A-capabilities-final2.log');k,K=read('/private/tmp/willyou-dev179-A-keyboard.log');c,C=read('/private/tmp/willyou-dev179-A-controls.log');rt=json.load(open('/private/tmp/willyou-dev179-runtime-r106.json'));pack=json.load(open('/private/tmp/willyou-dev179-r106-fast-package-result.json'))
assert rt['verified']==81 and pack['status']=='passed' and len(pack['steps'])==4 and all(x['code']==0 and x['signal']is None for x in pack['steps'])
assert A['status']=='partial' and len(A['checks'])==16 and A['completedCases']==['M9-T-T27'] and A['blockedCases']==['M9-T-T30']
assert A['nativeFullscreenBlock']['nativeWindowUnverified'] and all(not w['focused'] and not w['fullscreen'] and not w['simpleFullscreen']for w in A['nativeFullscreenBlock']['windows'])
for x,count in [(K,12),(C,36)]:assert x['status']=='passed' and len(x['checks'])==count
for x in [A,K,C]:assert x['before']==x['after'] and x['exit']['code']==0 and x['exit']['signal']is None and x['asarSha256']==rt['asarSha256'] and all(x['restored'].values())
assert sum(x['caseId']=='M9-T-T27'for x in A['checks'])==4 and sum(x['caseId']=='M9-T-T30'for x in A['checks'])==12
for x in A['checks']:
 if 'right'in x:
  assert abs(x['right']['position']-x['before']['position']-.1)<1e-6 and abs(x['left']['position']-x['before']['position'])<1e-6 and all(k['trusted']and not k['prevented']for k in x['keys'])
 if 'afterIdle'in x:
  s=x['afterIdle'];assert s['position']-x['start']['position']>3.1 and s['controls']['visible']=='true' and not x['start']['focusInViewer']and not x['start']['hoverInViewer'] and s['frames']>x['start']['frames']
 if 'nativeWindowVerified'in x:
  assert x['nativeWindowVerified']is False and x['entered']['fullscreen']and not x['exited']['fullscreen']
  assert all(not w['fullscreen']and not w['simpleFullscreen']for w in x['enteredWindows'])
  assert x['entered']['fullscreenButton']['pressed']=='true'and x['exited']['fullscreenButton']['pressed']=='false'
 if 'actual native PiP enter'in x['scenario']:assert x['entered']['pip']and not x['exited']['pip']
 if 'explicit public API rejected'in x['scenario']:
  reason='requestPictureInPicture'if x['scenario'].endswith('画中画')else'requestFullscreen';assert reason in x['failure']['error']and not x['failure']['pip']and not x['failure']['fullscreen']
 if 'hidden'in x:assert not x['hidden']['pipButton']and not x['hidden']['fullscreenButton']
assert len(A['listeners'])==12 and sorted(x['id']for x in A['listeners']if x['action']=='add')==sorted(x['id']for x in A['listeners']if x['action']=='remove')
assert len(A['nativeObserver']['rows'])==4 and all(x['name']in['enter-html-full-screen','leave-html-full-screen']for x in A['nativeObserver']['rows'])and all(x['restored']for x in A['nativeObserver']['restored'])
assert A['observerRestored'] and K['receiversAfter']['T1']['bytes']==96 and K['receiversAfter']['T2']['bytes']==0 and sum(len(x['keys'])for x in K['checks'])==192 and set(K['ptyExits'].values())=={0}
fileRows=[];mediaRows=[]
for x in[A,K,C]:
 fileRows+=x['rpc']['rows'];mediaRows+=x['media']
assert len(fileRows)==36 and len(mediaRows)==36 and all(x['before']==x['after']and x['delivered']for x in fileRows)and all(x['before']==x['after']and x['input']==x['inputAfter']and x['delivered']for x in mediaRows)
assert sum(x['method']=='openMedia'for x in mediaRows)==18 and sum(x['method']=='releaseMedia'for x in mediaRows)==18
assert '33 passed (33)'in Path('/private/tmp/willyou-dev179-tests-final.log').read_text() and '2 passed (2)'in Path('/private/tmp/willyou-dev179-native.log').read_text()
assert not Path('/private/tmp/willyou-dev179-processes.txt').read_text().strip() and json.load(open('/private/tmp/willyou-dev179-receiver-process-audit.json'))['status']=='passed'
parent=ev/'m9-acceptance-media-keyboard-dev178-r105-20261020.json';assert h(parent)=='88214673fca739c4b2eae4f02f6c1e59cfc2aea71d9971607d071240c985b16a'
prev=json.load(open('/private/tmp/willyou-dev178-source.json'));pre=json.load(open('/private/tmp/willyou-dev179-prebuild-source.json'));files={n:h(n)for n in pre['files']};changed=[n for n,v in prev['files'].items()if files[n]!=v];new=[n for n in files if n not in prev['files']];afterBuild=[n for n,v in pre['files'].items()if files[n]!=v]
assert len(files)==1404 and set(changed)=={'src/renderer/features/files/media/preview.test.tsx','src/renderer/features/files/media/preview.tsx','src/renderer/features/files/media/style.css','docs/真实App自动验收流程.md'} and set(afterBuild)=={'docs/真实App自动验收流程.md','scripts/files/media-capabilities-ui.mjs'}
source={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'parent':'DEV178 1403 inputs','files':files,'changedParentFiles':changed,'newFiles':new,'postBuildChanges':afterBuild,'boundary':'r106 production inputs match prebuild. Only external UI driver and reusable guide evolved after build; final capability driver executed exact final source. Product P/native/CSP/dependency/version unchanged.'}
Path('/private/tmp/willyou-dev179-source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
with tarfile.open('/private/tmp/willyou-dev179-source.tar.gz','w:gz')as t:
 for n in changed+new:t.add(n,arcname=n)
name='m9-acceptance-media-capabilities-dev179-r106-20261020.json';p=base/'验收/用例覆盖索引.json';data=json.loads(p.read_text());t27=next(x for x in data['cases']if x['id']=='M9-T-T27');t30=next(x for x in data['cases']if x['id']=='M9-T-T30');assert t27['status']==t30['status']=='未执行'
t27.update(status='通过',evidence=['证据/'+name],actual_result='DEV179 R/I/A完整：默认FileContent仍只传buffer，below不启用overlay；补显式presentation隔离对照和allowFullscreen，原生/IPC/CSP/依赖/版本不变。33代码（新组件8）＋2真实native全字节I/类型及r106新全构建/六smoke/81运行核对过。overlay隔离组件验证±5s边界/IME、2499/2500ms、重新活动、暂停及卸载timer清理；非overlay无自定义方向键和idle timer。浅深实际A4：seek左右各0.1s且未preventDefault；真实播放>3.1s、指针和焦点移出后控制条仍可见并在画面下方。该默认slider步长为本机Chromium运行观察，未偷套±5s。R沿用D16静态，无新参考动态/像素；产品P无改且本条不要求P。相同r106 T25 A12和T24/T28/T29 A36回归通过。',prototype_status='本条R/I/A已核对；overlay仅隔离组件，文件宿主仍below',prototype_note='P15产品原型无改，本条无P环境要求。隔离overlay逻辑已验；其完整像素与系统全屏不据本条宣称通过。')
t30.update(status='阻塞',evidence=['证据/'+name],actual_result='DEV179部分I/A：33代码含T30新增组件5＋真实native I2通过。浅深真实PiP进入/退出2组、HTML全屏UI及4个主进程HTML事件/aria/glyph同步2组，4次明确public request Promise拒绝、2次false能力flag与2次恢复/原生解码均记录。六个document监听一一回收，四个原生事件观察器恢复原计数。系统窗口全屏仍未验：窗口visible/fullscreenable=true但focused=false，show/focus/app.focus请求后仍无原生焦点，isFullScreen和isSimpleFullScreen均false，仅HTML全屏事件。已保留实际现场与失败；未断言锁屏原因或App已无缺陷，等原生焦点条件可用后定位/补验。不将HTML填满viewport或stub成功算作系统全屏通过。相同新包其他媒体回归通过；用户离开期间继续其他用例，不重复请求配合。',defects=['DEV179-ENV01：本批自有窗口原生焦点不可用；HTML全屏与系统窗口状态不同，系统全屏仍需定位/验收。'],prototype_status='I及部分A已核验；系统窗口全屏阻塞',prototype_note='不以组件stub、HTML fullscreenElement或内容viewport充满证明macOS系统全屏；P未新增执行，不要求用户离开期间配合。')
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
out=ev/'acceptance-media-capabilities-dev179-r106';out.mkdir(exist_ok=True);art={}
def add(p,label=None):
 p=Path(p);label=label or p.name;b=p.read_bytes();gz=len(b)>1024*1024 and p.suffix in['.json','.log'];q=out/(label+'.gz'if gz else label)
 if gz:q.write_bytes(gzip.compress(b,mtime=0))
 else:shutil.copy2(p,q)
 art[q.name]={'path':str(q.relative_to(root)),'sha256':h(q),'bytes':q.stat().st_size,**({'compression':'gzip','originalSha256':h(p)}if gz else{})}
for folder in sorted(Path('/private/tmp').glob('willyou-media-capabilities-A-*')):
 if(folder/'result.json').exists():
  for f in folder.iterdir():
   if f.is_file():add(f,folder.name+'-'+f.name)
for folder in [k.parent,c.parent]:
 for f in folder.iterdir():
  if f.is_file():add(f,folder.name+'-'+f.name)
for label in ['T1','T2']:
 for n in ['state.json','raw.bin']:
  f=k.parent/label/n
  if f.exists():add(f,'final-keyboard-'+label+'-'+n)
for f in Path('/private/tmp').glob('willyou-dev179-*'):
 if f.is_file()and not f.name.endswith('archive-result.json'):add(f)
for f in Path('/private/tmp/willyou-dev179-before').iterdir():add(f,'before-'+f.name)
add(parent);add(A['manifest'],'fixtures-used.json');add(base/'调研/M9_文件类型与编辑状态全集.md','reference-D16-D17.md');add(base/'技研/DEV179_媒体呈现分支与系统能力.md')
r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'in-progress','caseIds':['M9-T-T27','M9-T-T30'],'passedCaseIds':['M9-T-T27'],'blockedCaseIds':['M9-T-T30'],'revision':'R3.4-P1','requirements':['M9-R06.12'],'branch':'feature/0.0.1','head':'89de9af4b631abdef5673ce8949fb02a32f6fcad','environment':{'platform':'macOS','version':platform.mac_ver()[0],'arch':platform.machine(),'data':'Existing synthetic silent media fixtures and input-only Python PTY receivers. No daily credentials/media/model/clipboard/picker/external App/current Codex access.'},'app':{'path':pack['app'],'asarSha256':rt['asarSha256'],'runtimeFiles':81,'build':'One full build/same packaging configuration/afterPack and original six native smoke passed. No release.'},'results':{'code':33,'newComponent':8,'realNativeI':2,'uniqueVitest':35,'typecheck':'passed','T27AppChecks':4,'T30Observations':12,'T30NativeWindowUnverified':2,'T30NativePipCycles':2,'T30HtmlFullscreenCycles':2,'T30RejectedRequestFaults':4,'T30FalseCapabilityFaults':2,'T30Recovery':2,'keyboardRegressionApp':12,'controlsRegressionApp':36,'fileRPC':36,'mediaRPC':36,'protocolGrants':18,'protocolReleases':18,'eachBatchOriginalHandlersRestored':8,'documentFullscreenListenersAddedAndRemoved':6,'nativeEventObserversRestored':4,'finalNormalAppExits':3,'sourceInputs':1404,'ownAppProcessesRemaining':0},'coverage':{'passedBefore':291,'passedAfter':292,'currentTotal':419,'percentage':round(292/419*100,2),'unexecuted':123,'blocked':4,'futureOnly':6,'total':425,'newPassed':['M9-T-T27'],'newBlocked':['M9-T-T30']},'changes':['Optional explicit video overlay only: custom5second seek,2500ms idle hide/reveal/timer cleanup. Default file host remains below with native range step and always-visible controls.','PiP hidden for overlay; caller allowFullscreen defaulttrue gated with native flag/method. PiP/fullscreen aria-pressed follows original native events. No new product routes/P/native/IPC/CSP/dependency/version changes.'],'blocked':A['nativeFullscreenBlock'],'evidenceScopes':['R original D16/D17 static facts, no fresh Codex dynamic/pixel evidence.','T27 isolated component ±5/clamp/IME,2499/2500/reveal/pause/unmount; A light/dark native range.1 and below toolbar after>3.1played seconds with pointer/focus outside. No overlay route enabled.','T30 actual PiP enter/exit in boththemes. HTML fullscreenElement/events/viewport/glyph/aria cycles are separate from native system window fullscreen; latter remains unverified and complete case NOT passed.','T30 rejected public request promises and false capability flags explicitly injected; original methods/flags restored, real decoder recovery observed. No fabricated success capability or native state.','r106 regressions T25 A12 actual192keys/rawPTY96bytes/other0 and T24/T28/T29 fullA36; component seek-drag/cancel regression included in33code.','Native I original Swift/FileService complete bytes/owner/release across4fixtures; protocol hashes and sources original in A. Final3ownApps normal0/null, failed predecessors separate. ProductP unchanged, DEV178P boundary inherited rather than claimed newlyrun.'],'history':['Before implementation three overlay tests failed. Async findBy under fake timers later timed out; replaced with act and direct assertion, production not changed for that test issue.','First actual fullscreen had document state and HTML event but no system window transition. Collected separate native/HTML events and windowvisible/focused/fullscreenable/bounds, then requested own window activation; native focus remainedfalse. No lock-screen root cause asserted.','Continue-native-block mode preserves T30blocked and proceeds remaining fault/recovery/darktests. One driver wait incorrectly used HTML event history for a native-false precondition; corrected filtering and reran full16observations. Original system-fullscreen requirement retained.','Initial batch statusfailed reflects native fullscreen incomplete; independent keyboard12 and controls36 passed and are not rerun unnecessarily after external-driver-only fixes.'],'sourceSnapshot':{'manifest':'willyou-dev179-source.json','delta':'willyou-dev179-source.tar.gz','prebuild':'willyou-dev179-prebuild-source.json','parentInputs':1403,'inputs':1404,'changed':changed,'new':new,'postBuildOnly':afterBuild},'parent':{'path':str(parent.relative_to(root)),'sha256':h(parent)},'limits':['System window fullscreen pending native focus and actual transition; T30blocked, not a pass.','Overlay isolated component logic only, no new route/overlay pixel guarantee. Product P unchanged, no new P execution.','T19raw0 and other original scope pending; T32/T34/Y29 unchanged. M9 incomplete/unpublished.'],'artifacts':art,'releasePerformed':False}
p=ev/name;p.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(p.relative_to(root)),'sha256':h(p),'artifacts':len(art),'progress':'292/419 (69.69%)','blocked':4},ensure_ascii=False))

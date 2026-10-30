from pathlib import Path
import json,hashlib,datetime,gzip,shutil,subprocess,tarfile
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';ev=base/'验收/证据';h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(log):
 a=json.loads(Path(log).read_text().splitlines()[-1]);p=Path(a['artifacts'])/'result.json';return p,json.loads(p.read_text())
a,rail=read('/private/tmp/willyou-dev176-r104-rail.log');p,P=read('/private/tmp/willyou-dev176-P-final-r104.log');c,clamp=read('/private/tmp/willyou-dev176-r104-clamp.log');n,nav=read('/private/tmp/willyou-dev176-r104-navigation.log');z,zoom=read('/private/tmp/willyou-dev176-r104-controls.log');runtime=json.load(open('/private/tmp/willyou-dev176-runtime-r104.json'));assert runtime['verified']==81
for r in[rail,P]:
 assert r['status']=='observed'and len(r['checks'])==22 and r['railObserverRestored']and r['exit']['code']==0 and r['exit']['signal']is None
 t07=[x for x in r['checks']if x['caseId']=='M9-T-T07'];assert len(t07)==20
 for x in t07:
  if 'panel'in x:assert x['panel']['hidden']==x['panel']['inert']==(not x['expanded']) and x['panel']['ariaHidden']==str(not x['expanded']).lower()and x['decorativeButtons']==0 and x['axPageButtons']==(['第 1 页','第 2 页','第 3 页']if x['expanded']else[])
  if 'keys'in x:assert x['keys']and all(k['trusted']for k in x['keys'])
 for x in r['checks']:
  if x['caseId']=='M9-T-T02':assert x['open']['menu']and not x['closed']['menu']
 assert r['before']==r['after']and r['rendererErrors']==[]
for r in[rail,clamp,nav,zoom]:assert r['asarSha256']==runtime['asarSha256']and r['before']==r['after']
assert clamp['status']=='passed'and len(clamp['checks'])==2 and all(x['code']==0 and x['signal']is None for x in clamp['apps'])
assert nav['status']=='observed'and len(nav['checks'])==18 and nav['exit']['code']==0 and nav['navigationObserverRestored']
for x in nav['checks']:
 if 'timeline'in x:assert len(x['intermediatePositions'])>1
 if 'agrees'in x:assert x['agrees']
 if x['scenario'].startswith('user scroll'):assert x['after']['scrollTop']==0 and x['after']['current']=='第 1 页'
assert zoom['status']=='passed'and len(zoom['checks'])==22 and zoom['exit']['code']==0
assert '61 passed (61)'in Path('/private/tmp/willyou-dev176-final-code.log').read_text()
assert 'Prepared Sites build'in Path('/private/tmp/willyou-dev176-P-build.log').read_text();assert 'pass 12'in Path('/private/tmp/willyou-dev176-P-model.log').read_text();assert 'pass 4'in Path('/private/tmp/willyou-dev176-P-sites.log').read_text()
escapepath=Path('/private/tmp/willyou-pdf-escape-36X4nT/result.json');escape=json.loads(escapepath.read_text());assert escape['checks'][0]['after']['menu']and not escape['checks'][1]['after']['menu']and escape['checks'][1]['before']['focusedMenu'];parent=ev/'m9-acceptance-pdf-navigation-dev175-r102-20261020.json';assert h(parent)=='84731dc01aa4af8ac1778fa5223c6c38c57aa48588f4e7ddfaee429cea525027';parentjson=json.loads(parent.read_text());assert h('/private/tmp/willyou-m9-acceptance-batch-r102-build/mac-arm64/WillYou.app/Contents/Resources/app.asar')==parentjson['app']['asarSha256']
processes=[]
for line in subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines():
 parts=line.strip().split(None,1)
 if len(parts)==2 and any(parts[1].startswith('/private/tmp/willyou-m9-acceptance-batch-'+v+'-build/')for v in['r103','r104']):processes.append({'pid':parts[0],'command':parts[1]})
assert not processes,processes
source=json.load(open('/private/tmp/willyou-dev176-source.json'));parentSource=json.load(open('/private/tmp/willyou-dev175-source.json'));source['files']={f:h(f)for f in source['files']};source['changedParentFiles']=[f for f,v in parentSource['files'].items()if source['files'][f]!=v];assert len(source['files'])==1395;Path('/private/tmp/willyou-dev176-source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
with tarfile.open('/private/tmp/willyou-dev176-source.tar.gz','w:gz')as t:
 for f in source['changedParentFiles']+source['newFiles']:t.add(f,arcname=f)
out=ev/'acceptance-pdf-rail-dev176-r104';out.mkdir(exist_ok=True);art={}
def add(p,name=None):
 p=Path(p);b=p.read_bytes();name=name or p.name;gz=len(b)>1024*1024 and p.suffix in['.json','.log'];q=out/(name+'.gz'if gz else name)
 if gz:q.write_bytes(gzip.compress(b,mtime=0))
 else:shutil.copy2(p,q)
 art[q.name]={'path':str(q.relative_to(root)),'sha256':h(q),'bytes':q.stat().st_size,**({'compression':'gzip','originalSha256':h(p)}if gz else{})}
folders=list(Path('/private/tmp').glob('willyou-pdf-rail-*'))+[c.parent,n.parent,z.parent,escapepath.parent]
for folder in folders:
 if(folder/'result.json').exists():
  for f in folder.iterdir():
   if f.is_file():add(f,folder.name+'-'+f.name)
for f in Path('/private/tmp').glob('willyou-dev176-*'):
 if f.is_file()and f.name!='willyou-dev176-cases-before.json'and not f.name.endswith('archive-result.json'):add(f)
for f in Path('/private/tmp/willyou-dev176-before').iterdir():
 if f.is_file():add(f,'before-'+f.name)
add(parent);add(base/'调研/证据/m9-viewers-source.json','reference-viewers-index.json');add(base/'调研/M9_文件类型与编辑状态全集.md','reference-D05.md')
r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','caseIds':['M9-T-T07'],'revision':'R3.4-P1','branch':'feature/0.0.1','head':'89de9af4b631abdef5673ce8949fb02a32f6fcad','environment':'macOS arm64, own private projects/profiles, synthetic normal.pdf. Original packaged App/native/IPC/PDF.js; P original shared prototype/real browser PDF.js. No model/PTY/systempicker/clipboard/external App/current Codex access.','app':{'path':'/private/tmp/willyou-m9-acceptance-batch-r104-build/mac-arm64/WillYou.app','asarSha256':runtime['asarSha256'],'runtimeFiles':81,'build':'Full build/identical packaging/afterPack/native sixsmoke passed. No release.'},'results':{'uniqueCodeTests':61,'productionFocusedTests':60,'prototypeComponent':1,'newRailComponentRedGreen':1,'zoomComponentRegression':1,'prototypeModel':12,'sites':4,'prototypeBuild':'passed','typecheck':'passed','appT07':20,'prototypeT07':20,'appT02Partial':2,'prototypeT02Partial':2,'appNavigationRegression':18,'appColdClampRegression':2,'appZoomWheelRegression':22,'originalRpcInputsOutputs':18,'originalResourceInputsOutputs':16,'originalHandlersRestoredPerObservedApp':7,'sourceInputs':1395,'remainingOwnApps':processes},'coverage':{'passedBefore':286,'passedAfter':287,'currentTotal':419,'percentage':round(287/419*100,2),'unexecuted':129,'blocked':3,'futureOnly':6,'total':425,'onlyStatusChanged':'M9-T-T07'},'fixes':['Hidden full thumbnail panel has hidden/aria-hidden/inert; collapsed number rail remains decorative with no focusable descendants.','Hover/focus/dock tracked explicitly, including focus retained after pointer leave and undock until both leave. Existing widths25/90 and original navigation retained.','A/P actual keyboardTab and Chromium AX tree prove hidden page buttons excluded and expanded first/middle/last page buttons reachable; no programmatic focus as Tab evidence.'],'reference':{'basis':'Existing reviewed R06.5/T07 and archived D05/V20 index facts; not new/current Codex runtime verification.','limit':'Indexed formatted V20 extraction not present at old path; did not recreate/read installed Codex. Existing confirmed requirement/summary retained; no fresh source-body or pixel-equivalence claim.'},'history':['T07 component red: hidden panel semantics absent. Final61code green includes same existing FileBuffer/preview with decoder/canvas/geometry isolated and original Pcomponent regression.','Initial r103 added Zoom controlled Escape handler based on earlier observation; realApp still failed, so no success claimed. r102 original-package immediate-versus-focus-ready comparison proved readiness issue; redundant product menu change removed before finalr104.','After actual menu focus readiness, final read also needs actual DOM removal rather than rail-width stable frames during exit; first r104 false failure retained and driver state wait corrected.','Old navigation regression had same premature close/toggle fallback, causing occluded next item. Corrected external driver, retained failure, repeated only remaining navigation/zoom branches on same r104.','Final T07/Cold A remained at existing successful result; final navigation/zoom supplemented it. Same final helper P20+2 replayed; no fabricated success or case removal.'],'sourceSnapshot':{'manifest':'willyou-dev176-source.json','delta':'willyou-dev176-source.tar.gz','parentInputs':1392,'changed':source['changedParentFiles'],'new':source['newFiles']},'parent':{'path':str(parent.relative_to(root)),'sha256':h(parent)},'limits':['T02 full toolbar/conditional annotation scope still unexecuted; Escape observations corrected, not a formal T02 pass.','Chromium AX tree verifies web accessibility semantics, not VoiceOver OS acceptance.','UI geometry/focus/collapsed and expanded states verified; no full Codex pixel equality.','No IPC/storage/native/dependency/version change. Existing native/SQLite integration contract evidence inherited, A confirms current original native chain; no new backend implementation claimed.','T32/T34/Y29three human/environment blockers unchanged. M9 incomplete and unpublished.'],'artifacts':art,'releasePerformed':False}
f=ev/'m9-acceptance-pdf-rail-dev176-r104-20261020.json';f.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(f.relative_to(root)),'sha256':h(f),'artifacts':len(art),'progress':'287/419 (68.50%)'},ensure_ascii=False))

from pathlib import Path
import json,hashlib,datetime,gzip,shutil,subprocess,tarfile,platform
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';ev=base/'验收/证据';h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(log):
 a=json.loads(Path(log).read_text().splitlines()[-1]);p=Path(a['artifacts'])/'result.json';return p,json.loads(p.read_text())
a,A=read('/private/tmp/willyou-dev177-A-r105.log');p,P=read('/private/tmp/willyou-dev177-P-controls.log');af,AF=read('/private/tmp/willyou-dev177-A-T24-focus.log');pf,PF=read('/private/tmp/willyou-dev177-P-T24-focus.log');rt=json.load(open('/private/tmp/willyou-dev177-runtime-r105.json'));assert rt['verified']==81
for r,count in[(A,36),(P,34),(AF,4),(PF,4)]:assert r['status']=='passed'and len(r['checks'])==count and r['before']==r['after']and r['exit']['code']==0 and r['exit']['signal']is None
for r in[A,AF,PF]:assert r['asarSha256']==rt['asarSha256']
for r in[A,P]:
 assert [sum(x['caseId']==c for x in r['checks'])for c in['M9-T-T24','M9-T-T28','M9-T-T29']]==[4,12,18 if r is A else 16]
 for x in r['checks']:
  if 'afterThree'in x:assert x['afterThree']['position']>3.05
  if x['caseId']=='M9-T-T28':
   s=x['state'];assert s['slider']['step']=='0.01';assert(s['iconMuted']==(s['volume']==0 or s['muted']))
   if'previousZero'in x:assert x['previousZero']['volume']==0 and s['volume']>0
  if x['caseId']=='M9-T-T29'and'before'in x:
   assert x['progress']>0 and abs(x['progress']-x['expected'])<.35;assert sum(z['checked']=='true'for z in x['selected']['rates'])==1
   if r is A:assert x['after']['frames']>x['before']['frames']and x['selected']['rate']in[.25,.5,.75,1,1.25,1.5,1.75,2]
  if x['caseId']=='input':assert all(k['trusted']for k in x['keys'])and all(k['trusted']for k in x['pointers'])
for r in[AF,PF]:
 for x in r['checks']:
  if'afterThree'in x:
   s=x['afterThree'];assert s['position']>3.05 and not s['focusInViewer']and not s['hoverInViewer'];assert s['controls']['width']>0 and float(s['controls']['opacity'])>0 and s['controls']['visibility']=='visible'and s['controls']['top']>=s['controls']['frameBottom']-1
  if'options'in x:assert not x['options']['copyLink']
assert '23 passed (23)'in Path('/private/tmp/willyou-dev177-volume-green.log').read_text();assert '2 passed (2)'in Path('/private/tmp/willyou-dev177-native.log').read_text();assert 'Prepared Sites build'in Path('/private/tmp/willyou-dev177-P-build.log').read_text();assert 'pass 4'in Path('/private/tmp/willyou-dev177-P-sites.log').read_text()
assert all(A['restored'].values())and all(AF['restored'].values());rpc=json.load(open('/private/tmp/willyou-dev177-rpc-audit.json'));assert rpc['status']=='passed'
processes=[]
for line in subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines():
 v=line.strip().split(None,1)
 if len(v)==2 and any(v[1].startswith('/private/tmp/willyou-m9-acceptance-batch-'+t+'-build/')for t in['r104','r105']):processes.append({'pid':v[0],'command':v[1]})
assert not processes,processes
parent=ev/'m9-acceptance-pdf-rail-dev176-r104-20261020.json';assert h(parent)=='7581ce416d333265a590cdeff3c313618a6b885f14a01677e8fd39f2068aac35'
b=json.load(open('/private/tmp/willyou-dev176-source.json'));pre=json.load(open('/private/tmp/willyou-dev177-prebuild-source.json'));source={**pre,'files':{n:h(n)for n in pre['files']},'boundary':'r105 production matches prebuild; external test scripts/guide finalized afterward'};assert len(source['files'])==1401;assert source['files']['src/renderer/features/files/media/preview.tsx']==pre['files']['src/renderer/features/files/media/preview.tsx'];source['changedParentFiles']=[n for n,v in b['files'].items()if source['files'][n]!=v];Path('/private/tmp/willyou-dev177-source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
with tarfile.open('/private/tmp/willyou-dev177-source.tar.gz','w:gz')as t:
 for n in source['changedParentFiles']+source['newFiles']:t.add(n,arcname=n)
out=ev/'acceptance-media-controls-dev177-r105';out.mkdir(exist_ok=True);art={}
def add(p,name=None):
 p=Path(p);name=name or p.name;b=p.read_bytes();gz=len(b)>1024*1024 and p.suffix in['.json','.log'];q=out/(name+'.gz'if gz else name)
 if gz:q.write_bytes(gzip.compress(b,mtime=0))
 else:shutil.copy2(p,q)
 art[q.name]={'path':str(q.relative_to(root)),'sha256':h(q),'bytes':q.stat().st_size,**({'compression':'gzip','originalSha256':h(p)}if gz else{})}
for folder in sorted(list(Path('/private/tmp').glob('willyou-media-controls-A-*'))+list(Path('/private/tmp').glob('willyou-media-controls-P-*'))):
 if(folder/'result.json').exists():
  for f in folder.iterdir():
   if f.is_file():add(f,folder.name+'-'+f.name)
for f in Path('/private/tmp').glob('willyou-dev177-*'):
 if f.is_file()and f.name!='willyou-dev177-cases-before.json'and not f.name.endswith('archive-result.json'):add(f)
for f in Path('/private/tmp/willyou-dev177-before').iterdir():
 if f.is_file():add(f,'before-'+f.name)
fixtures=json.load(open(A['manifest']));add(A['manifest'],'fixtures-used.json')
for row in fixtures['cases']:
 f=Path(fixtures['projectPath'])/row['name'];assert h(f)==row['sha256'];add(f,'source-'+row['name'])
add(parent);add(base/'调研/M9_文件类型与编辑状态全集.md','reference-D15-D17.md')
r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','caseIds':['M9-T-T24','M9-T-T28','M9-T-T29'],'revision':'R3.4-P1','requirements':['M9-R06.12'],'branch':'feature/0.0.1','head':'89de9af4b631abdef5673ce8949fb02a32f6fcad','environment':{'platform':'macOS','version':platform.mac_ver()[0],'arch':platform.machine(),'data':'Own ffmpeg testsrc2/anullsrc silent H264/AAC and MPEG4/AAC, 30s video; copied same-byte second path and PCM WAV native-I control. No user media/model/PTY/clipboard/picker/external App/current Codex access.'},'app':{'path':'/private/tmp/willyou-m9-acceptance-batch-r105-build/mac-arm64/WillYou.app','asarSha256':rt['asarSha256'],'runtimeFiles':81,'build':'New full build/same packaging/afterPack/native sixsmoke passed. No release.'},'results':{'code':23,'newComponentTests':4,'realNativeI':2,'uniqueVitest':25,'prototypeBuild':'passed','sites':4,'typecheck':'passed','appFullChecks':36,'prototypeFullChecks':34,'appFocusLeaveT24':4,'prototypeFocusLeaveT24':4,'realRateSamples':16,'prototypeSimulatedSamples':16,'realUnsupportedCodecFailures':2,'rpcAudit':rpc,'sourceInputs':1401,'finalOwnAppsNormalExit':4,'remainingOwnApps':processes},'coverage':{'passedBefore':287,'passedAfter':290,'currentTotal':419,'percentage':round(290/419*100,2),'unexecuted':126,'blocked':3,'futureOnly':6,'total':425,'newPassed':['M9-T-T24','M9-T-T28','M9-T-T29']},'fixes':['DEV177-OBS01: controlled volume/mute now synchronously retain requested React state while updating native media properties, and still accept external native volumechange. Native event-delayed component red/green and actual rapid input observed.','DEV177-OBS02: prototype speed control exposes actual eight menuitemradio choices/check state rather than select; volume zero uses same existing Lucide muted icon logic. Synthetic timing remains explicit.'],'evidenceScopes':['T24 A/P light/dark >3.05played seconds, below-frame controls visible, native controls false in A, no Copy link; strengthened with both pointer and real Tab focus outside viewer before interval.','T28 A/P light/dark0/.5/1,mute,.01unmute/popover reopen, previous file volume0 versus fresh other file default. A nativevolume1default/P preexisting synthetic.75default separately recorded, no all-state pixel equality.','T29 all8rates light/dark: A actual playbackRate + exactly one checked radio + real currentTime/wallclock progress and decoded frames; maximum measured time error is in rpcAudit. Two genuine unsupported MPEG4 video cases show explicit errors. P uses original simulation, no actual codec claim.','I actual original Swift/FileService/media binary capabilities: all4fixtures full bytes/hash and owner/release checks, native2tests. A original protocol grants match source hashes and actual decoded clip; no browser fetch added because connect-src excludes media scheme.','Full A r105; full P34 used r104 only as shell for unchanged served P source, T24P supplement used r105. P sources same reviewed update; no P result classified as real App native playback.'],'history':['Initial new U test incorrectly reopened still-open Menu.RadioItem popup; installed primary-source default closeOnClick=false confirmed, corrected test only.','Initial Home/focus/track-click/instant-drag probes did not reach expected slider values; retained logs/source variants. Home cause unclassified, event not prevented; no claim Home/instant drag passed.','r104 focused rapid native arrows left volume.99, and deterministic delayed-volumechange U failed UIvalue0 versus requested.9. Production state update fixes pending-native-feedback race; new r105full36passed.','Range rewind tracks can hit thumb without moving. Final external driver uses focused platform-native arrow steps to exact endpoints; values/native properties explicitly checked, no DOM/media setter injection.','CSP source inspection excluded an extra browser fetch probe before any such execution; native complete-byte I and original App protocol/grant/decoder evidence used.','After full pass, strengthened T24 alone with focus/pointer outside; did not repeat passed volume/rate matrices. Original partial failures and source snapshots retained.'],'sourceSnapshot':{'manifest':'willyou-dev177-source.json','delta':'willyou-dev177-source.tar.gz','prebuild':'willyou-dev177-prebuild-source.json','parentInputs':1395,'changed':source['changedParentFiles'],'new':source['newFiles']},'parent':{'path':str(parent.relative_to(root)),'sha256':h(parent)},'limits':['R uses existing reviewed D15/D16/D17 static facts, no fresh Codex dynamic or pixel comparison.','U decoder/native-event scheduling isolated; native I binary bytes separate from A protocol/decoder. P timing synthetic; no PiP/fullscreen/real terminal key focus claim.','T19 actual raw0 and other media/system/reference/platform cases remain original scope. Human/environment blockers T32/T34/Y29 unchanged. M9 incomplete, unpublished.'],'artifacts':art,'releasePerformed':False}
f=ev/'m9-acceptance-media-controls-dev177-r105-20261020.json';f.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(f.relative_to(root)),'sha256':h(f),'artifacts':len(art),'progress':'290/419 (69.21%)'},ensure_ascii=False))

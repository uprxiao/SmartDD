from pathlib import Path
import json,hashlib,gzip,shutil,datetime,subprocess,tarfile
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';ev=base/'验收/证据';h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();run=json.load(open('/private/tmp/willyou-dev175-final-ui.json'));assert len(run['rows'])==3 and all(x['code']==0 for x in run['rows'])
def result(log):
 row=json.loads(Path(log).read_text().splitlines()[-1]);p=Path(row['artifacts'])/'result.json';return p,json.loads(p.read_text())
ac,clamp=result('/private/tmp/willyou-dev175-r102-clamp.log');an,nav=result('/private/tmp/willyou-dev175-r102-navigation.log');az,zoom=result('/private/tmp/willyou-dev175-r102-controls.log');pn=Path('/private/tmp/willyou-pdf-navigation-P-lgxNWk/result.json');pc=Path('/private/tmp/willyou-pdf-clamp-YWkpVB/result.json');Pnav=json.loads(pn.read_text());Pclamp=json.loads(pc.read_text());runtime=json.load(open('/private/tmp/willyou-dev175-runtime-r102.json'));assert runtime['verified']==81
for r in[clamp,nav,zoom]:assert r['asarSha256']==runtime['asarSha256']
for n in[nav,Pnav]:
 assert n['status']=='observed'and len(n['checks'])==18 and n['exit']['code']==0 and n['navigationObserverRestored']
 checks=[x for x in n['checks']if x['caseId']=='M9-T-T08'];assert len(checks)==12
 for x in checks:
  if 'timeline'in x:assert len(x['intermediatePositions'])>1 and x['after']['current']=='第 '+x['scenario'].split()[1]+' 页'
  if 'agrees'in x:assert x['agrees'] and x['after']['current']=='第 '+str(x['expected'])+' 页'
  if 'reopened'in x:assert x['beforeClose']['current']==x['reopened']['current']=='第 2 页'
  if x['scenario'].startswith('user scroll'):assert x['after']['scrollTop']==0 and x['after']['current']=='第 1 页'
 assert n['before']==n['after'] and n['rendererErrors']==[]
for n in[clamp,Pclamp]:assert n['status']=='passed'and len(n['checks'])==2 and n['before']==n['after']and all(x['code']==0 for x in n['apps'])
for x in clamp['checks']:assert x['prepared']['accepted'] and x['prepared']['state']['routes'][0]['pdf']['page']==99 and x['clamped']['state']['routes'][0]['pdf']['page']==3 and x['beforeScroll']['current']=='第 3 页' and x['afterScroll']=={'top':0,'current':'第 1 页'}
for x in Pclamp['checks']:assert x['clamped']['state']['page']==3 and x['afterScroll']['state']['page']==1 and x['afterScroll']['top']==0
assert zoom['status']=='passed'and len(zoom['checks'])==22 and zoom['before']==zoom['after']and zoom['exit']['code']==0
assert all(nav['rpcRestored'].values())and all(zoom['rpcRestored'].values())
assert '58 passed (58)'in Path('/private/tmp/willyou-dev175-virtual-final2.log').read_text();assert '11 passed (11)'in Path('/private/tmp/willyou-dev175-native-tabs.log').read_text()
# Only this round's private App paths are returned; no unrelated process details.
processes=[]
for line in subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines():
 parts=line.strip().split(None,1)
 if len(parts)==2 and any(parts[1].startswith('/private/tmp/willyou-m9-acceptance-batch-'+v+'-build/')for v in['r100','r101','r102']):processes.append({'pid':parts[0],'command':parts[1]})
assert not processes,processes
source=json.load(open('/private/tmp/willyou-dev175-source.json'));source['files']['scripts/files/pdf-restore-clamp-ui.mjs']=h('scripts/files/pdf-restore-clamp-ui.mjs');Path('/private/tmp/willyou-dev175-source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
for n,v in source['files'].items():assert h(n)==v,n
with tarfile.open('/private/tmp/willyou-dev175-source.tar.gz','w:gz')as t:
 for n in source['changedParentFiles']+source['newFiles']:t.add(n,arcname=n)
out=ev/'acceptance-pdf-navigation-dev175-r102';out.mkdir(exist_ok=True);art={}
def add(p,name=None):
 p=Path(p);name=name or p.name;b=p.read_bytes();compressed=len(b)>1024*1024 and p.suffix in['.log','.json'];q=out/(name+'.gz'if compressed else name)
 if compressed:q.write_bytes(gzip.compress(b,mtime=0))
 else:shutil.copy2(p,q)
 art[q.name]={'path':str(q.relative_to(root)),'sha256':h(q),'bytes':q.stat().st_size,**({'compression':'gzip','originalSha256':h(p)}if compressed else{})}
for folder in sorted(list(Path('/private/tmp').glob('willyou-pdf-navigation-*'))+list(Path('/private/tmp').glob('willyou-pdf-clamp-*'))):
 if(folder/'result.json').exists():
  for p in folder.iterdir():
   if p.is_file():add(p,folder.name+'-'+p.name)
for p in az.parent.iterdir():
 if p.is_file():add(p,az.parent.name+'-'+p.name)
for p in sorted(Path('/private/tmp').glob('willyou-dev175-*')):
 if p.is_file()and p.name not in['willyou-dev175-cases-before.json']and not p.name.endswith('archive-result.json'):add(p)
for p in Path('/private/tmp/willyou-dev175-before').iterdir():
 if p.is_file():add(p,'before-'+p.name)
parent=ev/'m9-acceptance-pdf-controls-dev174-r99-20261020.json';assert h(parent)=='7d1e9dd6723fb72ab2658761f6f13a04d3e8a23dc26d2128b22c7227b50058b4';add(parent)
report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','caseIds':['M9-T-T08'],'revision':'R3.4-P1','branch':'feature/0.0.1','head':'89de9af4b631abdef5673ce8949fb02a32f6fcad','environment':'macOS arm64, own private projects/profiles and known synthetic normal.pdf. No model/PTY/clipboard/systempicker/external App/current Codex access.','app':{'path':'/private/tmp/willyou-m9-acceptance-batch-r102-build/mac-arm64/WillYou.app','asarSha256':runtime['asarSha256'],'runtimeFiles':81,'build':'Full build/identical packaging/afterPack/new six native-smoke passed. No publish.'},'results':{'unitAndComponent':58,'newNavigationComponent':5,'realNativeSQLiteIntegration':11,'prototypeReadingModel':1,'typecheck':'passed','appNavigationT08':12,'appInitialClamp':2,'appControlsRegression':22,'appPartialT02T07Observations':6,'prototypeNavigationT08':12,'prototypeInitialClamp':2,'prototypePartialT02T07Observations':6,'appExit':'normal 0/null for final six own apps','sourceInputs':1392,'remainingOwnApps':processes},'fixes':['Original thumbnail scrollTop jump replaced with smooth scroll (reduced-motion uses auto).','Most-visible area replaces fixed top-offset probe, bounded to mounted body pages.','After virtual page commit, reconcile visible page; this fixes large user scroll from restored page3 to page1 keeping old label.','Unit-proven hidden-layout restoration guard retains initial reading hint until usable layout; not claimed as the cause of the actual large-scroll failure.'],'reference':{'source':'Existing archived D05 in 调研/M9_文件类型与编辑状态全集.md; reviewed R06.5; no new/current Codex runtime evidence.'},'scope':{'passedBefore':285,'passedAfter':286,'currentTotal':419,'percentage':round(286/419*100,2),'unexecuted':130,'blocked':3,'futureOnly':6,'total':425,'onlyStatusChanged':'M9-T-T08'},'history':['r99 actual light/dark no smooth intermediates and wrong most-visible page; first two new component red tests retained.','r100/r101 cold restoration reached page3; failures were the subsequent user scroll leaving page label3 at top0. Initial commentary mislocated the failure; corrected in this round.','Optional original scrollTop accessor trace produced no trace data; no causal conclusion derived from it.','Hidden-layout unit red independently reproduced consumed restore hint; guard green. Virtual-commit unit red then final 58 green.','First P fixed-frame probe sent wheel before prior smooth animation finished; stable actual scroll/layout waits fix driver precondition.','First r102 already passed scoped post-scroll condition, but unscoped final aria-current read selected 项目设置; PDF-scoped selector fixed, same package rerun.','Initial test-only P branch syntax check corrected before execution. First sandbox build failed at macOS codesign verification; preserved log and normal-system-service retry passed.'],'limits':['T02 full keyboard/control conditions and T07 focus/hidden panel semantics remain unexecuted; their six observations per layer are partial only. Escape from actual focused zoom trigger remains unresolved.','P native file IO not claimed; initial-page props forwarded by existing isolated r34 harness only, default behavior unchanged.','R existing static archive only; no full Codex pixel equality, system input or cross-platform claim.','Three human/environment blockers T32/T34/Y29 unchanged. M9 incomplete and unpublished.'],'parent':{'path':str(parent.relative_to(root)),'sha256':h(parent)},'sourceSnapshot':{'manifest':'willyou-dev175-source.json','delta':'willyou-dev175-source.tar.gz','parentInputs':1389,'changed':source['changedParentFiles'],'new':source['newFiles']},'artifacts':art,'releasePerformed':False}
p=ev/'m9-acceptance-pdf-navigation-dev175-r102-20261020.json';p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(p.relative_to(root)),'sha256':h(p),'artifacts':len(art),'progress':'286/419 (68.26%)'},ensure_ascii=False))

from pathlib import Path
import json,hashlib,shutil,datetime,re,difflib
S=Path('/private/tmp/willyou-m12-t146-tooltip-software-App037-build-safe-001');assert not S.exists();S.mkdir(mode=0o700);h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();refs=[];index=[];manifests={};software=[]
def put(n,v):
 p=S/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def cp(p,n):
 p=Path(p);q=S/n;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'safeCopy':n})
def ref(p,purpose):
 p=Path(p);refs.append({'path':str(p),'sha256':h(p),'bytes':p.stat().st_size,'purpose':purpose})
allow=['src/renderer/features/browser/workspace.tsx','src/renderer/features/browser/workspace.css','src/renderer/features/browser/tab-tooltip.tsx','src/renderer/features/browser/tab-tooltip.test.tsx','src/renderer/features/browser/workspace.test.tsx','src/renderer/features/files/tree-path-tooltip.tsx','src/renderer/features/files/workspace-panel.tsx','src/main/core/browser/workspace.ts','src/main/core/browser/controller.ts','src/main/core/browser/__tests__/workspace.test.ts','prototypes/m6-codex/src/FileWorkspace.jsx','prototypes/m6-codex/src/browser.css','prototypes/m6-codex/vite.config.mjs']
for rev in ['041','042','043','044']:
 R=Path('/private/tmp/willyou-m12-tab-tooltip-source-'+rev);m=json.loads((R/'source-inputs.json').read_text());manifests[rev]=m;cp(R/'source-inputs.json','source'+rev+'/source-inputs.original.json')
 for rel in allow:
  p=R/'source'/rel
  if p.is_file():
   assert h(p)==m['files'][rel],str(p);assert p.stat().st_mode&511==m['modes'][rel];name='source-files/by-sha/'+h(p)+p.suffix
   if not (S/name).exists():cp(p,name)
   index.append({'revision':rev,'relativePath':rel,'safeStoredPath':name,'sha256':h(p),'mode':p.stat().st_mode&511})
 row={'revision':rev,'manifestSHA256':h(R/'source-inputs.json'),'manifestScope':m['scope'],'sourceFiles':len(m['files']),'logs':[]}
 for n in ['software-001.log','typecheck-001.log','prototype-m9-001.log','prototype-build-001.log','prototype-vite-build-001.log']:
  p=R/n
  if not p.is_file():continue
  # These named public software/prototype logs are distinct from private full official build logs.
  assert '.private.' not in p.name;cp(p,'source'+rev+'/software/'+n);text=p.read_text();cwd=re.search(r'^> [^\n]* (/(?:Users|private)/[^\n]*)$',text,re.M)
  summary={'file':n,'sha256':h(p),'bytes':p.stat().st_size,'actualCwdPrinted':cwd.group(1) if cwd else None,'actualDurationPrinted':re.findall(r'(?:Duration\s+[^\n]+|# duration_ms [^\n]+|built in [^\n]+)',text),'testsLines':[l for l in text.splitlines() if re.search(r'^\s*(?:Test Files|Tests|# tests|# pass |# fail |# skipped|# cancelled|# todo|1\.\.)',l)],'firstFailureSignatures':[l for l in text.splitlines() if any(x in l for x in ['FAIL  ','AssertionError:','vite: command not found','ELIFECYCLE'])]}
  if rev=='041' and n=='software-001.log':assert summary['actualCwdPrinted']=='/Users/liubu/hx/4.uprxiao/SmartDD';summary['boundary']='First actual software lane ran in repo cwd, not frozen clone; original red31pass/1fail retained. Do not claim isolated clone execution.'
  if n=='typecheck-001.log':summary['typecheckBoundary']='Original command is nodeTS&&webTS; coordinator reports both exited0. File contains command and no error diagnostics, not a fabricated standalone exit receipt.'
  row['logs'].append(summary)
 software.append(row)
# Preserve exact sequential frozen-source changes, no git commands or moving workspace reads.
transitions=[]
for a,b in [('041','042'),('042','043'),('043','044')]:
 ma,mb=manifests[a],manifests[b];changed=[p for p in set(ma['files'])|set(mb['files']) if ma['files'].get(p)!=mb['files'].get(p) or ma['modes'].get(p)!=mb['modes'].get(p)];transitions.append({'from':a,'to':b,'allManifestSHAOrModeChanges':sorted(changed),'scopeFromFrozenManifest':mb['scope']})
 for rel in allow:
  pa=Path('/private/tmp/willyou-m12-tab-tooltip-source-'+a)/'source'/rel;pb=Path('/private/tmp/willyou-m12-tab-tooltip-source-'+b)/'source'/rel
  if pa.is_file() and pb.is_file() and h(pa)!=h(pb):
   name='source-diffs/'+a+'-'+b+'/'+rel.replace('/','__')+'.diff';p=S/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(''.join(difflib.unified_diff(pa.read_text().splitlines(True),pb.read_text().splitlines(True),fromfile='source'+a+'/'+rel,tofile='source'+b+'/'+rel)))
put('software/result.safe.json',{'lanes':software,'transitions':transitions,'firstRed':'Source041 actual31green/1red at obsolete acknowledgement after switching tabs. Preserve exact original expected page1/received page2 assertion and source.','subsequentFixScope':'Source042 manifest identifies synchronous model-owned candidate invalidation on task/page/title change; exact tree-path-tooltip and model wiring diffs retained. This is software/candidate race regression coverage, not proof of original App036 tooltip root cause.','results':{'041':'32selected:31passed/1failed; actualcwdrepo','042':'32selectedpassed + nodeTS/webTS coordinator-reported actual green','043':'73softwarepassed/14files;297prototype modelspassed;nodeTS/webTS actualgreen;prototype pnpm build precondition failed missingvite','044':'Same043production software/types by exact unchanged source reuse; actualprototypeVitebuild green8.34s, no claim73/297/types rerun'},'formalIncrement':0,'wholeT146Passed':False})
put('source-files/index.json',{'files':index,'scope':'Only explicit relevant frozen source list; complete source manifest eachrevision retained. Large duplicate bytes stored once. No root worktree/git command or moving files used.'})
builds=[]
for attempt in ['001','002']:
 R=Path('/private/tmp/willyou-m12-tab-tooltip-App037-build-'+attempt);r=json.loads((R/'result.json').read_text());assert r['sourceManifestSHA256']==h(Path('/private/tmp/willyou-m12-tab-tooltip-source-044/source-inputs.json'))
 for n in ['result.json','run.py','lease.receipt.json','started.json']:
  if (R/n).is_file():cp(R/n,'build'+attempt+'/'+n)
 log=R/'official-App037-directory.private.log';ref(log,'Full original private build log SHA only, never copied');lines=log.read_text().splitlines();jsonrows=[]
 for i,line in enumerate(lines):
  try:v=json.loads(line)
  except (ValueError,TypeError):continue
  if isinstance(v,dict) and all(k in v for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher']):jsonrows.append({'line':i+1,'json':v,'originalLineSHA256':hashlib.sha256(line.encode()).hexdigest()})
 if attempt=='002':assert len(jsonrows)==1 and all(jsonrows[0]['json'][k]=='passed' for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
 else:assert not jsonrows
 signatures=[{'line':i+1,'text':l} for i,l in enumerate(lines) if re.search(r'invalid signature|CalledProcessError:|Build failed in|^error during build:|\[smartdd-native-bridges\].*failed|^Error: .*exited with 1',l,re.I)]
 out={'attempt':attempt,'originalLog':{'path':str(log),'sha256':h(log),'bytes':log.stat().st_size,'fullLogPublic':False},'actualBuildCwd':r['actualBuildCwd'],'exitCode':r['exitCode'],'startedAt':r['startedAt'],'finishedAt':r['finishedAt'],'elapsedTotalSeconds':(datetime.datetime.fromisoformat(r['finishedAt'])-datetime.datetime.fromisoformat(r['startedAt'])).total_seconds(),'phases':r['phases'],'actualFailureSignatureLines':signatures,'nativeSmokeJSONRows':jsonrows,'sourceBeforeAfterEvidence':{'before':r['before'],'phaseSourceAfter':[p['sourceAfter'] for p in r['phases']],'sourceShaModeBeforeAfterMatched':r.get('sourceShaModeBeforeAfterMatched')},'pins':r.get('pins'),'inputManifest':'source044/source-inputs.original.json','sourceManifestSHA256':r['sourceManifestSHA256'],'noSeparateBuildManifestInvented':True,'causalBoundary':'Original vendor codesign signature failure line recorded in001;002lease reports exact same verify passed outside restricted sandbox and signature requirement unchanged. This archive preserves receipt/source/signature evidence, does not establish a broader product or OS root cause.','scope':'Official arm64 directory build/native smoke only; no App A/installed S6/x64/release/wholeT146 pass.'};put('build'+attempt+'/log-extract.safe.json',out);builds.append(out)
assert builds[0]['exitCode']==1 and builds[1]['exitCode']==0
cp(Path(__file__),'project-software-build-safe.py');put('result.safe.json',{'scope':'T146 controlled tooltip software/prototype + officialApp037 build evidence only','softwareRevisionSequence':['041red','04232green+types','04373green+297models+types/prototypepnpmViteMissing','044prototypeVitebuildgreen8.34s'],'buildAttempts':[{'attempt':v['attempt'],'exitCode':v['exitCode'],'phaseSeconds':[p['seconds'] for p in v['phases']],'nativeSmokeCount':len(v['nativeSmokeJSONRows'])} for v in builds],'wholeT146Passed':False,'AppAAndS6Scope':'Separate actualApp037 A002 still active per coordinator, not read or claimed in this projection.','formalIncrement':0,'resourcesHeldByProjector':False})
put('provenance.json',{'schema':'M12-safe-projection-v1','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'safeRoot':str(S),'operation':'Pure Python filesystem copy/hash/extract/diff only. No Node/OS/App/compiler/Native/new test or public document edits; no git commands.','originalWholeFiles':refs,'originalsModified':False,'excluded':['App/binaries/SDKcache/allcache','DB/auth/private data','Full original private official build logs','Moving current App037 A002 runtime'],'cwdBoundary':'source041 software original actualcwdrepo and both officialbuild actualcwdrepo retained as recorded; source042/043 log cwd frozen clones. No claim allsoftware ran isolated.','outcomeBoundary':'Software/test/build successes do not prove actual visible tooltip, original App036 failure root cause or wholeT146 passed.'})
members=[{'path':str(p.relative_to(S)),'sha256':h(p),'bytes':p.stat().st_size,'mode':p.stat().st_mode&511} for p in sorted(S.rglob('*')) if p.is_file()];put('manifest.json',{'schema':'M12-safe-manifest-v1','safeRoot':str(S),'members':members,'wholeT146Passed':False,'formalIncrement':0})
for f in members:assert h(S/f['path'])==f['sha256']
print(json.dumps({'safeRoot':str(S),'manifestSHA256':h(S/'manifest.json'),'provenanceSHA256':h(S/'provenance.json'),'resultSHA256':h(S/'result.safe.json'),'files':len(members),'resources':0}))

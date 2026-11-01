import hashlib,json,os,signal,subprocess,time
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path('/private/tmp/willyou-m11-s1a')
EVIDENCE=ROOT/'evidence/composition-remainder-preparation/attempt-001'
FILES=['config-view-registry.test.ts','connection-service.test.ts','selection-service.test.ts','application-impact.test.ts','business-data.test.ts','mail-read-data.test.ts','mail-send-data.test.ts','zentao-data.test.ts']
EXPECTED={'001':'954678b2cb036b2808439c1159a10d3c31249f9dd57c3f82c910e9aa4a1ebf77','003':'74d2d7b7dc4e5ca376620f3b1624a14198cf26e0b857bc92a44dcfe1cc081f1a'}
def now():return datetime.now(timezone.utc).isoformat()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def dump(name,data):(EVIDENCE/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def source_check(n):
 manifest=ROOT/f'source-manifest-attempt-{n}.json';assert sha(manifest)==EXPECTED[n]
 data=json.loads(manifest.read_text());source=ROOT/f'source-attempt-{n}'
 bad=[f['path'] for f in data['files'] if not (source/f['path']).exists() or (source/f['path']).stat().st_size!=f['bytes'] or sha(source/f['path'])!=f['sha256']]
 return {'manifestSha256':sha(manifest),'sourceFileCount':len(data['files']),'mismatches':bad}
def dependencies():
 old=json.loads((ROOT/'evidence/composition/attempt-001/dependencies-before.json').read_text())
 return [{'path':x['path'],'size':Path(x['path']).stat().st_size,'mode':Path(x['path']).stat().st_mode&511,'sha256':sha(x['path'])} for x in old['files'] if '/node_modules/' in x['path']]

before={n:source_check(n) for n in EXPECTED};assert all(not x['mismatches'] for x in before.values());deps_before=dependencies()
dump('inputs-before.json',{'at':now(),'source':before,'sharedDependencies':deps_before})
commands=[]
for n in EXPECTED:
 source=ROOT/f'source-attempt-{n}'
 electron=subprocess.check_output(['node','-p','require("electron")'],cwd=source,text=True).strip()
 argv=[electron,str(source/'node_modules/vitest/vitest.mjs'),'list',*['src/main/core/applications/__tests__/'+f for f in FILES],'--json='+str(EVIDENCE/f'collection-source{n}.json'),'--maxWorkers=1','--no-file-parallelism','--no-cache','--configLoader=runner','--includeTaskLocation']
 env=os.environ.copy();env['ELECTRON_RUN_AS_NODE']='1';started=now();clock=time.monotonic();expired=False
 with (EVIDENCE/f'collection-source{n}.log').open('w') as out:
  p=subprocess.Popen(argv,cwd=source,env=env,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
  record={'source':str(source),'argv':argv,'environmentOverrides':{'ELECTRON_RUN_AS_NODE':'1'},'startedAt':started,'pid':p.pid,'pgid':p.pid,'outerSeconds':60,'collectionOnly':True,'testCallbacksOrHooksRequested':False}
  dump(f'command-source{n}.json',record)
  try:code=p.wait(timeout=60)
  except subprocess.TimeoutExpired:
   expired=True;os.killpg(p.pid,signal.SIGTERM)
   try:code=p.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);code=p.wait()
 record.update({'exitCode':code,'outerExpired':expired,'seconds':round(time.monotonic()-clock,3),'finishedAt':now()})
 try:os.killpg(p.pid,0);record['groupState']='present'
 except ProcessLookupError:record['groupState']='absent'
 except PermissionError:record['groupState']='unverified-permission'
 commands.append(record);dump(f'command-source{n}.json',record);print(json.dumps({'source':n,'exitCode':code,'seconds':record['seconds'],'groupState':record['groupState']}),flush=True)
 if code!=0 or expired:break
after={n:source_check(n) for n in EXPECTED};deps_after=dependencies();dump('inputs-after.json',{'at':now(),'source':after,'sharedDependencies':deps_after})
result={'schema':'m11-s1a-collection-preparation-v1','at':now(),'commands':commands,'sourceBefore':before,'sourceAfter':after,'dependenciesUnchanged':deps_before==deps_after,'allCollectionCommandsSucceeded':len(commands)==2 and all(x['exitCode']==0 and not x['outerExpired'] for x in commands),'testExecutions':0,'formalM11NewPassed':0}
dump('collection-result.json',result);dump('cleanup.json',{'at':now(),'collectionProcesses':[{'pid':x['pid'],'pgid':x['pgid'],'groupState':x['groupState']} for x in commands],'resourcesReleased':all(x['groupState']=='absent' for x in commands),'testCallbacksExecuted':False,'observationHooks':[]})
print(json.dumps({'allCollectionCommandsSucceeded':result['allCollectionCommandsSucceeded'],'sourceMismatches':{n:d['mismatches'] for n,d in after.items()},'dependenciesUnchanged':result['dependenciesUnchanged']}),flush=True)

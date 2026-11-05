from pathlib import Path
import json,subprocess,os,time,datetime,hashlib
r=Path(__file__).parent;pin=json.loads((r/'pin.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();assert sha(r/'probe.mjs')==pin['probeSha256'];assert sha(Path(pin['executable']))==pin['executableSha256'];assert sha(Path(pin['framework']))==pin['frameworkSha256'];assert json.loads(Path('/private/tmp/willyou-m12-p092-fixed-coalition-long-002/coordinator-cleanup.json').read_text())['allClear'];rows=[]
for label,mode,count in [('smoke-original','original-unique-source',1000),('original','original-unique-source',10000),('stable','stable-argument-source',10000),('direct','direct-js',10000)]:
 private=r/label
 for x in ['home','tmp','cache']:(private/x).mkdir(parents=True,exist_ok=True)
 env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','HOME':str(private/'home'),'TMPDIR':str(private/'tmp'),'XDG_CACHE_HOME':str(private/'cache'),'NODE_COMPILE_CACHE':str(private/'cache/node'),'ELECTRON_RUN_AS_NODE':'1','LANG':'en_US.UTF-8'};args=[pin['executable'],str(r/'probe.mjs'),mode,str(r/(label+'.json')),str(count)];started=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic()
 with(r/(label+'.stdout.log')).open('w') as out,(r/(label+'.stderr.log')).open('w') as err:
  p=subprocess.Popen(args,cwd=r,env=env,stdout=out,stderr=err);row={'label':label,'mode':mode,'count':count,'pid':p.pid,'startedAt':started,'command':args,'signals':[]};rows.append(row);(r/'live.json').write_text(json.dumps({'rows':rows},indent=2)+'\n');print('owned fresh self-inspector PID '+str(p.pid)+' '+label,flush=True)
  try:code=p.wait(timeout=120)
  except subprocess.TimeoutExpired:
   row['signals'].append('SIGTERM');p.terminate()
   try:code=p.wait(timeout=5)
   except subprocess.TimeoutExpired:row['signals'].append('SIGKILL');p.kill();code=p.wait(timeout=5)
 row.update(exitCode=code,seconds=time.monotonic()-t,closed=True)
 if (r/(label+'.json')).exists():
  result=json.loads((r/(label+'.json')).read_text());row['status']=result['status'];row['checks']=result['checks'];row['observedVersions']={k:result['versions'].get(k) for k in ['electron','node','v8']}
  for k in ['electron','node','v8']:
   expected=pin['expectedAppVersions'].get(k)
   if expected is not None:assert result['versions'].get(k)==expected,(k,expected,result['versions'].get(k))
 (r/'live.json').write_text(json.dumps({'rows':rows},indent=2)+'\n');print(json.dumps(row),flush=True)
 assert code==0 and not row['signals'] and row.get('status')=='executed-unjudged-lab-only',row
 assert all(row['checks'].get(k) for k in ['pendingPromiseMapEmpty','allSyntheticValuesCorrect','sessionDisconnected','noListeningInspector'])
 assert sha(r/'probe.mjs')==pin['probeSha256']
(r/'result.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':rows,'status':'lab-executed-unjudged','formalCaseCredit':0,'scope':'All fresh owned exact App020 RunAsNode self-inspector processes; no browser App/model. Original P092 already terminated/clean before diagnostics; forceGC only after primary checkpoints in each lab worker.'},indent=2)+'\n')

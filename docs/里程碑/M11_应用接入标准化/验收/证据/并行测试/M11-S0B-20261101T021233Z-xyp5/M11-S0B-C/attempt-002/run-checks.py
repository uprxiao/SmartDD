import subprocess,time,json,os,signal,re,hashlib,sys
from pathlib import Path
from datetime import datetime,timezone
root=Path('/private/tmp/willyou-m11-s0b-xyp5tfp9')
source=root/'source-attempt-002'; evidence=root/'evidence/composition/attempt-002'
def stamp():return datetime.now(timezone.utc).isoformat()
commands=[('typecheck',['pnpm','typecheck'],300),('task-capability-launcher',['pnpm','test','src/main/core/applications/__tests__/task-capability-launcher.test.ts','--maxWorkers=1','--no-file-parallelism','--no-cache'],900),('build-contract',['node','--test','scripts/applications/build.test.mjs'],180)]
results=[]
(evidence/'runner.json').write_text(json.dumps({'pid':os.getpid(),'startedAt':stamp(),'source':str(source)},indent=2)+'\n')
for name,argv,limit in commands:
  start=time.monotonic(); at=stamp(); log=evidence/(name+'.log')
  with log.open('w') as out:
    process=subprocess.Popen(argv,cwd=source,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
    (evidence/'current-command.json').write_text(json.dumps({'name':name,'pid':process.pid,'pgid':process.pid,'argv':argv,'startedAt':at},indent=2)+'\n')
    timeout=False
    try:code=process.wait(timeout=limit)
    except subprocess.TimeoutExpired:
      timeout=True;os.killpg(process.pid,signal.SIGTERM)
      try:process.wait(timeout=8)
      except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
      code=process.returncode
  text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',log.read_text(errors='replace'))
  summaries=[line.strip() for line in text.splitlines() if re.search(r'Test Files|Tests\s|^# (tests|pass|fail|skipped|duration_ms)',line)]
  value={'name':name,'argv':argv,'cwd':str(source),'startedAt':at,'finishedAt':stamp(),'seconds':round(time.monotonic()-start,3),'pid':process.pid,'exitCode':code,'timeout':timeout,'log':log.name,'summary':summaries}
  results.append(value)
  (evidence/(name+'-result.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
  print(json.dumps(value,ensure_ascii=False),flush=True)
manifest=json.loads((root/'source-manifest-attempt-002.json').read_text())
bad=[name for name,digest in manifest['files'].items() if not (source/name).exists() or hashlib.sha256((source/name).read_bytes()).hexdigest()!=digest]
result={'schema':'m11-s0b-composition-result-v1','group':'M11-S0B-C','sourceManifestSha256':hashlib.sha256((root/'source-manifest-attempt-002.json').read_bytes()).hexdigest(),'checks':results,'sourceFileCount':len(manifest['files']),'sourceMismatches':bad,'formalM11NewPassed':0,'status':'passed' if all(item['exitCode']==0 and not item['timeout'] for item in results) and not bad else 'failed','finishedAt':stamp(),'notes':['Private frozen source; no production or authority-ledger modifications.','task-capability-launcher uses version shell fixtures, no real additional Agent.','--no-cache avoids Vitest result cache writes through shared node_modules.']}
(evidence/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'result':str(evidence/'result.json'),'sourceMismatches':bad}),flush=True)

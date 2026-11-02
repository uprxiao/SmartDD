from pathlib import Path
import json,hashlib,datetime,os,subprocess,time,sys
out=Path('/private/tmp/willyou-m11-c23-2637/software-diagnosis-main-ci/attempt002');phase=sys.argv[1];source=out/('source-'+phase);phaseout=out/phase;phaseout.mkdir(exist_ok=True)
name='src/main/core/applications/__tests__/task-capability-launcher.test.ts'
pattern='stops only project A calls, preserves project B and reaps all reference MCP children on host disposal' if phase=='corrected' else 'controlled B bridge exit exposes pending lease until managed completion'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(n,v):(phaseout/n).write_text(json.dumps(v,ensure_ascii=True,indent=2)+'\n')
assert not (phaseout/'execution.json').exists(),'Never rerun a started phase'
before=sha(source/name);env={**os.environ,'WILLYOU_TEST_CACHE_DIR':str(out/('cache-'+phase)),'COREPACK_ENABLE_NETWORK':'0'}
if phase=='barrier':env['WILLYOU_S7_BARRIER_OBSERVATION']=str(phaseout/'barrier-observation.json')
argv=['pnpm','test',name,'--config','vitest.probe.config.ts','--maxWorkers=1','--testNamePattern',pattern,'--reporter=json','--outputFile='+str(phaseout/'vitest.json'),'--reporter=verbose']
start=time.monotonic();timeout=False
with (phaseout/'test.log').open('wb') as log:
 p=subprocess.Popen(argv,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 e={'argv':argv,'cwd':str(source),'pid':p.pid,'processGroup':p.pid,'startedAt':now(),'outerBudgetSeconds':180,'originalTestTimeoutMs':30000,'phase':phase};write('execution.json',e);print(json.dumps({'event':'started',**e}),flush=True)
 try:code=p.wait(timeout=180)
 except subprocess.TimeoutExpired:
  timeout=True;os.killpg(p.pid,15)
  try:code=p.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(p.pid,9);code=p.wait()
e.update({'exitCode':code,'timedOut':timeout,'elapsedSeconds':round(time.monotonic()-start,3),'finishedAt':now()});write('execution.json',e)
report=json.loads((phaseout/'vitest.json').read_text()) if (phaseout/'vitest.json').is_file() else {};tests=[t for s in report.get('testResults',[]) for t in s.get('assertionResults',[])];selected=[t for t in tests if pattern in (t.get('fullName') or t['title'])];outside=[t for t in tests if t not in selected]
counts={'reportedTotal':report.get('numTotalTests'),'observed':len(tests),'selected':len(selected),'passed':sum(t['status']=='passed' for t in selected),'failed':sum(t['status']=='failed' for t in selected),'selectedNotExecuted':sum(t['status'] not in ('passed','failed') for t in selected),'filtered':len(outside),'outsideExecuted':sum(t['status'] in ('passed','failed') for t in outside)}
try:os.killpg(p.pid,0);alive=True
except ProcessLookupError:alive=False
write('cleanup.json',{'at':now(),'ownProcessGroup':p.pid,'ownProcessGroupStillExists':alive,'allOwnProcessesStopped':alive is False,'sourceTestHashBefore':before,'sourceTestHashAfter':sha(source/name),'sourceTestDrift':before!=sha(source/name),'publicOrOldSourcesModified':False})
write('result.json',{'status':'passed' if code==0 and len(selected)==1 and counts['passed']==1 and counts['outsideExecuted']==0 and not alive else 'failed','phase':phase,'execution':e,'counts':counts,'selected':selected,'publicTestCorrectionPhase':phase=='corrected','controlledFaultInjectionPhase':phase=='barrier','rawJsonUnmodified':True,'formalCasePassesAdded':0})
print(json.dumps({'event':'phase-complete','phase':phase,'exitCode':code,'elapsedSeconds':e['elapsedSeconds'],'counts':counts,'ownProcessGroupStillExists':alive},ensure_ascii=True),flush=True)

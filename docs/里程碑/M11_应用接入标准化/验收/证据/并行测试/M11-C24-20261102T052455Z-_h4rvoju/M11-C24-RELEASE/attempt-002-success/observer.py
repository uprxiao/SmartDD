"""Read-only bounded short-request observer. Does not mutate GitHub."""
import datetime,hashlib,json,os,subprocess,time
from pathlib import Path
P=Path('/private/tmp/willyou-m11-c24-v011-_h4rvoju/release-watch/attempt002');D=P/'snapshots';D.mkdir(exist_ok=True)
RUN='41399417380';HEAD='44b46ca42cc8fff192c4fd8ae051431f369a2b8b';REPO='uprxiao/SmartDD'
PREFIX=['env','-u','GH_TOKEN','-u','GITHUB_TOKEN','gh'];queries=[];saved_failures={125137046401};artifact_announced=True;last_artifact_query=0;last_state=None;errors=0
started=datetime.datetime.now(datetime.timezone.utc).isoformat();print(json.dumps({'stage':'short-api-observer-started','observerPid':os.getpid(),'pgid':os.getpgrp(),'runId':int(RUN),'expectedHead':HEAD,'startedAt':started}),flush=True)
def query(args,name):
    argv=PREFIX+args;q=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);at=datetime.datetime.now(datetime.timezone.utc).isoformat();timed=False
    try:out,err=q.communicate(timeout=25)
    except subprocess.TimeoutExpired:timed=True;q.kill();out,err=q.communicate()
    (P/name).write_bytes(out);(P/(name+'.stderr.log')).write_bytes(err)
    receipt={'argv':argv,'ghPid':q.pid,'pgid':q.pid,'at':at,'exitCode':q.returncode,'timedOut':timed,'path':name,'bytes':len(out),'sha256':hashlib.sha256(out).hexdigest()};queries.append(receipt);(P/'query-receipts.json').write_text(json.dumps(queries,indent=2)+'\n')
    if q.returncode:return None
    return json.loads(out) if name.endswith('.json') else out
initial=query(['api','repos/'+REPO+'/actions/runs/'+RUN],'initial-run-rest.json')
if not initial or initial.get('run_attempt')!=2 or initial.get('head_sha')!=HEAD:raise RuntimeError('Expected exact-head run_attempt2 not yet present')
print(json.dumps({'stage':'retry-attempt-confirmed','runAttempt':initial['run_attempt'],'head':initial['head_sha'],'status':initial['status']}),flush=True)
for i in range(1,181):
    name='snapshots/'+f'{i:03d}.json';r=query(['run','view',RUN,'--repo',REPO,'--json','databaseId,headSha,headBranch,status,conclusion,url,workflowName,createdAt,updatedAt,jobs'],name)
    if r is None:
        errors+=1;print(json.dumps({'stage':'transport-query-failed','consecutiveErrors':errors,'snapshot':i}),flush=True)
        if errors>=3:raise SystemExit(3)
        time.sleep(30);continue
    errors=0
    if r['headSha']!=HEAD:raise RuntimeError('Exact-head mismatch')
    (P/'latest-run.json').write_text(json.dumps(r,indent=2)+'\n')
    jobs=[{'id':j['databaseId'],'name':j['name'],'status':j['status'],'conclusion':j['conclusion'],'activeSteps':[s['name'] for s in j['steps'] if s['status']=='in_progress']} for j in r['jobs']]
    state=json.dumps(jobs,sort_keys=True)
    print(json.dumps({'stage':'state-change' if state!=last_state else 'heartbeat','snapshot':i,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':r['headSha'],'status':r['status'],'conclusion':r['conclusion'],'jobs':jobs if state!=last_state else None}),flush=True);last_state=state
    for j in r['jobs']:
        jid=j['databaseId']
        if j['status']=='completed' and j['conclusion']=='failure' and jid not in saved_failures:
            saved_failures.add(jid);log=query(['api','repos/'+REPO+'/actions/jobs/'+str(jid)+'/logs'],'failed-job-'+str(jid)+'.log');print(json.dumps({'stage':'failed-job-original-log','jobId':jid,'name':j['name'],'logSaved':log is not None}),flush=True)
    arm=[j for j in r['jobs'] if 'package (mac, arm64' in j['name']]
    arm_upload=any(any(s['name']=='Upload verified installers' and s['status'] in ('in_progress','completed') for s in j['steps']) for j in arm)
    now=time.monotonic()
    if not artifact_announced and arm_upload and now-last_artifact_query>=30:
        last_artifact_query=now;a=query(['api','repos/'+REPO+'/actions/runs/'+RUN+'/artifacts'],'artifacts-'+f'{i:03d}.json')
        if a:
            for item in a.get('artifacts',[]):
                if item['name']=='willyou-mac-arm64' and not item['expired']:
                    artifact_announced=True;(P/'mac-arm64-artifact.json').write_text(json.dumps(item,indent=2)+'\n');print(json.dumps({'stage':'mac-arm64-artifact-ready','artifact':item}),flush=True)
    if r['status']=='completed':
        result={'runId':int(RUN),'head':HEAD,'status':r['status'],'conclusion':r['conclusion'],'snapshots':i,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mutationCalls':0};(P/'observer-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'stage':'remote-run-completed',**result}),flush=True);raise SystemExit(0 if r['conclusion']=='success' else 1)
    time.sleep(30)
raise SystemExit(4)

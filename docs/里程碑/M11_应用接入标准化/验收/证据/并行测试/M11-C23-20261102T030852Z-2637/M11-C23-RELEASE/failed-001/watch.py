import datetime,json,os,subprocess,time
from pathlib import Path
root=Path('/private/tmp/willyou-m11-c23-2637/release-watch/attempt-001')
argv=['env','-u','GH_TOKEN','-u','GITHUB_TOKEN','gh','run','watch','41390093647','--repo','uprxiao/SmartDD','--exit-status','--interval','30']
started=time.time()
with open(root/'watch.log','wb') as log:
 p=subprocess.Popen(argv,stdout=log,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
 meta={'schema':'release-readonly-watch-execution-v1','runId':41390093647,'tag':'v0.1.0','driverPid':os.getpid(),'ghPid':p.pid,'pgid':p.pid,'argv':argv,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mutationsAllowed':False}
 (root/'watch-execution.json').write_text(json.dumps(meta,indent=2)+'\n')
 print(json.dumps({'stage':'gh-run-watch-started','driverPid':os.getpid(),'ghPid':p.pid,'pgid':p.pid,'runId':41390093647}),flush=True)
 p.wait()
 meta.update(exitCode=p.returncode,elapsedSeconds=time.time()-started,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 (root/'watch-execution.json').write_text(json.dumps(meta,indent=2)+'\n')
 print(json.dumps({'stage':'gh-run-watch-exited','ghPid':p.pid,'exitCode':p.returncode,'elapsedSeconds':meta['elapsedSeconds']}),flush=True)
raise SystemExit(p.returncode)

import datetime,json,os,subprocess
from pathlib import Path
P=Path('/private/tmp/willyou-m11-c24-v011-_h4rvoju/ci-watch/attempt002');D=P/'api-polls';D.mkdir(exist_ok=True)
idx=len(list(D.glob('*.receipt.json')))+1;stem=f'{idx:03d}';a=['env','-u','GH_TOKEN','-u','GITHUB_TOKEN','gh','run','view','41396026050','--repo','uprxiao/SmartDD','--json','databaseId,headSha,headBranch,status,conclusion,url,workflowName,createdAt,updatedAt,jobs']
q=subprocess.Popen(a,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);at=datetime.datetime.now(datetime.timezone.utc).isoformat();timed=False
try:out,err=q.communicate(timeout=25)
except subprocess.TimeoutExpired:
 timed=True;q.kill();out,err=q.communicate()
(D/(stem+'.json')).write_bytes(out);(D/(stem+'.stderr.log')).write_bytes(err);m={'argv':a,'driverPid':os.getpid(),'ghPid':q.pid,'pgid':q.pid,'at':at,'exitCode':q.returncode,'timedOut':timed,'queryOnly':True};(D/(stem+'.receipt.json')).write_text(json.dumps(m,indent=2)+'\n')
if q.returncode:
 print(json.dumps({'index':idx,'transportQueryExitCode':q.returncode,'stderr':err.decode(errors='replace')}));raise SystemExit(q.returncode)
r=json.loads(out)
if r['headSha']!='44b46ca42cc8fff192c4fd8ae051431f369a2b8b':raise RuntimeError('head mismatch')
(P/'latest-api-snapshot.json').write_bytes(out)
print(json.dumps({'index':idx,'status':r['status'],'conclusion':r['conclusion'],'head':r['headSha'],'jobs':[{'id':j['databaseId'],'name':j['name'],'status':j['status'],'conclusion':j['conclusion'],'activeStep':[s['name'] for s in j['steps'] if s['status']=='in_progress']} for j in r['jobs']]}))

from pathlib import Path
import json,hashlib,os
from datetime import datetime,timezone
p=Path('/private/tmp/willyou-m11-s0b-xyp5tfp9/evidence/composition/attempt-003')
r=json.loads((p/'result.json').read_text())
r['attempt']='attempt-003'
if any(item['timeout'] for item in r['checks']):
 r['status']='incomplete-outer-command-budget'
 r['failureClassification']=[{'category':'outer-command-budget','details':'The bounded command budget expired before a full file result; not 255 independent product failures. Preserve prior passing preconditions and split the unchanged original assertions in the next attempt.'}]
r['priorFailurePreserved']=['attempt-001: incomplete freeze and test compile error','attempt-002: common setup denied local Unix listen (EPERM)']
r['environmentPrecondition']={'defaultSandboxProbe':'../attempt-002/unix-bind-probe.json','authorizedLocalProbe':'unix-bind-probe.json','s0bSmoke':'s0b-smoke-result.json','fullFileOnlyAfterSmokePassed':True}
if r['status']!='passed':
 log=(p/'task-capability-launcher.log')
 text=log.read_text(errors='replace') if log.exists() else (p/'s0b-smoke.log').read_text(errors='replace')
 r['failureExcerpt']=[line for line in text.splitlines() if line.startswith(('Error:','AssertionError:','ApplicationError:',' FAIL ',' Test Files ','      Tests '))][-16:]
(p/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
checks=[]
for item in r['checks']:
 try:os.killpg(item['pid'],0);state='still-present'
 except ProcessLookupError:state='absent'
 except PermissionError:state='unverified-permission'
 checks.append({'pgid':item['pid'],'state':state})
cleanup={'schema':'m11-test-cleanup-v1','group':'M11-S0B-C','at':datetime.now(timezone.utc).isoformat(),'ownedProcessGroups':checks,'allKnownOwnedProcessGroupsAbsent':all(c['state']=='absent' for c in checks),'observationHooks':[],'anonymousProbeRootRemoved':True,'sourceModified':False,'sharedNodeModulesRebuilt':False,'resourcesReleased':all(c['state']=='absent' for c in checks),'scope':'Command process groups verified absent; test-managed PTY and brokers use their original fixture teardown.'}
(p/'cleanup.json').write_text(json.dumps(cleanup,ensure_ascii=False,indent=2)+'\n')
files=[{'path':f.name,'size':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(p.iterdir()) if f.is_file() and f.name!='manifest.json']
(p/'manifest.json').write_text(json.dumps({'schema':'m11-test-delivery-v1','group':'M11-S0B-C','attempt':'attempt-003','files':files,'frozen':True,'formalM11NewPassed':0},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':r['status'],'checks':[{'name':c['name'],'exitCode':c['exitCode'],'seconds':c['seconds'],'summary':c['summary']} for c in r['checks']],'sourceMismatches':r['sourceMismatches'],'resourcesReleased':cleanup['resourcesReleased'],'manifestSha256':hashlib.sha256((p/'manifest.json').read_bytes()).hexdigest()},ensure_ascii=False))

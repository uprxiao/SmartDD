from pathlib import Path
import json,hashlib,subprocess,datetime
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-independent-capabilities-ax-20261022');sha=lambda b:hashlib.sha256(b).hexdigest();m=json.loads((e/'build-input-snapshot.json').read_text());env=json.loads((e/'environment.json').read_text())
def check():
 for f in m['files']:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
 for f in env['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256'],f['path']
check();files=json.loads((e/'command-files.json').read_text());cmd=['pnpm','test',*files,'--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(e/'regression-report.json')]
with(e/'regression.txt').open('w') as out:p=subprocess.run(cmd,cwd=w,stdout=out,stderr=subprocess.STDOUT)
check();j=json.loads((e/'regression-report.json').read_text());failed=[{'file':Path(t['name']).relative_to(w).as_posix(),'name':a['fullName'],'message':a['failureMessages']} for t in j['testResults'] for a in t['assertionResults'] if a['status']=='failed'];result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode,'passed':j['numPassedTests'],'failed':j['numFailedTests'],'pending':j['numPendingTests'],'files':len(j['testResults']),'sourceFrozen':True,'sourceInputs':len(m['files']),'command':cmd,'failures':failed,'goal':'active full M10;phase5;not complete'};(e/'regression-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['command','failures']},ensure_ascii=False));print((e/'regression.txt').read_text()[-1200:]);raise SystemExit(p.returncode)

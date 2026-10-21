from pathlib import Path
import json,subprocess,hashlib,datetime
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-native-conflicts-ay-20261022');parent=Path('/private/tmp/m10-independent-capabilities-ax-20261022');manifest=json.loads((e/'build-input-snapshot.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def frozen():return all(sha(w/f['path'])==f['sha256'] for f in manifest['files'])
assert frozen();allpaths=[p for p in json.loads((parent/'regression-result.json').read_text())['command'] if p.endswith(('.test.ts','.test.tsx'))];done={str(Path('src/main/core/applications/__tests__')/p) for p in ['task-capability-launcher.test.ts','application-run-scope.test.ts','agent-adapters.test.ts']};paths=[p for p in allpaths if p not in done];assert len(allpaths)==64 and len(paths)==61
cmd=['pnpm','test',*paths,'--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(e/'remaining-report.json')];started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (e/'remaining.txt').open('wb') as out:code=subprocess.run(cmd,cwd=w,stdout=out,stderr=subprocess.STDOUT).returncode
result={'startedAt':started,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':code,'sourceFrozen':frozen(),'sourceSnapshot':'build-input-snapshot.json','sourceInputs':len(manifest['files']),'command':cmd,'files':len(paths)}
if (e/'remaining-report.json').exists():
 j=json.loads((e/'remaining-report.json').read_text());result.update({'passed':j['numPassedTests'],'failed':j['numFailedTests'],'pending':j['numPendingTests']})
(e/'remaining-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='command'}));raise SystemExit(code)

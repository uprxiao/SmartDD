from pathlib import Path
import json,hashlib,subprocess,datetime
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-claude-delivery-aw-20261022');sha=lambda b:hashlib.sha256(b).hexdigest();m=json.loads((e/'build-input-before-proof.json').read_text());changed=['src/main/core/applications/agent-adapter-registry.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts']
assert json.loads((e/'regression-result.json').read_text())['sourceFrozen']
for f in m['files']:
 raw=(w/f['path']).read_bytes()
 if f['path'] not in changed:assert sha(raw)==f['sha256'],f['path']
 else:f.update(bytes=len(raw),sha256=sha(raw))
m.update(recordedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceBaseline='final AW host proof fix;2 full affected test files follow original64 run');(e/'proof-frozen-inputs.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
cmd=['pnpm','test','src/main/core/applications/__tests__/task-capability-launcher.test.ts','src/main/core/applications/__tests__/agent-adapters.test.ts','--maxWorkers=1','--testTimeout=15000','--reporter=verbose','--reporter=json','--outputFile='+str(e/'proof-regression-report.json')]
with(e/'proof-regression.txt').open('w') as out:p=subprocess.run(cmd,cwd=w,stdout=out,stderr=subprocess.STDOUT)
for f in m['files']:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
for f in json.loads((e/'environment.json').read_text())['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256'],f['path']
r=json.loads((e/'proof-regression-report.json').read_text());result={'exitCode':p.returncode,'passed':r['numPassedTests'],'failed':r['numFailedTests'],'pending':r['numPendingTests'],'files':len(r['testResults']),'frozenSourceInputs':2005,'sourceFrozen':True,'command':cmd};(e/'proof-regression-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));print((e/'proof-regression.txt').read_text()[-1300:]);raise SystemExit(p.returncode)

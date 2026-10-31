from pathlib import Path
import json,hashlib,subprocess,datetime
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-claude-delivery-aw-20261022');sha=lambda b:hashlib.sha256(b).hexdigest();m=json.loads((e/'build-input-before-proof.json').read_text());changed=['src/main/core/applications/agent-adapter-registry.ts','src/main/core/applications/__tests__/task-capability-launcher.test.ts'];assert (e/'proof-host.diff').exists()
for f in m['files']:
 raw=(w/f['path']).read_bytes()
 if f['path'] not in changed:assert sha(raw)==f['sha256'],f['path']
 else:f.update(bytes=len(raw),sha256=sha(raw))
m.update(recordedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceBaseline='final AW host proof fix;typecheck');(e/'types-proof-inputs.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
with(e/'types-proof.txt').open('w') as out:p=subprocess.run(['pnpm','typecheck'],cwd=w,stdout=out,stderr=subprocess.STDOUT)
for f in m['files']:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
for f in json.loads((e/'environment.json').read_text())['nativeInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256'],f['path']
result={'exitCode':p.returncode,'sourceInputs':2005,'finalSourceFrozen':True,'log':'types-proof.txt','command':['pnpm','typecheck']};(e/'types-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));raise SystemExit(p.returncode)

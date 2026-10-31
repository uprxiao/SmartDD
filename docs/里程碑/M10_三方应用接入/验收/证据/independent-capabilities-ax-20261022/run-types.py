from pathlib import Path
import json,hashlib,subprocess
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-independent-capabilities-ax-20261022');sha=lambda b:hashlib.sha256(b).hexdigest();m=json.loads((e/'build-input-snapshot.json').read_text())
for f in m['files']:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
with(e/'types-final.txt').open('w') as out:p=subprocess.run(['pnpm','typecheck'],cwd=w,stdout=out,stderr=subprocess.STDOUT)
for f in m['files']:assert sha((w/f['path']).read_bytes())==f['sha256'],f['path']
r={'exitCode':p.returncode,'sourceInputs':2005,'sourceFrozen':True,'log':'types-final.txt','command':['pnpm','typecheck']};(e/'types-result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r));raise SystemExit(p.returncode)

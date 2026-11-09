from pathlib import Path
import json,hashlib
R=Path('/private/tmp/willyou-m12-viewer-menu-App036-A-prep-002');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
d=json.loads((R/'READY.candidate.json').read_text());s=json.loads((R/'static-result.json').read_text());assert s['passed'];d['status']='execution-ready';d['staticProof']={'path':str(R/'static-result.json'),'sha256':sha(R/'static-result.json'),'actualPID':s['pid']};d['inputs'].append({'path':str(R/'static-result.json'),'sha256':sha(R/'static-result.json'),'mode':(R/'static-result.json').stat().st_mode&511});(R/'READY.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(sha(R/'READY.json'))

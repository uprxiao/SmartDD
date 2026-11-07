from pathlib import Path
import json,hashlib,stat,datetime
R=Path('/private/tmp/willyou-m12-t130-A11-App035-A-prep-001')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
s=json.loads((R/'static-result.json').read_text());assert s['passed'] and len(s['checks'])==8
r=json.loads((R/'READY.candidate.json').read_text())
for x in r['inputs']:
 p=Path(x['path']);assert sha(p)==x['sha256'] and stat.S_IMODE(p.stat().st_mode)==x['mode'],str(p)
assert not (R/'runtime-001').exists()
assert not (R/'READY.json').exists(), 'Do not replace frozen READY'
r['at']=datetime.datetime.now(datetime.timezone.utc).isoformat();r['status']='execution-ready';r['actualExecution']=False;r['staticProof']={'path':str(R/'static-result.json'),'sha256':sha(R/'static-result.json'),'checks':8,'actualPID':s['pid']};r['inputs'].append({'path':str(R/'static-result.json'),'sha256':sha(R/'static-result.json'),'mode':stat.S_IMODE((R/'static-result.json').stat().st_mode)})
(R/'READY.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
files=[]
for p in sorted(R.rglob('*')):
 if not p.is_file() or p.name in ['manifest.json','candidate-manifest.json'] or any(x in p.parts for x in ['history','cache','static-cache','runtime-001']) or p.name.endswith('lease.receipt.json'):continue
 files.append({'path':str(p.relative_to(R)),'sha256':sha(p),'bytes':p.stat().st_size,'mode':stat.S_IMODE(p.stat().st_mode)})
(R/'manifest.json').write_text(json.dumps({'at':r['at'],'scope':'A11 current App035 ordinary-subset A ready, no actual execution','readySHA256':sha(R/'READY.json'),'files':files},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'READY_SHA256':sha(R/'READY.json'),'manifestSHA256':sha(R/'manifest.json'),'inputs':len(r['inputs'])}))

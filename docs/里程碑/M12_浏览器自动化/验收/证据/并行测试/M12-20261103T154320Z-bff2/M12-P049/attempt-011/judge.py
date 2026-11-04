from pathlib import Path
import json,hashlib
r=Path(__file__).resolve().parent
status={}
for p in ['vitest-raw.json','module-registry-retest.json']:
 d=json.loads((r/p).read_text())
 for s in d['testResults']:
  for a in s['assertionResults']:status[(s['name'].split('/source/')[-1],a['fullName'])]=a['status']
i10=json.loads((r.parent/'attempt-010/source-inputs.json').read_text());i11=json.loads((r/'source-inputs.json').read_text())
webInputs=[p for p in i11['files'] if p.startswith(('src/shared/','src/renderer/','prototypes/m6-codex/')) or p in ('tsconfig.web.json','tsconfig.json','package.json','pnpm-lock.yaml')]
checks={'371unique':len(status)==371,'allGreen':all(v=='passed' for v in status.values()),'nodeTypes':not(r/'node-typecheck.log').read_text(),'webTypesPrior':not(r.parent/'attempt-010/web-typecheck.log').read_text(),'webInputsUnchanged':all(i10['files'].get(p)==i11['files'][p] for p in webInputs),'catalogue3':'# pass 3' in(r.parent/'attempt-010/catalogue.log').read_text()}
for n in (9,10,11):
 a=r.parent/f'attempt-{n:03d}';i=json.loads((a/'source-inputs.json').read_text())
 for p in (a/'source').rglob('*'):
  if p.is_file():checks[str(p.relative_to(r.parent))]=hashlib.sha256(p.read_bytes()).hexdigest()==i['files'][str(p.relative_to(a/'source'))]
(r/'adjudication.json').write_text(json.dumps({'checks':checks,'passed':all(checks.values()),'uniqueVitest':len(status),'nodeCatalogueTests':3,'formalIncrement':0},indent=2)+'\n')
assert all(checks.values()),[(k,v) for k,v in checks.items() if not v]

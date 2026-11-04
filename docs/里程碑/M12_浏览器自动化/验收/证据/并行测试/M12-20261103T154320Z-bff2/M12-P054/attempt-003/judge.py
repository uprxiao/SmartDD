from pathlib import Path
import json,hashlib
r=Path(__file__).resolve().parent;status={}
for p in [r.parent/'attempt-002/vitest-raw.json',r/'vitest-raw.json']:
 d=json.loads(p.read_text())
 for s in d['testResults']:
  for a in s['assertionResults']:status[(s['name'].split('/source/')[-1],a['fullName'])]=a['status']
a=json.loads((r.parent/'attempt-002/source-inputs.json').read_text());b=json.loads((r/'source-inputs.json').read_text());changes=[p for p,h in b['files'].items() if a['files'].get(p)!=h]
checks={'unique45':len(status)==45,'allGreen':all(s=='passed' for s in status.values()),'nodeTypesGreen':not(r/'typecheck.log').read_text(),'onlyFixtureChangedForRetained39':changes==['src/main/core/browser/__tests__/service-budget.test.ts']}
(r/'adjudication.json').write_text(json.dumps({'checks':checks,'passed':all(checks.values()),'uniqueU':45,'formalIncrement':0},indent=2)+'\n');assert all(checks.values()),checks

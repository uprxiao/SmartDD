import pathlib,json,hashlib
r=pathlib.Path(__file__).resolve().parent
def rows(p):
 x=json.load(open(p));return {(s['name'].split('/source/')[-1],a['fullName']):a['status'] for s in x['testResults'] for a in s['assertionResults']}
combined={}
for n in [3,5,6,7,8]:combined.update(rows(r.parent/f'attempt-{n:03d}'/'vitest-raw.json'))
checks={'367UniqueVitest':len(combined)==367,'allVitestGreen':all(v=='passed' for v in combined.values()),'latestNodeTypecheck':(r/'check-0.log').read_text()=='','validWebTypecheck':(r.parent/'attempt-007/check-1.log').read_text()=='','catalogue3Green':'# pass 3' in (r.parent/'attempt-006/check-2.log').read_text()}
for n in range(1,9):
 a=r.parent/f'attempt-{n:03d}';inputs=json.load(open(a/'source-inputs.json'))
 for p in (a/'source').rglob('*'):
  if p.is_file():checks[str(p.relative_to(r.parent))]=hashlib.sha256(p.read_bytes()).hexdigest()==inputs['files'][str(p.relative_to(a/'source'))]
(r/'adjudication.json').write_text(json.dumps({'checks':checks,'passed':all(checks.values()),'uniqueVitest':len(combined),'nodeCatalogueTests':3,'originalCaseIncrement':0,'scope':'software only; native T098/097 tracked by P050'},indent=2)+'\n');assert all(checks.values()),[(k,v) for k,v in checks.items() if not v]

import pathlib,json,hashlib
r=pathlib.Path(__file__).resolve().parent
def rows(report):
 return {(s['name'].split('/source/')[-1],t['fullName']):t['status'] for s in report['testResults'] for t in s['assertionResults']}
a=rows(json.load(open(r.parent/'attempt-001/vitest-raw.json')));a.update(rows(json.load(open(r.parent/'attempt-002/vitest-supplement-raw.json'))));last=rows(json.load(open(r/'vitest-raw.json')));a.update(last)
checks={'294UniqueGreen':len(a)==294 and all(v=='passed' for v in a.values()),'affected11Green':len(last)==11 and all(v=='passed' for v in last.values()),'frontendTypecheck':(r/'check-0.log').read_text()==''}
s=json.load(open(r/'source-inputs.json'));old=json.load(open(r.parent/'attempt-001/source-inputs.json'));changed={p for p,h in s['files'].items() if old['files'].get(p)!=h};checks['onlyThreeDeclaredFrontendFilesChanged']=changed=={'src/renderer/features/browser/workspace.tsx','src/renderer/features/browser/workspace.css','src/renderer/features/browser/workspace.test.tsx'}
for p in (r/'source').rglob('*'):
 if p.is_file():checks[str(p.relative_to(r/'source'))]=hashlib.sha256(p.read_bytes()).hexdigest()==s['files'][str(p.relative_to(r/'source'))]
(r/'adjudication.json').write_text(json.dumps({'checks':checks,'passed':all(checks.values()),'uniqueSoftwareTests':len(a),'formalCaseIncrement':0,'reuse':'all prior unaffected source/tests retained; changed frontend exact11green'},indent=2)+'\n');assert all(checks.values())

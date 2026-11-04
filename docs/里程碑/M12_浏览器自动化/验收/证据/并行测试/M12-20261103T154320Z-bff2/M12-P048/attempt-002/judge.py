import json,pathlib,hashlib
r=pathlib.Path(__file__).resolve().parent
a=json.load(open(r/'vitest-original-raw.json'));b=json.load(open(r/'vitest-supplement-raw.json'))
def records(report):
 return {(s['name'].split('/source/')[-1],t['fullName']):t['status'] for s in report['testResults'] for t in s['assertionResults']}
first=records(a);last=records(b);merged={**first,**last}
checks={'293Unique':len(merged)==293,'allUniquePassed':all(v=='passed' for v in merged.values()),'initialFailureIsRetained':sum(v=='failed' for v in first.values())==5,'supplementAll12Passed':len(last)==12 and all(v=='passed' for v in last.values())}
s=json.load(open(r/'source-inputs.json'));snap=r.parent/'attempt-001/source'
for p in snap.rglob('*'):
 if p.is_file():checks[str(p.relative_to(snap))]=hashlib.sha256(p.read_bytes()).hexdigest()==s['files'][str(p.relative_to(snap))]
(r/'adjudication.json').write_text(json.dumps({'checks':checks,'passed':all(checks.values()),'uniqueSoftwareTests':len(merged),'originalCaseIncrement':0,'boundary':'software/native-page substitutions and jsdom; no packaged App claim'},indent=2)+'\n');assert all(checks.values())

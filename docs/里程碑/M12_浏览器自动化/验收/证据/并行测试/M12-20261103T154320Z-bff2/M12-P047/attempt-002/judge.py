import pathlib,json,hashlib,re
r=pathlib.Path(__file__).resolve().parent
s=json.load(open(r/'source-inputs.json'))
logs=[(r/f'check-{i}.log').read_text() for i in range(3)]
checks={'nodeTypecheck':logs[0]=='','webTypecheck':logs[1]=='','all9Suites63Tests':bool(re.search(r'Test Files\s+9 passed',logs[2]) and re.search(r'Tests\s+63 passed',logs[2])),'noFailureSection':'Failed Suites' not in logs[2] and 'FAIL ' not in logs[2]}
for p in (r/'source').rglob('*'):
 if p.is_file():checks[str(p.relative_to(r/'source'))]=hashlib.sha256(p.read_bytes()).hexdigest()==s['files'][str(p.relative_to(r/'source'))]
(r/'adjudication.json').write_text(json.dumps({'checks':checks,'softwarePassed':all(checks.values()),'formalCaseIncrement':0,'boundary':'actual BrowserService/Profiles/Workspace/Queue/SQLite, native page/cloner substituted; I/A/R pending'},indent=2)+'\n')
assert all(checks.values()),checks

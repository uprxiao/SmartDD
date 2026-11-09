# Pure AST and function-level JSON schema controls. Does not run fixture main/worker/wait.
import ast,json,pathlib,copy,hashlib
R=pathlib.Path('/private/tmp/willyou-m12-t043-real-35min-static-001');checks=[]
for n in ['lease_wait.py','revocation_probe.py']:
    t=ast.parse((R/'fixtures'/n).read_text(),filename=n);checks.append({'id':'ast-'+n,'passed':True})
    assert not any(isinstance(x,ast.Call) and isinstance(x.func,ast.Attribute) and x.func.attr in ['settimeofday','clock_settime','grantPermissions'] for x in ast.walk(t))
t=ast.parse((R/'fixtures/revocation_probe.py').read_text());f=next(n for n in t.body if isinstance(n,ast.FunctionDef) and n.name=='cli_summary');mod=ast.Module(body=[f],type_ignores=[]);ns={'json':json,'re':__import__('re')};exec(compile(mod,'reviewed-cli-summary-function-only','exec'),ns);fn=ns['cli_summary'];rid='11111111-1111-4111-8111-111111111111'
for name,value,expected in [('host-auth-no-status',{'error':{'code':'AUTH_REQUIRED','effectState':'not-started'},'requestId':rid},True),('local-no-request',{'error':{'code':'AUTH_REQUIRED'}},False),('peer-mismatch',{'error':{'code':'PEER_MISMATCH'},'requestId':rid},False),('connection-closed',{'error':{'code':'CONNECTION_UNAVAILABLE'}},False),('nonobject',[],False)]:
    got=fn(json.dumps(value),None);assert got.get('hostAuthRejected',False)==expected;assert got['returncode'] is None;checks.append({'id':name,'passed':True})
(R/'python-controls.json').write_text(json.dumps({'checks':checks,'passed':True,'scope':'AST + exact reviewed JSON-summary function with synthetic strings only; no subprocess/file fixture main run'},indent=2)+'\n');print(json.dumps({'purePythonChecks':len(checks),'passed':True}))

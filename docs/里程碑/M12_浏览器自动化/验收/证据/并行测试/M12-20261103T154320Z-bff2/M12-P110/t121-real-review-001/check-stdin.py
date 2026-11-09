# Parse original Python AST as data only. Never compile/eval/exec it or invoke subprocess.
import ast,json,hashlib,copy
from pathlib import Path
R=Path('/private/tmp/willyou-m12-t121-actual-independent-001')
source=(R/'stdin-program.private.py').read_text()
def inspect_source(src):
 t=ast.parse(src); calls=[n for n in ast.walk(t) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=='subprocess' and n.func.attr=='run'];assert len(calls)==2
 first,fill=sorted(calls,key=lambda n:n.lineno)
 assert isinstance(first.args[0],ast.List);one=first.args[0].elts;assert [ast.literal_eval(x) for x in one[:5]]==['willyou-app','zentao','resource','read','--json']
 assert ast.unparse(one[5])=="json.dumps({'resource': resource, 'offset': 0, 'length': 262144})"
 argv=ast.literal_eval(fill.args[0]);assert argv[:5]==['willyou-app','browser','fill','--page','4e5ddb9a-7ef7-4046-a56e-285775602906'];assert argv[5:] == ['--element','@kf4b2ed3824ab402f99a01662c83b4cdbs5e4','--stdin','value'];assert '--value' not in argv
 kwargs={x.arg:x.value for x in fill.keywords};assert ast.unparse(kwargs['input'])=='m.group(1)';assert ast.literal_eval(kwargs['capture_output']) is True and ast.literal_eval(kwargs['text']) is True
 assignments={n.targets[0].id:n.value for n in t.body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)}
 assert ast.unparse(assignments['d'])=='json.loads(r.stdout)';assert ast.unparse(assignments['steps'])=="json.loads(d['data']['data'])['steps']";assert ast.unparse(assignments['m'])=="re.search('演示密码：([^。\\\\n]+)', steps)"
 guards=[ast.unparse(n) for n in t.body if isinstance(n,ast.If)];assert any(n.startswith('if r.returncode:') and 'sys.exit(' in n for n in guards);assert any("not d['data']['eof'] or not d['completeness']['complete']" in n and 'sys.exit(' in n for n in guards);assert any(n.startswith('if not m:') and 'sys.exit(' in n for n in guards)
 prints=[ast.unparse(n) for n in ast.walk(t) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='print'];assert 'print(p.stdout)' in prints;assert not any('m.group' in x for x in prints)
 assert ast.unparse(t.body[-1])=='sys.exit(p.returncode)'
 return {'source_sha256':hashlib.sha256(src.encode()).hexdigest(),'strict_argv_page_ref':True,'resource_stdout_to_steps_to_regex_only':True,'actual_complete_and_eof_guard':True,'password_only_subprocess_stdin':True,'no_password_value_or_hash_published':True,'two_actual_subprocess_commands':True,'program_not_executed':True}
proof=inspect_source(source);checks=[{'name':'actual exact-source AST positive','passed':True}]
for name,mutated in [
 ('password argv substitution',source.replace("'--stdin','value'","'--value','secret'")),
 ('unbound source to stdin',source.replace('input=m.group(1)','input=other')),
 ('remove EOF guard',source.replace("if not d['data']['eof'] or not d['completeness']['complete']:","if False:")),
 ('wrong target page',source.replace('4e5ddb9a-7ef7-4046-a56e-285775602906','other-page')),
 ('additional subprocess',source+"\nsubprocess.run(['unexpected'])\n")]:
 try:inspect_source(mutated)
 except (AssertionError,KeyError,ValueError):checks.append({'name':name,'passed':True,'rejected':True})
 else:raise AssertionError('negative accepted: '+name)
(R/'stdin-ast-proof.json').write_text(json.dumps({'proof':proof,'checks':checks,'Native':0,'CLI':0,'SQL':0,'modelRequests':0},indent=2,ensure_ascii=False)+'\n');print(json.dumps({'positive':True,'negativeControls':len(checks)-1,'programExecuted':False}))

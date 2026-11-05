#!/usr/bin/env python3
"""Static only: file hash + Python AST/symbols + C lexical/contract surfaces."""
import ast,builtins,hashlib,json,re,symtable
from pathlib import Path
R=Path(__file__).resolve().parent
SDK=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pycheck(path):
 source=path.read_text();ast.parse(source);t=symtable.symtable(source,str(path),'exec');allowed={s.get_name() for s in t.get_symbols() if s.is_assigned() or s.is_imported() or s.is_namespace()}|set(dir(builtins))|{'__file__','__name__'};errors=[]
 def walk(scope):
  errors.extend(s.get_name() for s in scope.get_symbols() if s.is_referenced() and s.is_global() and s.get_name() not in allowed)
  for child in scope.get_children():walk(child)
 walk(t);assert not errors,(path,errors)
 return {'path':path.name,'AST':True,'unboundGlobals':errors}
checks=[pycheck(R/n) for n in ['run.py','judge.py','prepare.py']]
s=(R/'probe.c').read_text();required=['proc_listchildpids(getpid()','capacityBytes','guardBeforeIntact','WEXITED|WNOHANG|WNOWAIT','terminated-unreaped-observed','two-live-full','two-live-one-slot','two-live-zero-bytes','A-unreaped-B-live-full','A-waited-B-live-full','race-child-scan-before-reap','race-parent-last-counter','wait4(','sameIdentityStillPresent']
assert all(x in s for x in required)
stripped=re.sub(r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',lambda m:' '*len(m.group(0)),s,flags=re.S);stack=[];start={'(':')','[':']','{':'}'}
for c in stripped:
 if c in start:stack.append(start[c])
 elif c in ')]}':assert stack and stack.pop()==c
assert not stack
assert not re.search(r'\b(system|popen|execve|execl|execv|socket|connect|bind)\s*\(',stripped)
files=[R/n for n in ['probe.c','run.py','judge.py','prepare.py','README.md']]
files += [SDK/n for n in ['usr/include/libproc.h','usr/include/sys/resource.h','usr/include/sys/proc_info.h','usr/include/sys/wait.h','usr/share/man/man2/getrusage.2','usr/share/man/man2/wait.2','usr/include/sys/signal.h']]
files.append(Path('/usr/bin/clang'))
for f in files:assert f.is_file(),f
payload={'kind':'static-ready-short-inventory-fixture','privateRoot':str(R),'inputs':[{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files],'PythonStaticChecks':checks,'CChecks':{'tokens':True,'lexicalBalanced':True,'compilerExecuted':False,'CTypeOrLinkNotClaimed':True},'resourceBoundaries':{'App':False,'NativeStarted':False,'OSQueriesPerformed':False,'ports':[],'PTY':False,'hooks':False,'productionChanges':False,'fixtureProcessIdentities':3,'compilerAndOneVerifierAdditional':True,'wallBudgetsSeconds':{'compiler':6,'fixtureAlarm':10,'runnerProbe':10,'verifierEach':2,'judge':1},'expectedNormalSecondsLessThan':5,'intendedWorstCaseSecondsLessThan':30},'reuse':{'P079002Manifest':'92dce15338caf8b1daae546d6697034c2f962feda5d3229bab1d42dffcd881e4','boundary':'No rerun of established six semantic cases; same raw units kept, this tests only child listing/final race.'},'command':'WILLYOU_TEST_CACHE_DIR='+str(R/'cache')+' python3 '+str(R/'run.py')+' --execute','fullScopeApproved':False}
(R/'static-preflight.json').write_text(json.dumps(payload,indent=2)+'\n')
manifest={'files':[{'path':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(R.iterdir()) if p.is_file() and p.name!='preparation-manifest.json'],'excludesSelf':True,'nativeExecuted':False}
(R/'preparation-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'root':str(R),'ready':'static-only','preflightSha256':sha(R/'static-preflight.json'),'sourceSha256':sha(R/'probe.c'),'runnerSha256':sha(R/'run.py'),'judgeSha256':sha(R/'judge.py'),'manifestSha256':sha(R/'preparation-manifest.json'),'command':payload['command']},indent=2))

#!/usr/bin/env python3
"""Static file/AST-only readiness. Never imports ctypes/psutil or invokes a subprocess."""
import ast,builtins,hashlib,json,symtable,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SDK=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def check_python(path):
    source=path.read_text();ast.parse(source,filename=str(path));table=symtable.symtable(source,str(path),'exec')
    module_names={s.get_name() for s in table.get_symbols() if s.is_assigned() or s.is_imported() or s.is_namespace()}
    allowed=module_names|set(dir(builtins))|{'__file__','__name__'}
    errors=[]
    def visit(scope):
        for symbol in scope.get_symbols():
            if symbol.is_referenced() and symbol.is_global() and symbol.get_name() not in allowed:errors.append({'scope':scope.get_name(),'name':symbol.get_name()})
        for child in scope.get_children():visit(child)
    visit(table)
    if errors:raise AssertionError({'unboundPythonGlobals':errors,'path':str(path)})
    return {'path':str(path),'astParsed':True,'unboundGlobalNames':errors}
checks=[check_python(ROOT/name) for name in ['run.py','judge.py','prepare.py']]
source=(ROOT/'probe.c').read_text()
required=['proc_pid_rusage(pid,RUSAGE_INFO_V1','proc_pid_rusage(pid,RUSAGE_INFO_V2','ri_child_user_time','ri_child_system_time','pbi_start_tvsec','pbi_start_tvusec','getrusage(RUSAGE_SELF','getrusage(RUSAGE_CHILDREN','wait4(','SZOMB','waitid(P_PID','WEXITED|WNOHANG|WNOWAIT','terminated-unreaped-observed','sameIdentityStillPresent','daemon-terminal-boundary','parent-child-alive','parent-zombie-unwaited','parent-after-child-wait','parent-before-hidden-child','parent-after-hidden-child','parent-after-nested-wait','reparent-boundary']
missing=[token for token in required if token not in source]
assert not missing,missing
# Lexical delimiter validation, explicitly not a C semantic/compiler check.
import re
stripped=re.sub(r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',lambda m:' '*len(m.group(0)),source,flags=re.S)
stack=[];opening={'(':')','[':']','{':'}'}
for char in stripped:
    if char in opening:stack.append(opening[char])
    elif char in ')]}':assert stack and stack.pop()==char,'unbalanced C lexical delimiters'
assert not stack
assert not re.search(r'\b(system|popen|execve|execl|execv|socket|connect|bind)\s*\(',stripped),'unapproved C surface'
files=[ROOT/name for name in ['probe.c','run.py','judge.py','prepare.py','README.md']]
headers=['usr/include/libproc.h','usr/include/sys/resource.h','usr/include/sys/proc_info.h','usr/include/sys/proc.h','usr/include/sys/wait.h','usr/share/man/man2/getrusage.2','usr/share/man/man2/wait.2']
for name in headers:
    p=SDK/name;assert p.is_file();files.append(p)
assert Path('/usr/bin/clang').is_file(),'compiler path must exist but is not executed here'
files.append(Path('/usr/bin/clang'))
preflight={'kind':'static-source-ready-not-native-validated','privateRoot':str(ROOT),'inputs':[{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files],'pythonStaticChecks':checks,'CChecks':{'requiredTokensPresent':True,'lexicalDelimitersBalanced':True,'compilerExecuted':False,'semanticOrLinkCheckPassed':None,'futureGate':'The one authorized run first compiles probe.c with -Wall -Wextra -Werror; compilation failure prevents all Native probe stages.'},'cache':str(ROOT/'cache'),'sixCases':['self-unit','live-child','zombie-unwaited','waited-and-hidden-child','grandchild-rollup','daemon-reparent'],'expectedOwnedNativeProcesses':'controller + 6 controlled descendant identities; compiler/its toolchain only during build; one later exact verifier process','ports':[],'windows':0,'App':None,'PTY':None,'NativeExecuted':False,'OSProbeExecuted':False,'resourceLeaseClaimed':False,'originalT111FilesChanged':False,'fullScopeRusageAccountingNotYetApproved':True,'command':'WILLYOU_TEST_CACHE_DIR='+str(ROOT/'cache')+' python3 '+str(ROOT/'run.py')+' --execute','boundary':'Static READY is not execution authorization. Wait for explicit coordinator Native transfer; no App production change or full-scope pass claim.'}
(ROOT/'static-preflight.json').write_text(json.dumps(preflight,ensure_ascii=False,indent=2)+'\n')
manifest={'files':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(ROOT.iterdir()) if p.is_file() and p.name not in ['preparation-manifest.json']],'excludesSelf':True,'noExecutionArtifacts':not (ROOT/'execution-started.json').exists()}
(ROOT/'preparation-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'ready':'static-only','root':str(ROOT),'staticPreflightSha256':sha(ROOT/'static-preflight.json'),'sourceSha256':sha(ROOT/'probe.c'),'runnerSha256':sha(ROOT/'run.py'),'judgeSha256':sha(ROOT/'judge.py'),'manifestSha256':sha(ROOT/'preparation-manifest.json'),'command':preflight['command'],'NativeExecuted':False},indent=2))

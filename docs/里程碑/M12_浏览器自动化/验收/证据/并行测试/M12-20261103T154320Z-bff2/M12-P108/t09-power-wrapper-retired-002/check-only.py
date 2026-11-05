"""File/pure tests only; never invokes PS, libproc, child process or power APIs."""
from pathlib import Path
import ast, importlib.util, json, os, types, subprocess, shutil, hashlib
ROOT=Path('/private/tmp/willyou-m12-t09-cm-power-wrapper-002')
s=(ROOT/'run.py').read_text(); tree=ast.parse(s)
spec=importlib.util.spec_from_file_location('cm_power_wrapper002',ROOT/'run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
checks=[]
def check(name, condition):
    assert condition, name
    checks.append({'id':name,'passed':True})
actual=json.loads(Path('/private/tmp/willyou-m12-t09-cm-power-wrapper-001/power-lifecycle.private.json').read_text())['wrapperIdentity']
check('actual001-comm-captured-truncated',actual['comm']=='/Applications/Xc' and actual['argv'][0].startswith('/Applications/Xcode.app/'))
check('old-exe-via-comm-rejects-actual-wrapper',Path(actual['comm']).resolve()!=Path(actual['argv'][0]).resolve())
# Predicate controls use an explicitly synthetic executable value; actual libproc remains pending.
utility=[m.NODE,str(m.TARGET/'run.mjs'),'--execute','--t09-cm']
row={'pid':1234,'ppid':os.getpid(),'uid':os.getuid(),'birth':actual['birth'],'comm':'/Users/liubu/.her','argv':utility,'executable':m.NODE,'executableObservation':{'path':m.NODE,'length':len(m.NODE),'errno':None}}
summary=m.binding_summary(row,utility,os.getpid())
required=['candidatePresent','PPIDMatches','UIDMatches','exactArgvMatches','exactArgvTailMatches','executableMatches']
check('synthetic-full-exe-with-actual-truncation-pattern-accepted',all(summary[k] for k in required))
for label,delta in [('wrong-ppid',{'ppid':1}),('wrong-uid',{'uid':99999}),('wrong-exe',{'executable':'/usr/bin/false'}),('wrong-argv',{'argv':utility[:-1]+['--other']}),('exe-read-failure',{'executable':None})]:
    got=m.binding_summary(dict(row,**delta),utility,os.getpid());check(label,not all(got[k] for k in required))
check('birth-reuse-rejected',not m.same_identity(row,dict(row,birth='changed')))
check('comm-description-not-identity',m.same_identity(row,dict(row,comm='different-short-text',ppid=1)))
check('null-identity-rejected',not m.same_identity(row,None))
execute=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='execute')
guarded=next(n for n in execute.body if isinstance(n,ast.FunctionDef) and n.name=='guarded')
code=compile(ast.fix_missing_locations(ast.Module(body=[guarded],type_ignores=[])),'actual-guarded-function','exec')
controlRoot=ROOT/'pure-controller-runtime';controlRoot.mkdir(exist_ok=False)
try:
 for name,terminalAt,identity,guardFound in [('bind-error-natural-terminal',20,False,False),('bind-error-still-live',None,False,False),('guard-error-natural-terminal',20,True,False),('normal-bound',20,True,True)]:
    class Clock:
        now=0.0
        def monotonic(self):return self.now
    clock=Clock();signals=[];record={'phases':[],'knownIdentities':[]};runtime=controlRoot/name;runtime.mkdir()
    class Child:
        pid=1234
        returncode=None
        def poll(self):
            if terminalAt is not None and clock.now>=terminalAt:self.returncode=0
            return self.returncode
        def wait(self,timeout=None):
            if self.poll() is None:raise subprocess.TimeoutExpired('synthetic-no-process',timeout)
            return self.returncode
    child=Child();guard=dict(row,pid=5678,ppid=1234,executable='/usr/bin/caffeinate',argv=['/usr/bin/caffeinate','-i','-s']+utility)
    def ps(pid):
        if pid==1234:return row if identity else None
        return guard if child.poll() is None else None
    def signal_exact(*args):signals.append(args);raise AssertionError('Unexpected signal in pure case')
    env=dict(m.__dict__,r=record,runtime=runtime,time=clock,save=lambda *a:None,wait_tick=lambda seconds,stage:setattr(clock,'now',clock.now+seconds),ps_one=ps,find_guard=lambda *a:guard if guardFound else None,own_assertions=lambda *a:{'allRequestedOwnAssertionsObserved':True,'allOwnAssertionsAbsent':True},signal_exact=signal_exact,subprocess=types.SimpleNamespace(Popen=lambda *a,**k:child,TimeoutExpired=subprocess.TimeoutExpired))
    exec(code,env);phase=env['guarded']('driver',utility,30)
    if terminalAt is None:
        check(name+'-blocks-followups',phase['terminalObserved'] is False and not m.phase_terminal_or_not_launched(phase) and clock.now>=30)
    else:
        check(name+'-waits-original-terminal',phase['terminalObserved'] is True and phase['driverExit']==0 and clock.now>=terminalAt and m.phase_terminal_or_not_launched(phase))
    check(name+'-no-signals',not signals)
    if not identity:check(name+'-candidate-summary-persisted',len(phase['bindingCandidates'])>0 and not phase['bindingCandidates'][0]['candidatePresent'])
finally:shutil.rmtree(controlRoot)
check('cleanup-gate-before-cleanup-spawn',s.index('if not phase_terminal_or_not_launched(last_driver)')<s.index("cleanup = guarded('cleanup'"))
check('judge-gate-before-judge-spawn',s.index('if not phase_terminal_or_not_launched(last_cleanup)')<s.index("judge = subprocess.Popen"))
check('sdk-signature-matched',"query.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]" in s and 'ctypes.create_string_buffer(4096)' in s)
check('no-display-useractive-flags',"'-d'" not in s and "'-u'" not in s)
out={'status':'file-and-pure-controller-checks-passed','checks':checks,'passed':len(checks),'total':len(checks),'actual001CapturedPSReference':'actual parsed PS identity, original raw candidate rows not saved','actualLibprocSelfCheck':'not executed; requires Root Native lease','Native':0,'App':0,'childProcesses':0,'powerAssertions':0,'resourcesHeld':False,'formalCaseIncrement':0}
(ROOT/'check-only-result.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:out[k] for k in ('status','passed','total','Native','resourcesHeld')}))

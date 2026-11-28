#!/usr/bin/env python3
"""Static/replay preflight only. No App, Codex/native CLI, model, listener or live process observation."""
import ast, copy, errno, gzip, hashlib, json, os, pathlib, re, subprocess, sys
from types import SimpleNamespace
from unittest.mock import patch
from closure_contract import exact_coherent
import own_scope_native_diagnostic as oldcollector
import own_scope_native_memory_diagnostic as newcollector
BASE=pathlib.Path(__file__).resolve().parent
REPO=BASE.parents[2]
DOC=REPO/'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125'
R6=BASE/'run-ITKAGr'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def lines(p):
    data=gzip.decompress(p.read_bytes()).decode() if p.suffix=='.gz' else p.read_text()
    return [json.loads(line) for line in data.splitlines() if line]
def run(argv,timeout=60):
    return subprocess.run(argv,cwd=REPO,check=True,capture_output=True,text=True,timeout=timeout).stdout
# Actual R6 sources and original R5 remain intact.
actual=read(BASE/'cohort-hXXlEt/prepared.json')
for k,v in actual['sourcePins'].items(): assert sha(BASE/k)==v,k
formal=read(BASE/'static-preflight-scope-r5.json')
for k,v in formal['sourcePins'].items(): assert sha(BASE/k)==v,k
r6index=read(DOC/'candidate-28-agent-store-status-projection/B11-owned-binding-short-diagnostic-actual/index.json')
for name in ('result.json','scope-attempts.jsonl','scope-summary.jsonl','active-endpoint-pins.json','independent-cleanup.json'):
    assert sha(R6/name)==r6index['files'][name],name
r6=read(R6/'result.json'); assert r6['status']=='diagnostic-complete-no-formal-evidence' and r6['actualVerifiedSupportedTool']['version']=='0.169.0'
assert len(r6['readReceipts'])==10 and all(r['status']=='ok' for r in r6['readReceipts'])
r6scopes=lines(R6/'scope-attempts.jsonl'); assert len(r6scopes)==44
c27=lines(DOC/'candidate-27-schedule-active-query-reuse/B11-real-1800s-recheck/archive-safe/scope-attempts.jsonl.gz')
def exact(a):return exact_coherent(a,{int(pid):r for pid,r in a['required'].items()},a['cid'],live_count_contract_verified=True)
for rows,count in ((r6scopes,44),(c27,18)):
    assert len(rows)==count
    for x in rows:
        a=x['attempts'][-1]
        assert x['closedCandidate'] and exact(a).state=='closed'
        assert len(a['nodes'])==x['actualFinalNetLive']
        assert sum(n['rss'] for n in a['nodes'] if n['role']=='product')==x['actualProductRssBytes']
r5=lines(BASE/'run-QsHCN9/scope-attempts.jsonl')[-1]
assert not r5['closedCandidate'] and exact(r5['attempts'][-1]).state=='fatal'
assert r5['attempts'][-1]['gaps']==[{'kind':'identity-raced-after-owned-binding','pid':93936}]
r4=lines(BASE/'run-0iKsJY/scope-attempts.jsonl')[-1]
assert not r4['closedCandidate'] and exact(r4['attempts'][-1]).state=='retry'
# Collector has byte-for-byte same original scopes and native API calls;
# precisely three data fields from the already validated usage structure.
s=(BASE/'own_scope_native_diagnostic.py').read_text()
t=(BASE/'own_scope_native_memory_diagnostic.py').read_text()
extra="'nativeFootprint':usage['footprint'],'nativeWired':usage['wired'],'nativePageins':usage['pageins'],"
assert t.count(extra)==1 and t.replace(extra,'')==s
assert all(x in (BASE/'cpu_collector.py').read_text() for x in ("'pageins','wired','rss','footprint'","C.sizeof(Usage)!=160"))
fn=lambda txt,name:next(n for n in ast.walk(ast.parse(txt)) if isinstance(n,ast.FunctionDef) and n.name==name)
ncalls=lambda node:[ast.unparse(n.func) for n in ast.walk(node) if isinstance(n,ast.Call) and ast.unparse(n.func).startswith('self.n.')]
assert ncalls(fn(s,'exact_row'))==ncalls(fn(t,'exact_row'))
for name in ('capture','uid_census','xpc_roots','owned_children','idle_counter','runtime_roots','init'):
    assert ast.dump(fn(s,name),include_attributes=False)==ast.dump(fn(t,name),include_attributes=False)
# Actual R6 owned main BSD identity used as a fixture; new memory values below
# are expressly synthetic API return controls, not recovered measurements.
a=r6scopes[3]['attempts'][-1]
node=next(q for q in a['nodes'] if q['pid']==r6['pid'])
first=copy.deepcopy(node['minimalBefore']); second=copy.deepcopy(node['minimalAfter']); pid=node['pid']; cid=a['cid']
rawpath=str(pathlib.Path(r6['bundle'])/'Contents/MacOS/WillYou')
usage={'rc':0,'errno':0,'startAbstime':node['startAbstime'],'exitAbstime':0,'rss':node['nativeRss'],'user':node['nativeCpuUser'],'system':node['nativeCpuSystem'],'footprint':123456789,'wired':8192,'pageins':42}
def cidrow(n=cid):return {'pid':pid,'bytes':40,'errno':0,'resourceId':n,'jetsamId':1,'reserved':[0,0,0],'startNs':1,'endNs':2}
def pathrow(p=rawpath):return (len(p),0,p)
class FakeNative:
    def __init__(self,b1,b2,c1,c2,p1,p2,u):
        self.uid=first['uid'];self.abi={'bsdSize':136};self.bs=[b1,b2];self.cs=[c1,c2];self.ps=[p1,p2];self.u=u;self.calls=[]
    def bsd(self,p):assert p==pid;self.calls.append('bsd');return self.bs.pop(0)
    def coalition_id(self,p):assert p==pid;self.calls.append('cid');return self.cs.pop(0)
    def usage(self,p):assert p==pid;self.calls.append('usage');return self.u
    def path(self,p):assert p==pid;self.calls.append('path');return self.ps.pop(0)
    def bsd_ok(self,b,p):return oldcollector.ScopeNative.bsd_ok(self,b,p)
    def born(self,b):return oldcollector.ScopeNative.born(self,b)
controls=[]
def test(label,expect=None,b1=first,b2=second,c1=None,c2=None,p1=None,p2=None,u=usage,anchor=None):
    rows=[];callsets=[]
    for mod in (oldcollector,newcollector):
        native=FakeNative(copy.deepcopy(b1),copy.deepcopy(b2),copy.deepcopy(c1 if c1 is not None else cidrow()),copy.deepcopy(c2 if c2 is not None else cidrow()),p1 if p1 is not None else pathrow(),p2 if p2 is not None else pathrow(),copy.deepcopy(u))
        collector=object.__new__(mod.Collector);collector.n=native;collector.cid=cid;collector.path_class=lambda p:'candidate/Contents/MacOS/WillYou'
        def fake_process(p):
            assert p==pid;native.calls.append('rss');return SimpleNamespace(memory_info=lambda:SimpleNamespace(rss=node['rss']))
        with patch.object(mod.psutil,'Process',fake_process):
            row,gap=collector.exact_row(pid,expected=anchor if anchor is not None else {'birth':node['birth'],'pathExact':rawpath})
        rows.append((row,gap));callsets.append(native.calls)
    assert callsets[0]==callsets[1],label
    if expect is None:
        old,go=rows[0];new,gn=rows[1];assert go is None and gn is None
        nums={k:new.pop(k) for k in ('nativeFootprint','nativeWired','nativePageins')}
        assert nums=={'nativeFootprint':usage['footprint'],'nativeWired':usage['wired'],'nativePageins':usage['pageins']}
        assert old==new
    else:
        assert rows[0]==rows[1] and rows[1][0] is None and rows[1][1]['kind']==expect,(label,rows)
    controls.append({'label':label,'expected':expect or 'numeric-only-fields-added','nativeReadSequence':callsets[1]})
test('bound valid identity numeric fields only')
test('first CID foreign rejects before usage','unbound-coalition',c1=cidrow(cid+1))
test('first BSD foreign UID rejects','unbound-native-bsd',b1={**first,'uid':first['uid']+100})
test('anchor birth mismatch refuses before RSS','anchor-birth-changed',anchor={'birth':'999:1','pathExact':rawpath})
test('second CID mismatch remains fatal gap','identity-raced-after-owned-binding',c2=cidrow(cid+1))
test('second path mismatch remains fatal gap','identity-raced-after-owned-binding',p2=pathrow('/synthetic/not-expected'))
test('second BSD ESRCH remains original gap','identity-raced-after-owned-binding',b2={**second,'bytes':0,'errno':errno.ESRCH})
test('first usage permission error remains original gap','read-gap-after-owned-binding',u={**usage,'rc':-1,'errno':errno.EPERM})
# Preserve original R6 browser workflows, fixture provider, passive poll, input and cleanup logic.
old=(BASE/'run-scope-diagnostic.mjs').read_text();new=(BASE/'run-memory-phase-diagnostic.mjs').read_text()
segments=(('const report=', 'const persist='),('const page=', 'const js='),('const js=', 'async function longResource'),(' const pre=await scopeObservation',' // Explicit diagnostic-only coordinator gate;'))
for lo,hi in segments[1:]:
    assert old[old.index(lo):old.index(hi)]==new[new.index(lo):new.index(hi)],lo
# Actual startup/fixture creation and normal teardown remain unchanged except diagnostic label.
old_tail=old[old.index('try{\n await launch();'):]
new_tail=new[new.index('try{\n await launch();'):]
assert old_tail.replace('C28-native-scope-mismatch-diagnostic-only','C28-memory-phase-diagnostic-only')==new_tail
for tag in ("async function resourceRead","async function parkedNative","from './native-passive-poll.mjs'","formalEligible:false","formalCasePassCandidate:false"):
    assert tag in new or tag in (BASE/'memory-phase-helpers.mjs').read_text()
assert 'continue-1800s' not in new and 'HeapProfiler.' not in new and 'global.gc' not in new and 'collectGarbage' not in new
assert "assert.equal(lease.diagnosticKind,'memory-phase-v1')" in new and "continue-memory-phase-two-rounds" in new
assert "runMemoryPhase({" in new and "Runtime.getHeapUsage" in new and "process.memoryUsage()" in new
wold=(BASE/'wrapper-scope-diagnostic.m').read_text();wnew=(BASE/'wrapper-memory-phase-diagnostic.m').read_text()
expected=wold.replace('/b11-recovery/run-scope-diagnostic.mjs','/b11-recovery/run-memory-phase-diagnostic.mjs').replace('![cfg[@"diagnosticOnly"] isEqual:@YES]','![cfg[@"diagnosticOnly"] isEqual:@YES] || ![cfg[@"diagnosticKind"] isEqual:@"memory-phase-v1"]').replace('timeIntervalSinceNow>300','timeIntervalSinceNow>720').replace('@"full2400s-watchdog"','@"memory-phase-720s-watchdog"')
assert wnew==expected
launch=(BASE/'launch-memory-phase-diagnostic.mjs').read_text()
dry=launch[:launch.index("assert.deepEqual(process.argv.slice(2),['--memory-phase-approved']);")]
assert "execFileSync(" not in dry and "mkdir(" not in dry and "mkdtemp(" not in dry and "spawn(" not in dry
assert "driver=join(BASE,'run-memory-phase-diagnostic.mjs')" in launch and "execFileSync(cli,['--version']" in launch
assert "WATCHDOG_SECONDS*1000" in launch and "stop-wrapper.private.json" in launch and "cleanup-scope-diagnostic.py" in launch
new_files=['run-memory-phase-diagnostic.mjs','memory-phase-helpers.mjs','own_scope_native_memory_diagnostic.py','native-passive-poll.mjs','same-click-point.mjs','scope_mismatch_diagnostics.py','closure_contract.py','coalition_accounting.py','cpu_collector.py','lease_probe.py','electron-harness.mjs','electron-isolation-paths.mjs','wrapper-memory-phase-diagnostic.m','launch-memory-phase-diagnostic.mjs','cleanup-scope-diagnostic.py','own_scope_native.py','memory-phase-preflight.py','memory-phase-replay.mjs']
for f in new_files:
    p=BASE/f;assert p.is_file() and not p.is_symlink()
    if f.endswith('.mjs'):run(['node','--check',str(p)])
    if f.endswith('.py'):ast.parse(p.read_text())
run(['/usr/bin/clang','-fsyntax-only',str(BASE/'wrapper-memory-phase-diagnostic.m')])
expr=json.loads(run(['node',str(REPO/'scripts/lib/check-cdp-expressions.mjs'),str(BASE/'run-memory-phase-diagnostic.mjs')]))
assert expr['failures']==0 and expr['executed'] is False
replay=json.loads(run(['node',str(BASE/'memory-phase-replay.mjs')]))
assert replay['passed']==len(replay['cases']) and replay['actualAppLaunched'] is False and replay['actualCliExecuted'] is False
launchPins=json.loads(run(['node',str(BASE/'launch-memory-phase-diagnostic.mjs'),'--preflight-only'],timeout=60))
assert launchPins.pop('launched') is False and launchPins.pop('cliExecuted') is False
boundary=launchPins.pop('boundary')
assert launchPins['preservedR6Version']=='codex-cli 0.169.0' and launchPins['pin']==r6['pin'] and launchPins['nativePin']==r6['nativePin'] and launchPins['cliPin']==r6['cliSha256']
result={'schema':'M16-B11-C28-memory-phase-diagnostic-static-preflight-v1','staticOnly':True,'actualAppLaunched':False,'actualCliExecuted':False,'newNativeObservation':False,'formalEligible':False,'launchPins':launchPins,'launchBoundary':boundary,'sourcePins':{f:sha(BASE/f) for f in new_files},'originalR6AndR5SourcePinsUnchanged':True,'actualHistoricalClosedReplay':{'C27':18,'R6':44},'actualR4RetryAndR5FatalPreserved':True,'nativeCollectorOnlyThreeNumericFieldsFromPriorBoundUsage':True,'nativeControlledFunctionCases':controls,'offlinePhaseReplay':replay,'syntax':{'nodeFiles':sum(x.endswith('.mjs') for x in new_files),'pythonFiles':sum(x.endswith('.py') for x in new_files),'wrapperSyntaxOnly':True,'cdpLiteralExpressionCheck':expr},'originalR6WorkloadAndCleanupUnchanged':True,'safetyBoundary':'No new App/CLI/model/process or listener. Static launch pin hashes only. Actual version/permission and fresh owned scope still must pass when coordinator runs.'}
dest=BASE/'memory-phase-preflight.json'
dest.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n');dest.chmod(0o600)
print(json.dumps({'path':str(dest),'sha256':sha(dest),'nativeFunctionControls':len(controls),'phaseControls':replay['passed'],'historicalEndpoints':62,'actualAppLaunched':False,'actualCliExecuted':False,'formalEligible':False}))

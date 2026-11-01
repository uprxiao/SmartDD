import hashlib,json,re
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path('/private/tmp/willyou-m11-s1a')
E=ROOT/'evidence/composition-remainder-preparation/attempt-001'
OLD=ROOT/'evidence/composition/attempt-001'
SOURCE=ROOT/'source-attempt-003'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(n,d):(E/n).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def normalize(x):return ('src/'+x['file'].split('/src/')[-1],x['name'])
old=json.loads((E/'collection-source001.json').read_text());new=json.loads((E/'collection-source003.json').read_text())
old_map={normalize(x):x for x in old};new_map={normalize(x):x for x in new}
assert len(old_map)==len(old)==351 and len(new_map)==len(new)==352
ansi=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]');lines=ansi.sub('',(OLD/'test.log').read_text(errors='replace')).splitlines();observed={}
for line in lines:
 m=re.match(r'^\s*([✓×])\s+(src/\S+\.test\.ts) > (.*)$',line)
 if not m:continue
 name=re.sub(r'\s+\d+(?:\.\d+)?ms$','',m.group(3));key=(m.group(2),name)
 assert key not in observed
 assert key in old_map
 observed[key]={'status':'passed' if m.group(1)=='✓' else 'failed','raw':line.strip()}
green={k for k,v in observed.items() if v['status']=='passed'};red={k for k,v in observed.items() if v['status']=='failed'}
assert len(green)==160 and len(red)==1
removed=set(old_map)-set(new_map);added=set(new_map)-set(old_map);assert not removed and len(added)==1
assert next(iter(added))[1].endswith('M11 retains the original local ZenTao reference validator after module composition')
delegated=red|added;pending=set(new_map)-green-delegated;assert len(pending)==190

def entry(k):
 d=new_map.get(k,old_map.get(k));return {'file':k[0],'name':k[1],'line':d['location']['line'],'column':d['location']['column']}
def js_escape(s):return re.sub(r'([.*+?^${}()|\[\]\\])',lambda m:'\\'+m.group(1),s)
def pattern(names):return r'(?:^| > | )(?:'+'|'.join(r'(?: > | )'.join(js_escape(part) for part in n.split(' > ')) for n in names)+')$'
groups=[]
def group(id,file,predicate,title,resources,estimate):
 items=sorted([entry(k) for k in pending if Path(k[0]).name==file and predicate(new_map[k])],key=lambda x:(x['line'],x['name']))
 assert items
 regex=pattern([x['name'] for x in items]);dest=ROOT/f'evidence/composition-remainders/{id}/attempt-001'
 argv=['pnpm','test','src/main/core/applications/__tests__/'+file,'-t',regex,'--maxWorkers=1','--no-file-parallelism','--no-cache','--reporter=verbose','--reporter=json','--outputFile.json='+str(dest/'vitest.json')]
 groups.append({'id':id,'title':title,'file':'src/main/core/applications/__tests__/'+file,'count':len(items),'expectedNames':[x['name'] for x in items],'tests':items,'pattern':regex,'cwd':str(SOURCE),'argv':argv,'logPath':str(dest/'test.log'),'evidenceDirectory':str(dest),'resourceNeeds':resources,'estimatedSeconds':estimate,'estimateBasis':'Planning estimate only; full beforeEach/afterEach retained. No new timing measurement or assertion execution was performed.','outerProtectionSeconds':180,'individualThresholdsUnchanged':True,'status':'prepared-awaiting-coordinator-resource-grant','testExecutions':0})
light=['shared-dependencies-readonly','private-filesystem','private-SQLite','no-GUI','no-real-external-services']
integration=light+['private-Unix-sockets','private-generated-runtime-and-bundles-only','synthetic-Agent-version-fixtures-only','require_escalated-for-local-listening']
http=integration+['private-127.0.0.1-HTTP-server']
group('M11-S1A-R01','config-view-registry.test.ts',lambda x:True,'Configuration conversion contract and extension schemas',['shared-dependencies-readonly','private-filesystem','no-GUI'],[5,20])
group('M11-S1A-R02','connection-service.test.ts',lambda x:True,'Connection revisions, candidates, schema views and encrypted storage boundary',light,[10,45])
group('M11-S1A-R03','selection-service.test.ts',lambda x:True,'Explicit project slots, revisions and stop-before-switch',light,[10,45])
group('M11-S1A-R04','application-impact.test.ts',lambda x:True,'Read-only impact and trusted run scope',integration,[15,55])
group('M11-S1A-R05','business-data.test.ts',lambda x:x['location']['line']<230,'Host Data API: draft/resource identity, scopes, credentials and lifecycle',integration,[50,135])
group('M11-S1A-R06','business-data.test.ts',lambda x:230<=x['location']['line']<296,'Durable business resources, pagination and local cache lifecycle',integration,[30,100])
group('M11-S1A-R07','business-data.test.ts',lambda x:x['location']['line']>=296,'Trusted UI forms, diagnostics, failure provenance and status cancellation',integration,[35,110])
group('M11-S1A-R08','zentao-data.test.ts',lambda x:102<=x['location']['line']<149,'ZenTao UI read cancellation, health metadata and one retry budget',http,[45,125])
group('M11-S1A-R09','zentao-data.test.ts',lambda x:149<=x['location']['line']<271,'ZenTao assigned scope, pagination, detail/resources and source identity',http,[50,135])
group('M11-S1A-R10','zentao-data.test.ts',lambda x:271<=x['location']['line']<305,'ZenTao provider Retry-After, authentication denial and scope',http,[30,100])
group('M11-S1A-R11','zentao-data.test.ts',lambda x:x['location']['line']>=305,'ZenTao source disappearance, persistent references and account recovery',http,[30,105])
group('M11-S1A-R12','mail-send-data.test.ts',lambda x:True,'Remaining SMTP revocation, unknown results, lifecycle and secret rotations',integration+['private-127.0.0.1-SMTP-server','private-native-probes'],[45,125])
assigned=[(t['file'],t['name']) for g in groups for t in g['tests']];assert len(assigned)==len(set(assigned))==190 and set(assigned)==pending

mapping=[]
for k in sorted(new_map):
 d=entry(k)
 if k in green:d.update({'status':'observed-passed-only','sourceEvidence':str(OLD/'test.log'),'sourceAttempt':'001','sourceManifestSha256':'954678b2cb036b2808439c1159a10d3c31249f9dd57c3f82c910e9aa4a1ebf77','boundary':'No complete Vitest JSON; this is a software-stage observation on source001. Unchanged collection names alone do not prove source003 behavior or a formal M11 case pass.'})
 elif k in red:d.update({'status':'original-timeout-assigned-U003','owner':'U003','sourceAttempt':'001','observedMilliseconds':16904,'originalThresholdMilliseconds':15000,'executorWillRerun':False})
 elif k in added:d.update({'status':'new-regression-assigned-U003','owner':'U003','executorWillRun':False})
 else:d.update({'status':'prepared-not-executed','group':next(g['id'] for g in groups if k in {(t['file'],t['name']) for t in g['tests']})})
 mapping.append(d)
write('complete-mapping.json',{'schema':'m11-s1a-complete-name-mapping-v1','source001Count':351,'source003Count':352,'mappedCount':len(mapping),'observedPassed':160,'originalTimeout':1,'newSource003Tests':1,'executorPending':190,'namesRemoved':0,'unmatchedObservedNames':0,'duplicateNames':0,'formalM11NewPassed':0,'tests':mapping})
write('remaining-original.json',{'schema':'m11-s1a-original-unfinished-v1','source':'source001','notObserved':190,'originalFailed':1,'count':191,'tests':[{'file':k[0],'name':k[1],'status':'original-timeout-assigned-U003' if k in red else 'not-observed'} for k in sorted(set(old_map)-green)]})
write('task-test-partitions.json',{'schema':'m11-s1a-remainder-preparation-v1','at':datetime.now(timezone.utc).isoformat(),'source':str(SOURCE),'sourceManifestSha256':'74d2d7b7dc4e5ca376620f3b1624a14198cf26e0b857bc92a44dcfe1cc081f1a','collectionCount':352,'pendingCount':190,'groupCount':len(groups),'groups':groups,'excludedOriginalTimeout':[entry(k) for k in red],'excludedNewZenTaoRegression':[entry(k) for k in added],'observedSource001PassedCount':160,'observedPassedBoundary':'Software-stage observations only. Coordinator must assess impact before carrying evidence to source003. No complete old JSON and no formal M11 completion claim.','executionAuthorization':'Preparation only. Await coordinator allocation before any pnpm test argv.','testExecutions':0,'formalM11NewPassed':0})
print(json.dumps({'old':len(old),'new':len(new),'observedPassed':160,'redAssignedU003':1,'newAssignedU003':1,'pending':190,'groups':[{'id':g['id'],'count':g['count'],'estimatedSeconds':g['estimatedSeconds']} for g in groups]},ensure_ascii=False))

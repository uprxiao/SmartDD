from pathlib import Path
import json,hashlib,shutil
old=Path('/private/tmp/willyou-m12-p069-parked-resource-001/source018-preparation-004')
new=Path('/private/tmp/willyou-m12-p086-rss-diagnostic-001')
assert not new.exists();new.mkdir(mode=0o700)
p=json.loads((old/'prepared.json').read_text());pre=json.loads((old/'static-preflight.json').read_text());sd=json.loads((old/'sampler-dependencies.json').read_text());cp=json.loads((old/'coalition-proof-pin.json').read_text())
paths={e['path'] for e in pre['inputs']+p['sourceFiles']+p['privateDependencies']+sd['privatePsutilFiles']+cp['files']}
for name in paths:
 f=old/name;o=new/name;o.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,o)
for name in ['run.mjs','prepare-pin.mjs','preflight.mjs']:
 f=new/name;f.write_text(f.read_text().replace(str(old),str(new)))
pin=json.loads((new/'package-pin.json').read_text());pin['formalLongRun']=False;pin['shortCpuPreflight']=True;pin['diagnosticOnly']='P086 passive main memory/GC observation, 60 seconds after same five CLI; original T111 unchanged/no case credit'
(new/'package-pin.json').write_text(json.dumps(pin,indent=2)+'\n')
f=new/'run.mjs';s=f.read_text();assert s.count('const SHORT_CPU_PREFLIGHT=false;')==1;s=s.replace('const SHORT_CPU_PREFLIGHT=false;','const SHORT_CPU_PREFLIGHT=true;')
s=s.replace("r.shortCpuPreflight=SHORT_CPU_PREFLIGHT;r.formalCaseCredit=0;stage=", "r.shortCpuPreflight=SHORT_CPU_PREFLIGHT;r.formalCaseCredit=0;r.memoryDiagnosticOnly=true;r.originalT111NoCredit=true;await installMemoryObserver();stage=")
s=s.replace('for(const target of [5,10])','for(const target of [5,10,20,30,45,60])')
s=s.replace("const actual=await promise;for(const row", "const actual=await promise;const memory=await memoryObservation(kind);for(const row")
s=s.replace('const sample={...actual,kind,minute,','const sample={...actual,mainMemoryDiagnostic:memory,kind,minute,')
insert=r'''
const memoryObserverKey='willyou.m12.p086.passive-memory';
async function mainSync(body,label){const expression=`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App required');${body}})()`;new Function(expression);return app.mainEvaluate(expression,{label,synchronous:true});}
async function installMemoryObserver(){r.memoryObserver=await mainSync(`const key=Symbol.for(${JSON.stringify(memoryObserverKey)});if(globalThis[key])throw Error('No observer rearm');const {PerformanceObserver,performance}=process.getBuiltinModule('perf_hooks');if(!PerformanceObserver.supportedEntryTypes.includes('gc'))throw Error('Actual GC observer unsupported');const state={events:[],dropped:0};const observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){if(state.events.length===256){state.events.shift();state.dropped++;}state.events.push({startTime:e.startTime,duration:e.duration,kind:e.detail?.kind??null,flags:e.detail?.flags??null});}});state.observer=observer;globalThis[key]=state;observer.observe({entryTypes:['gc']});return{pid:process.pid,performanceTimeOrigin:performance.timeOrigin,installedAt:performance.now(),boundedEvents:256,forcedGC:false,passiveDiagnosticOnly:true};`,'install-memory-observer');}
async function memoryObservation(kind){if(!r.memoryObserver)return null;const value=await mainSync(`const state=globalThis[Symbol.for(${JSON.stringify(memoryObserverKey)})];if(!state)throw Error('Observer missing');const v8=process.getBuiltinModule('v8'),perf=process.getBuiltinModule('perf_hooks').performance;return{pid:process.pid,at:Date.now(),performanceNow:perf.now(),memory:process.memoryUsage(),heap:v8.getHeapStatistics(),spaces:v8.getHeapSpaceStatistics(),gcEvents:state.events.splice(0),dropped:state.dropped};`,'read-memory-observation');await appendFile(root+'/main-memory.jsonl',JSON.stringify({kind,...value})+'\n');return value;}
async function removeMemoryObserver(){if(!app||!r.memoryObserver)return;await memoryObservation('before-observer-removal');r.memoryObserverRemoval=await mainSync(`const key=Symbol.for(${JSON.stringify(memoryObserverKey)}),state=globalThis[key];if(!state)throw Error('Observer missing');state.observer.disconnect();delete globalThis[key];return{removed:!globalThis[key],forcedGC:false};`,'remove-memory-observer');}
'''
needle='async function helperInventory()';assert s.count(needle)==1;s=s.replace(needle,insert+'\n'+needle)
s=s.replace("await clean('normal-own-App-quit',()=>normalQuit());", "await clean('remove-passive-memory-observer',()=>removeMemoryObserver());await clean('normal-own-App-quit',()=>normalQuit());")
f.write_text(s)
lineage={'purpose':'Investigate observed largest main-process RSS growth with actual heap/external/space and passive GC timing; no proof of retention/leak from RSS alone.','basedOn':str(old),'originalSourceManifestSha256':p['sourceManifestSha256'],'asarSha256':p['package']['asarSha256'],'nativeExecuted':False,'formalCaseCredit':0,'intervalSeconds':60,'changes':['Fresh private runtime/cache; same production/App and original five parked tasks/local fixture/nativeCLI','Original full 1800s branch and six original analysis/plot/receiver/sampler/cleanup scripts kept; only explicit short diagnostic mode extends to60s','Bounded passive Node GC observer and six additional read-only main memory samples; no forceGC/no audit clearing/no timer/threshold/sample-point edits for formal T111','Observer explicitly disconnected before normal App quit; all existing normal cleanup retained'],'primaryReference':'https://nodejs.org/api/perf_hooks.html#garbage-collection-gc-details','uncertainty':'Actual Electron support/GC events/retained object causes not yet validated; no Native lease until root review.'}
(new/'diagnostic-lineage.json').write_text(json.dumps(lineage,indent=2)+'\n')
print(str(new), 'copied explicit files',len(paths))

import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {repo,support,expectedArgs,digest,verifyPins} from '../guards.mjs';
import {coreStates} from './states.mjs';
import {loadRetained,rowKey} from './retained.mjs';
import {addressRecoveryAction} from './stop-contract.mjs';
const dir=join(support,'next-13-resume'),pins=await verifyPins(expectedArgs),retained=await loadRetained(pins,coreStates);
const contract=join(repo,'docs/里程碑/M12_浏览器自动化/验收/S1执行计划.json');
const original=JSON.parse(await readFile(contract,'utf8')).latestT145MatrixScopeDisposition.rows;
assert.equal(original.length,456);const contractKeys=new Set(original.map(x=>x.key)),planned=[];
for(const theme of ['light','dark'])for(const width of [480,900])for(const state of coreStates){
 const key=rowKey('old-clean',theme,width,state).split('|').slice(1).join('|');assert(contractKeys.has(key));
 for(const side of ['old-clean','new'])planned.push(rowKey(side,theme,width,state));
}
assert.equal(new Set(planned).size,104);const needed=planned.filter(k=>!retained.keys.has(k));
assert.equal(needed.filter(k=>k.startsWith('old-clean|')).length,37);assert.equal(needed.filter(k=>k.startsWith('new|')).length,52);
const modal=['B03-invalid-address','B11-grants-empty','B12-profiles-default','B14-settings','B14-settings-restart','B14-settings-clear-confirm'];
for(const theme of ['light','dark'])for(const width of [480,900]){
 const n=modal.filter(s=>retained.keys.has(rowKey('old-clean',theme,width,s))).length;assert(n===0||n===modal.length);
}
const files=['driver.mjs','states.mjs','stop-contract.mjs','retained.mjs','preflight.mjs','review.py','front-observer','front-observer.m'];
for(const n of files.filter(x=>x.endsWith('.mjs')))execFileSync(process.execPath,['--check',join(dir,n)]);
const cdp=JSON.parse(execFileSync(process.execPath,[join(repo,'scripts/lib/check-cdp-expressions.mjs'),join(dir,'driver.mjs'),join(dir,'states.mjs'),join(support,'isolated-electron.mjs')],{encoding:'utf8'}).trim());assert.equal(cdp.failures,0);
execFileSync('python3',['-c','import ast,sys;from PIL import Image,ImageCms;ast.parse(open(sys.argv[1]).read())',join(dir,'review.py')]);
// Read code only from the exact package bytes, never execute a renderer or a native executable.
const pkgLogic=JSON.parse(execFileSync('python3',['-c',`import struct,json,sys,hashlib
result=[]
for path in sys.argv[1:]:
 with open(path,'rb') as f:
  _,h,_,j=struct.unpack('<IIII',f.read(16));header=json.loads(f.read(j));start=8+h
  assets=header['files']['out']['files']['renderer']['files']['assets']['files']
  name=next(n for n in assets if n.startswith('index-') and n.endswith('.js'));v=assets[name]
  f.seek(start+int(v['offset']));raw=f.read(v['size']);data=raw.decode()
  a=data.index('function tabAddress(tab)');b=data.index('setAddress(displayedAddress);',a);c=data.index('setAddress(displayedAddress);',b+1)
  result.append({'path':path,'asset':name,'assetSha':hashlib.sha256(raw).hexdigest(),'tabAddress':data[a:a+data[a:].index('}')+1], 'effect':data[b-40:b+110], 'Escape':data[c-75:c+100]})
print(json.dumps(result))
`,...pins.specs.map(s=>join(s.bundle,'Contents/Resources/app.asar'))],{encoding:'utf8'}));
for(const p of pkgLogic){assert(p.tabAddress.includes('tab.url === BROWSER_BLANK_URL ? tab.pendingUrl ?? tab.failure?.url ?? "" : tab.url'));assert(p.effect.includes('[tabId, displayedAddress, tab.failure]'));assert(p.Escape.includes('event.key === "Escape"')&&p.Escape.includes('event.currentTarget.blur()'));}
const raw=retained.oldRaw,failed=raw.captures.find(x=>x.state==='B02-loading-stop'),hold=raw.slowRequests[0],t=failed.loading.t;
const priorData=raw.sides[0].isolated.userData,task=failed.loading.s.taskId,committedUrl=t.url,submittedUrl='http://127.0.0.1:3425'+hold.path+hold.query;
assert(/^\/private\/tmp\/willyou-m16-b09-c28-side-[a-zA-Z0-9]+\/data$/.test(priorData));
assert.equal(await realpath(priorData),priorData);
const disk=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json,sys
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro&immutable=1",uri=True)
rows=c.execute("select value from app_settings where key=?",("browserWorkspace.v1:"+sys.argv[2],)).fetchall()
assert len(rows)==1
print(rows[0][0])
`,join(priorData,'smartdd.db'),task],{encoding:'utf8'}));assert.equal(disk.activeId,t.id);assert(disk.tabs.some(x=>x.id===t.id&&x.url===committedUrl));assert.equal(hold.responseCompleted,false);
// The failed run did not retain post-Stop DOM value. Replay the actual retained
// task/page/committed URL and real submitted URL, as the two conditional values
// which the corrected live function will discriminate; no fabricated actual DOM.
const incoming={taskId:task,pageId:t.id,workspaceVisible:true,stopVisible:false,refreshVisible:true};
const context={task,page:t.id,committedUrl,submittedUrl};
const staleBranch=addressRecoveryAction({...incoming,address:submittedUrl},context);
const resetBranch=addressRecoveryAction({...incoming,address:committedUrl},context);
assert.equal(staleBranch,'click-exact-address-and-normal-Escape');assert.equal(resetBranch,'already-committed-address');
assert.throws(()=>addressRecoveryAction({...incoming,address:'unexpected'},context));assert.throws(()=>addressRecoveryAction({...incoming,taskId:'not-owned',address:submittedUrl},context));
assert.throws(()=>addressRecoveryAction({...incoming,stopVisible:true,address:submittedUrl},context));
const c23Path=join(repo,'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125/candidate-23-history-projection-idle-clock/B09-six-original-states-paired-actual/index.json');
const c23=JSON.parse(await readFile(c23Path,'utf8')),former=c23.captures.filter(c=>c.state==='B02-loading-stop');assert.equal(former.length,8);for(const c of former){const s=c.stopped.s,tab=s.tabs.find(t=>t.id===s.activeId);assert(c.passed&&tab&&!tab.loading&&tab.url===committedUrl&&c.stopped.closedAt>c.slowStart.at);}
const summary={schema:'B09-13-resume-EhnMPS-static-provenance-and-stop-replay',pins,retained:retained.provenance,neededCount:needed.length,requiredOld:37,requiredNew:52,needed,planned,files:Object.fromEntries(await Promise.all(files.map(async n=>[n,await digest(join(dir,n))]))),cdp,
 actualRawGuardInput:{task,page:t.id,committedUrl,submittedUrl,loading:failed.loading,slow:hold,storedWorkspace:disk,priorError:raw.error},
 replay:{sameNonblankCommittedURLInBothActualPackageEffects:true,conditionalBranches:{staleExactSubmitted:staleBranch,alreadyReset:resetBranch,wrongAddressTaskOrStillLoading:'rejected'},boundary:'Input URLs and task/page/persisted state are actual EhnMPS artifacts; its exact post-Stop DOM value was not recorded. These conditional replay observations are not live screenshots/DOM or a Stop pass.'},
 packageSource:pkgLogic,archivedStandards:{file:c23Path,sha:await digest(c23Path),actualPriorStopCount:former.length,originalEvidence:'host same committed tab, loading false, held connection close. This new live recovery additionally requires same native WC/renderer/timeOrigin/marker and real visible address after Escape; no navigation.'},
 actualAppLaunch:false,actualSystemInput:false,actualNewCaptures:0};
console.log(JSON.stringify(summary,null,2));

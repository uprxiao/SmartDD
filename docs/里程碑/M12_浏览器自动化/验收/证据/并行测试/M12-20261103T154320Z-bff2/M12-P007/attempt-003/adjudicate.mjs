import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root='/private/tmp/willyou-m12-t065-executor-001/attempt-003',read=async name=>JSON.parse(await readFile(join(root,name),'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=await read('raw-result.json'),cleanup=await read('cleanup.json'),prepared=await read('prepared.json'),events=await read('site-events.parsed.json'),checks=[];
const check=(id,pass,actual)=>checks.push({id,status:pass?'passed':'failed',actual});
const parse=row=>{try{return JSON.parse(row.raw.stdout)}catch{return null}};
const state=row=>{const p=parse(row),v=p?.data?.value??p?.data?.result;return typeof v==='string'?JSON.parse(v):v};
const expectations=new Map();
for(const locator of ['role','text','label','placeholder','title','testid','first','last','nth'])expectations.set(locator+'-fill','VALUE_'+locator+'_fill');
for(const locator of ['text','title','role'])for(const flag of ['name','exact'])expectations.set('literal-'+locator+'-'+flag,'--'+flag);
expectations.set('nth-quoted-fill','A B "quoted" 中文🙂');
expectations.set('empty-input-fill','');expectations.set('empty-editable-fill','');expectations.set('nested-editable-fill','NESTED_VALUE 中文🙂');expectations.set('nested-editable-empty','');
check('complete-affected-fill-subset',JSON.stringify(raw.cases.map(c=>c.id).sort())===JSON.stringify([...expectations.keys()].sort())&&JSON.stringify(raw.notApplicable.map(c=>c.id))===JSON.stringify(['alt-fill']),{expected:[...expectations.keys()],executed:raw.cases.map(c=>c.id),notApplicable:raw.notApplicable});
for(const c of raw.cases){
 if(!expectations.has(c.id)||!c.find||!c.readback){check(c.id,false,{failureClass:'driver-or-fixture',record:c});continue}
 const parsed=parse(c.find),after=state(c.readback),before=c.ready?.state,old=before?.elements?.find(e=>e.id==='target'),target=after?.elements?.find(e=>e.id==='target'),site=events.filter(e=>e.caseId===c.id&&e.phase==='event'),fresh=(after?.events??[]).slice(before?.events?.length??0),input=fresh.filter(e=>e.type==='input'&&e.id==='target'),siteInput=site.filter(e=>e.event?.type==='input'&&e.event?.id==='target');
 const expected=expectations.get(c.id),correctInitial=old?.value==='T065 '+c.id,nested=!c.id.startsWith('nested-')||typeof old?.html==='string'&&old.html.includes('<b>')&&old.html.includes('<span><i>'),effect=target?.value===expected&&input.length>0&&siteInput.length>0,trusted=input.every(e=>e.trusted===true)&&siteInput.every(e=>e.event.trusted===true),noDecoy=fresh.every(e=>!String(e.id).startsWith('decoy'))&&(before?.elements??[]).filter(e=>e.id!=='target').every(e=>after?.elements?.some(a=>a.id===e.id&&a.value===e.value));
 const argv=c.nativeFindCalls?.at(-1)?.args??[],nativePayload=c.locator==='nth'?argv[0]==='find'&&argv[1]==='nth'&&argv[2]==='1'&&argv[3]===(c.id==='nth-quoted-fill'?'.candidate[data-name="A B"]':'.candidate')&&argv[4]==='fill'&&argv[5]===expected:argv[0]==='find'&&argv[1]===c.locator&&argv.includes('fill')&&argv[argv.indexOf('fill')+1]===expected;
 let helperRows;try{helperRows=JSON.parse(c.nativeHelperRaw?.at(-1)?.stdout??'null')}catch{}
 const helperSuccess=Array.isArray(helperRows)&&helperRows.length===1&&helperRows[0]?.success===true;
 const passed=c.status==='executed'&&c.find.raw.code===0&&parsed?.schema==='willyou-app-result-v2'&&c.readback.raw.code===0&&correctInitial&&nested&&effect&&trusted&&noDecoy&&nativePayload&&helperSuccess;
 check(c.id,passed,{failureClass:passed?null:!correctInitial||!nested?'driver-or-fixture':'product-or-contract',expected,actual:target?.value,correctInitial,nested,effect,trusted,noDecoy,nativePayload,helperSuccess,before,after,siteEvents:site,rawFind:c.find.raw,nativeFindCalls:c.nativeFindCalls,nativeHelperRaw:c.nativeHelperRaw});
}
check('raw-helper-observation-active',Array.isArray(raw.traceFinal?.rawHelpers)&&raw.traceFinal.rawHelpers.length>0,{records:raw.traceFinal?.rawHelpers?.length??0});
check('trace-restored',cleanup.traceRestore?.restored&&cleanup.traceRestore.helperPrototypeRestored&&cleanup.traceRestore.proxyPrototypeRestored&&cleanup.traceRestore.execFileRestored,cleanup.traceRestore);
const helperCleanups=[...(cleanup.service?.helpers??[]),...(cleanup.service?.retiredHelperCleanups??[]).map(x=>x.cleanup)];
check('native-cleanup',cleanup.hostExit?.code===0&&!cleanup.hostExit.signal&&cleanup.siteClosed&&cleanup.service?.closed&&helperCleanups.every(h=>['stopped','absent'].includes(h.daemonState)&&h.clientStopped&&h.socketFilesRemoved)&&cleanup.pidStates.every(p=>!p.running),cleanup);
const hashes=await read('source-hash-preflight.json');for(const f of hashes.files)assert.equal(sha(await readFile(join(raw.baseline,f.path))),f.sha256,f.path);for(const f of prepared.resourceFiles)assert.equal(sha(await readFile(join(root,'resources',f.path))),f.sha256,f.path);for(const f of prepared.dependencies)assert.equal(sha(await readFile(join(root,f.path))),f.sha256,f.path);assert.equal(sha(await readFile(join(root,'build/host.cjs'))),prepared.hostSha256);
check('frozen-inputs-unchanged',true,{files:hashes.count,hostSha256:prepared.hostSha256,helperSha256:prepared.helperSha256});
await writeFile(join(root,'source-hash-final.json'),JSON.stringify({at:new Date().toISOString(),allMatched:true,count:hashes.count,hostSha256:prepared.hostSha256,helperSha256:prepared.helperSha256},null,2)+'\n');
const status=checks.every(c=>c.status==='passed')?'passed':'failed',result={caseId:'M12-T065',layer:'I',status,scope:'20 affected fill scenarios only; entire T065 verdict requires coordinator to combine unaffected .2 results after verifying patch-scope-comparison.json',at:new Date().toISOString(),checks,requiresT052:'t052-adjudication.json; independently rerun for .3',reuse:'patch-scope-comparison.json; no unaffected native actions or parser negatives executed in this attempt',boundary:raw.boundary,runnerFailure:raw.error??null,raw:'raw-result.json'};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status,checks:checks.length,failed:checks.filter(c=>c.status!=='passed').map(c=>c.id),wholeCaseNotCountedHere:true}));

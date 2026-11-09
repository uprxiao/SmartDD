// Actual immutable 003 stdout, OS result, and exact Host rows; pure checks only.
import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';
import{assertCliProof,parseCliActual,cliPlan}from'./cli-proof.mjs';
import{ROOT,sha}from'./io.mjs';
export async function runParserControls(){
 const bytes=await readFile(ROOT+'/parser-samples.json'),fixture=JSON.parse(bytes),c=fixture.context,checks=[];
 const rows=fixture.samples.map(x=>({...structuredClone(x),parsed:JSON.parse(x.actual.stdout)}));assert.equal(rows.length,10);assert.equal(cliPlan(c).length,14);assert.equal(new Set(cliPlan(c).map(x=>x.tag)).size,14);
 for(const row of rows){const before=JSON.stringify(row),proof=assertCliProof(row,c);assert.equal(JSON.stringify(row),before);checks.push({name:'actual003-'+row.tag,accepted:true,kind:proof.kind});}
 const good=rows[0],bad=rows.find(x=>x.expectedCode===2);assert(bad);const uuid='00000000-0000-4000-8000-000000000000';
 const reject=(name,mutate,base=bad)=>{const row=structuredClone(base),ctx=structuredClone(c);mutate(row,ctx);assert.throws(()=>assertCliProof(row,ctx),undefined,name);checks.push({name,rejected:true})};
 const stdout=(row,fn)=>{const p=JSON.parse(row.actual.stdout);fn(p);row.actual.stdout=JSON.stringify(p)+'\n';row.parsed=JSON.parse(row.actual.stdout)};
 reject('wrong-operation-id',x=>stdout(x,p=>p.operationId=uuid));reject('wrong-request-id',x=>stdout(x,p=>p.requestId=uuid));
 reject('wrong-current-host-sourcehash',x=>x.host[0].package_hash='0'.repeat(64));reject('wrong-success-sourcehash',x=>stdout(x,p=>p.source.packageHash='0'.repeat(64)),good);
 reject('wrong-exit',x=>x.actual.code=0);reject('string-exit',x=>x.actual.code='2');reject('string-attempt',x=>stdout(x,p=>p.error.attemptCount='1'));reject('null-error',x=>stdout(x,p=>p.error=null));reject('nonstring-id',x=>stdout(x,p=>p.operationId=2));reject('wrong-error-code',x=>stdout(x,p=>p.error.code='NOT_FOUND'));reject('wrong-error-effect',x=>stdout(x,p=>p.error.effectState='completed'));
 reject('cross-run',x=>x.host[0].run_id=uuid);reject('cross-task',x=>x.host[0].task_id=uuid);reject('cross-project',x=>x.host[0].project_id=uuid);reject('wrong-app',x=>x.host[0].app_id='files');
 reject('duplicate-host',x=>x.host.push(structuredClone(x.host[0])));reject('missing-host',x=>x.host=[]);reject('wrong-host-state',x=>x.host[0].state='succeeded');reject('wrong-host-effect',x=>x.host[0].effect_state='completed');reject('wrong-host-attempt',x=>x.host[0].attempt_count=2);
 reject('wrong-host-tool',x=>x.host[0].tool_name='browser.cookie.get');reject('wrong-stockCLI-hash',(_x,ctx)=>ctx.receiver.binarySha256='0'.repeat(64));reject('wrong-stockCLI-path',(_x,ctx)=>ctx.receiver.binary='/tmp/not-stock-cli');
 reject('wrong-os-argv',x=>x.actual.argv.push('--wrong'));reject('signal',x=>x.actual.signal=15);reject('timeout',x=>x.actual.timedOut=true);reject('cleanup-signal',x=>x.actual.cleanupSignals=['SIGTERM']);
 reject('forged-success-error-envelope',x=>stdout(x,p=>p.schema='willyou-app-result-v2'));reject('rewritten-parsed',x=>x.parsed.operationId=uuid);reject('success-non-v2',x=>stdout(x,p=>p.schema='legacy'),good);reject('success-wrong-origin',x=>stdout(x,p=>p.operation.origin='api'),good);
 assert.deepEqual(Object.keys(parseCliActual(bad,c).parsed).sort(),['error','operationId','requestId']);
 return{sampleSHA256:sha(bytes),source:fixture.source,actualPositives:rows.length,negatives:checks.filter(x=>x.rejected).length,checks,allPassed:true,NativeAppOSModelExecuted:false,scope:'Pure original CLI protocols, original stdout/OS numbers, unique Host identity. No new business execution.'};
}

import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {claudeNormalizer} from '/private/tmp/willyou-m14-contract-probe/adapters.mjs';
const root=import.meta.dirname,first=join(root,'attempt-3A7490'),last=join(root,'attempt-pLN4zy');
const read=(p,f)=>JSON.parse(readFileSync(join(p,f),'utf8')),lines=(p,f)=>readFileSync(join(p,f),'utf8').trim().split('\n').map(JSON.parse);
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
const records=[];
for(const [path,checks] of [[first,read(first,'result.json').checks.slice(0,1)],[last,read(last,'result.json').checks]]){
 const configs=read(path,'config-identities.json');
 for(const check of checks){assert.equal(check.status,'passed');const ds=Array.isArray(check.detail)?check.detail:[check.detail];for(const d of ds){if(!d.id)continue;const c=configs.find(c=>c.id===d.id);assert(c&&d.nativeId);const files=walk(c.cfg).filter(f=>f.endsWith('.jsonl')&&f.includes(d.nativeId));assert.equal(files.length,1,'native record location '+d.id);const content=readFileSync(files[0],'utf8');assert(content.includes('INPUT_'+d.id));assert(!configs.some(other=>other.id!==d.id&&content.includes('INPUT_'+other.id)));records.push({id:d.id,nativeId:d.nativeId,path:files[0],ownInputOnly:true});}}
}
assert.equal(records.length,10);
const lastChecks=read(last,'result.json').checks,proxy=lastChecks.find(c=>c.id==='claude-proxy-denial-no-direct-fallback').detail,auth=lastChecks.find(c=>c.id==='claude-401-does-not-switch-account').detail[0];
assert.equal(proxy.terminal.subtype,'success');assert.equal(proxy.terminal.is_error,true);assert.equal(proxy.terminal.api_error_status,407);assert.equal(proxy.terminal.terminal_reason,'api_error');assert.equal(proxy.hostCancellationRequested,false);assert(proxy.cancelledLifecycle.length>0);
const normalized=claudeNormalizer([proxy.uid],proxy.nativeId)(proxy.terminal);assert.deepEqual(normalized,[{type:'turn.terminal',turnId:proxy.uid,status:'failed'}]);
assert(auth.hostCancellationRequested);assert(auth.retries.some(r=>r.error_status===401));assert(auth.cancelledLifecycle.some(r=>r.command_uuid===auth.uid));assert.equal(auth.terminal.user_message_uuid,auth.uid);assert(auth.terminal.is_error);
const retryNormalized=claudeNormalizer([auth.uid],auth.nativeId)(auth.retries[0]);assert(!retryNormalized.some(e=>e.type==='turn.terminal'));
const barriers=lines(last,'barriers.jsonl');assert.equal(barriers.length,3);assert(barriers.every(b=>b.bothRequestsArrivedBeforeResponses&&b.accounts.length===2));
for(const dir of [first,join(root,'attempt-gkpncI'),last])assert(read(dir,'cleanup.json').every(c=>c.exitCode!==null||c.signal!==null));
writeFileSync(join(root,'audit-result.json'),JSON.stringify({nativeRecords:records,proxySubtypeIsNotSuccess:true,nativeCancelledDoesNotProveHostCancellation:true,proxyCandidateNormalizer:normalized,authRetryDoesNotTerminate:retryNormalized,authHostInterruptHasCorrelatedLifecycle:true,barriers,allAttemptNativeProcessesClosed:true},null,2)+'\n');console.log('Verified 10 isolated native histories, three final-batch overlap barriers, retry/non-terminal and 407/error normalization.');

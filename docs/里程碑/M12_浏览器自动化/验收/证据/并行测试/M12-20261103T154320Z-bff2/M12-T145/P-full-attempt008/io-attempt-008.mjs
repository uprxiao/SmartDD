import assert from 'node:assert/strict';
import {readFile,writeFile,stat,readlink,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const ROOT='/private/tmp/willyou-m12-t145-visual-matrix-prep-001';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const save=(name,value)=>writeFile(ROOT+'/'+name,JSON.stringify(value,null,2)+'\n',{mode:0o600});
export async function permitP(){
 assert(process.argv.includes('--execute'));
 assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node');assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');
 const b=await readFile(ROOT+'/P-execution-ready-attempt-008.json'),ready=JSON.parse(b),lease=JSON.parse(await readFile(ROOT+'/P-lease-attempt-008.receipt.json'));
 assert.equal(lease.mode,process.argv.includes('--representative')?'representative':'full');assert(lease.status==='granted'&&lease.coordinator==='root'&&lease.privateRoot===ROOT&&lease.executionReadySHA256===sha(b));
 const check=()=>{assert(!lease.revoked&&Date.now()>=Date.parse(lease.notBefore)&&Date.now()<Date.parse(lease.expiresAt));for(const k of ['Native','HTTP','TCP','Unix','OS'])assert(lease.resources.includes(k))};check();
 for(const f of ready.inputs){const p=f.external?f.path:ROOT+'/'+f.path;assert.equal(sha(await readFile(p)),f.sha256,p);assert.equal((await stat(p)).mode&511,f.mode,p)}
 const layout=JSON.parse(await readFile(ROOT+'/dependency-layout-attempt-008.json'));for(const x of layout.links){assert.equal(await readlink(ROOT+'/'+x.path),x.target);assert.equal(await realpath(ROOT+'/'+x.path),x.realTarget);assert(x.realTarget.startsWith(ROOT+'/deps/packages/'))}
 for(const x of layout.rootLinks){assert.equal(await readlink(ROOT+'/'+x.path),x.target);assert.equal(await realpath(ROOT+'/'+x.path),x.realTarget);assert(x.path==='reference/source/node_modules'?x.realTarget===ROOT+'/node_modules':x.realTarget.startsWith(ROOT+'/deps/packages/'))}
 assert.equal(await realpath(ROOT+'/reference/source/prototypes/m6-codex/node_modules'),ROOT+'/node_modules');return{ready,lease,check};
}

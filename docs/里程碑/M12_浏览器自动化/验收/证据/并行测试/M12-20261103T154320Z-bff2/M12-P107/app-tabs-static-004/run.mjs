import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyCleanup} from './verify-cleanup.mjs';
import {judge} from './judge.mjs';
const ROOT='/private/tmp/willyou-m12-t130-app021-tabs-004',sha=b=>createHash('sha256').update(b).digest('hex');
assert.deepEqual(process.argv.slice(2),['--execute']);assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node');assert.equal(await realpath(ROOT),ROOT);
const ready=JSON.parse(await readFile(ROOT+'/execution-ready.json'));for(const f of ready.inputs)assert.equal(sha(await readFile(ROOT+'/'+f.path)),f.sha256,f.path);
const p=JSON.parse(await readFile(ROOT+'/pin.json'));assert.equal(p.role,'App021');assert.equal(p.sourceManifestSha256,'fc0804c493320514f4938d76755c6d0bdc9aa42adb41c30813ffedafaa74b6c9');assert.equal(sha(await readFile(p.sourceManifest)),p.sourceManifestSha256);assert.equal(sha(await readFile(p.executable)),p.executableSha256);assert.equal((await stat(p.executable)).mode&511,0o755);
for(const f of p.packageFiles){const path=p.app+'/Contents/Resources/'+f.path;assert.equal(sha(await readFile(path)),f.sha256,path);assert.equal((await stat(path)).mode&511,f.mode,path)}for(const f of p.runtimeCoreFiles){const path=p.app+'/'+f.path;assert.equal(sha(await readFile(path)),f.sha256,path);assert.equal((await stat(path)).mode&511,f.mode,path)}
await writeFile(ROOT+'/execution-started.json',JSON.stringify({startedAt:new Date().toISOString(),pid:process.pid})+'\n',{flag:'wx',mode:0o600});
await mkdir(ROOT+'/runtime-001',{mode:0o700});for(const name of['home','codex','tmp'])await mkdir(ROOT+'/runtime-001/'+name,{mode:0o700});process.env.WILLYOU_FILES_APP=p.executable;
let failure;
try{await import('./scenario.mjs')}catch(error){failure=String(error.stack??error);await writeFile(ROOT+'/driver-error.json',JSON.stringify({error:failure,at:new Date().toISOString()})+'\n');process.exitCode=1;}
finally{
 let r,cleanup;try{r=JSON.parse(await readFile(ROOT+'/runtime-001/result.json'));cleanup=await verifyCleanup(r);await writeFile(ROOT+'/cleanup.json',JSON.stringify(cleanup,null,2)+'\n');}catch(error){await writeFile(ROOT+'/cleanup-error.json',JSON.stringify({error:String(error),at:new Date().toISOString()})+'\n');process.exitCode=1;}
 if(r&&cleanup){const result=judge(r,cleanup);if(failure)result.driverError=failure;await writeFile(ROOT+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root:ROOT,status:result.status,appPid:r.appPid,pids:r.knownPids,ports:r.knownPorts,exactSockets:r.exactSockets,normalExit:r.normalExit,signals:r.harnessProcessReceipt?.signals,allClear:cleanup.allClear}));if(result.status!=='passed-D04-D06-A-only')process.exitCode=1;}
}

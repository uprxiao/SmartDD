// Run once before a software-test batch, with no other batch reading out/.
// A clean checkout needs the same immutable resources/native helpers used by
// the actual build. This does not package an App or grant platform acceptance.
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {buildFileBroker} from './files/build.mjs';
import {buildProcessIdentity} from './applications/build.mjs';
import {buildApplicationRuntime} from './applications/build-runtime.mjs';

const output=resolve(process.argv[2]??'out');
buildFileBroker({output:join(output,'native/willyou-files')});
const identityHelper=buildProcessIdentity({output:join(output,'native/willyou-process-identity')});
let nativeProbe=null;
if(identityHelper){
 // A newly compiled helper must actually be executable and speak the expected
 // protocol before the test batch starts. This setup budget is not the shorter
 // production reader deadline; no PID identity or liveness result is cached.
 const started=Date.now();
 const value=JSON.parse(execFileSync(identityHelper,[String(process.pid)],{encoding:'utf8',timeout:10000,maxBuffer:4096,stdio:['ignore','pipe','pipe']}));
 assert.deepEqual(Object.keys(value).sort(),['pid','schema','startedAt','state']);
 assert.equal(value.schema,1);assert.equal(value.state,'running');assert.equal(value.pid,process.pid);assert.match(value.startedAt,/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/);
 nativeProbe={pid:value.pid,startedAt:value.startedAt,elapsedMs:Date.now()-started};
}
await buildApplicationRuntime(join(output,'applications'));
execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(output,'capability-bundles'),join(output,'applications/mcp-bridge.cjs')],{stdio:'inherit'});
console.log(JSON.stringify({prepared:'software-test resources',output,platform:process.platform,arch:process.arch,nativeProbe,packagedApp:false}));

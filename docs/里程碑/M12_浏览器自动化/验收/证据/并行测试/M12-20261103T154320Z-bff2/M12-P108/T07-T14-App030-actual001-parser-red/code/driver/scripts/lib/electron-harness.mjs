import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openElectron as upstreamOpen} from './electron-harness.upstream.mjs';
const root='/private/tmp/willyou-m12-t131-T07-T14-App030-A-R-prep-001',sha=b=>createHash('sha256').update(b).digest('hex');
const pin=JSON.parse(await readFile(root+'/package-pin.json'));
export async function openElectron(options){
 assert.equal(process.env.WILLYOU_M12_NATIVE_LEASE_CONFIRMED,'1','Coordinator must grant Native/UI lease before actual execution');
 assert.equal(options.executable,pin.executable);assert(options.userData.startsWith(root+'/runs/')&&options.userData.endsWith('/runtime-001/userdata'));
 assert.equal(pin.role,'App030');assert.equal(pin.sourceManifestSha256,'52aea3db113bbe1773c6ea3968dc54d516c7f9bcf706195773367d419a1b6dbe');
 assert.equal(sha(await readFile(pin.app+'/Contents/Resources/app.asar')),pin.asarSha256);assert.equal(sha(await readFile(pin.executable)),pin.executableSha256);
 for(const f of pin.packageFiles){const path=pin.app+'/Contents/Resources/'+f.path;assert.equal(sha(await readFile(path)),f.sha256);assert.equal((await stat(path)).mode&511,f.mode)}
 const app=await upstreamOpen(options),evaluate=app.mainEvaluate.bind(app);
 app.mainEvaluate=async(expression,meta={})=>{assert(typeof expression==='string');new Function(expression);assert(/^[a-z0-9-]{1,64}$/.test(meta.label??'t131-owned-main-expression'),'Main label must be exact lowercase');const wrapped="(()=>{const E=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');if(process.pid!=="+app.processId+"||process.execPath!=="+JSON.stringify(pin.executable)+"||E.app.getPath('userData')!=="+JSON.stringify(options.userData)+")throw Error('Exact isolated App030 main required');return ("+expression+");})()";new Function(wrapped);return evaluate(wrapped,{label:meta.label??'t131-owned-main-expression',...meta})};
 return app;
}

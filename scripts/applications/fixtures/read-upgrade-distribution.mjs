// Controlled compatible distribution target, not a new product release.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function prepareReadUpgradeDistribution(root,oldExecutable,oldPin,currentExecutable,currentPin){
 assert(root.startsWith('/private/tmp/willyou-m10-mail-index-app-'));
 const setup=join(root,'upgrade-fixture'),producer=join(setup,'producer');await mkdir(join(producer,'scripts/applications'),{recursive:true});await mkdir(join(producer,'resources'),{recursive:true});
 const sourceFiles=['scripts/applications/build-bundles.mjs','scripts/applications/verify-bundles.cjs','src/shared/application-module-catalog.json','package.json'];
 for(const path of sourceFiles){await mkdir(dirname(join(producer,path)),{recursive:true});await cp(resolve(path),join(producer,path));}
 await cp(resolve('resources/applications'),join(producer,'resources/applications'),{recursive:true});await cp(resolve('resources/agent-adapters'),join(producer,'resources/agent-adapters'),{recursive:true});
 const definitions=join(producer,'resources/applications/definitions.mjs');await writeFile(definitions,(await readFile(definitions,'utf8'))+"\n// Private compatible upgrade fixture only.\nconst fixtureMail=retainedV1Definitions.find(x=>x.appId==='mail');fixtureMail.version='1.0.5';fixtureMail.description+=' (private read-recovery fixture)';\n");await cp(join(producer,'resources/applications/mail/1.0.4'),join(producer,'resources/applications/mail/1.0.5'),{recursive:true});
 const originals=[];
 for(const [executable,pin]of [[oldExecutable,oldPin],[currentExecutable,currentPin]]){
  assert(executable.startsWith('/private/tmp/willyou-m10-'));const resources=resolve(dirname(executable),'../Resources');assert.equal(sha(await readFile(join(resources,'app.asar'))),pin);const index=JSON.parse(await readFile(join(resources,'capability-bundles/index.json'),'utf8'));originals.push({executable,resources,pin,index});
 }
 assert.deepEqual(originals[0].index.runtimes,originals[1].index.runtimes,'Only a compatible same-runtime target is tested');
 const runtime=originals[1].index.runtimes[0],entry=join(originals[1].resources,'capability-bundles',runtime.path,runtime.bridgeEntry),bundles=join(setup,'capability-bundles');
 const output=execFileSync(process.execPath,[join(producer,'scripts/applications/build-bundles.mjs'),bundles,entry,'--retained-v1-test-fixture'],{cwd:producer,encoding:'utf8',timeout:20000});await writeFile(join(setup,'bundle-build.log'),output);
 const index=JSON.parse(await readFile(join(bundles,'index.json'),'utf8'));assert.equal(index.apps.find(a=>a.appId==='mail').version,'1.0.5');assert.notEqual(index.build.resourceSetHash,originals[1].index.build.resourceSetHash);
 const variants=[];
 for(const [position,original]of originals.entries()){
  const app=join(setup,position===0?'negative-LB.app':'positive-current.app');assert(!existsSync(app));execFileSync('/bin/cp',['-cR',resolve(dirname(original.executable),'../..'),app],{stdio:'pipe',timeout:20000});const resources=join(app,'Contents/Resources');assert(resources.startsWith(setup+'/'));await rm(join(resources,'capability-bundles'),{recursive:true});await cp(bundles,join(resources,'capability-bundles'),{recursive:true});assert.equal(sha(await readFile(join(resources,'app.asar'))),original.pin);
  variants.push({executable:join(app,'Contents/MacOS/WillYou'),asar:original.pin,source:original.executable,indexHash:index.indexHash,resourceSetHash:index.build.resourceSetHash});
 }
 return{layer:'I: same compatible mail1.0.5 distribution in two private App copies; main ASARs unchanged; modified resource/signature envelope, not installation/release acceptance',producer,definitionsSha256:sha(await readFile(definitions)),index,variants};
}

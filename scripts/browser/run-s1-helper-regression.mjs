// Sequential native groups under one frozen production baseline. The coordinator owns this file/round.
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir, cp, rename } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const [output]=process.argv.slice(2);
if(!output?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Explicit private output required');
await mkdir(output,{recursive:false});
const roundFile=resolve('docs/里程碑/M12_浏览器自动化/验收/并行测试/轮次/M12-20261103T092732Z-s1a/轮次记录.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(root){const result=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())result.push(...await files(path));else if(entry.isFile())result.push(path);}return result;}
const spec=JSON.parse(await readFile('resources/agent-browser/SOURCE.json','utf8')),source=JSON.parse(await readFile('out/agent-browser/SOURCE.json','utf8'));
if(spec.patch.sha256!==source.patch.sha256||spec.version!==source.version)throw Error('Helper source baseline differs');
const paths=[...await files('src/main'),...await files('src/shared'),...await files('scripts/browser'),'out/capability-bundles/index.json','out/agent-browser/SOURCE.json','resources/agent-browser/SOURCE.json','resources/agent-browser/patches/willyou-s1.patch','out/native/willyou-app','out/native/willyou-process-identity'];
for(const file of source.files){const path=join('out/agent-browser',file.path);if(digest(await readFile(path))!==file.sha256)throw Error('Helper bytes mismatch');paths.push(path);}
const baseline=[];for(const path of [...new Set(paths)].sort())baseline.push({path,sha256:digest(await readFile(path))});
await writeFile(join(output,'baseline.json'),JSON.stringify({at:new Date().toISOString(),helper:source,files:baseline},null,2)+'\n');
const check=async()=>{for(const file of baseline)if(digest(await readFile(file.path))!==file.sha256)throw Error('Frozen input changed: '+file.path);};
const tasks=[
 ['reference','s1-reference-probe.mjs','adjudicate-s1-reference.mjs'],
 ['nested','s1-nested-probe.mjs','adjudicate-s1-nested.mjs'],
 ['nested-reference','s1-nested-reference-probe.mjs','adjudicate-s1-nested-reference.mjs'],
 ['native-ref','s1-native-ref-contract-probe.mjs','adjudicate-s1-native-ref-contract.mjs'],
 ['lifecycle','s1-lifecycle-probe.mjs','adjudicate-s1-lifecycle.mjs'],
 ['recovery','s1-recovery-probe.mjs','adjudicate-s1-recovery.mjs'],
 ['queue','s1-queue-probe.mjs','adjudicate-s1-queue.mjs'],
];
const resumeAfter=process.argv[3];
if(resumeAfter&&!tasks.some(task=>task[0]===resumeAfter))throw Error('Unknown resume group');
const selected=resumeAfter?tasks.slice(tasks.findIndex(task=>task[0]===resumeAfter)+1):tasks;
const result={at:new Date().toISOString(),selectedGroups:selected.map(task=>task[0]),resumeAfter,boundary:'I only, fixed patched helper, private fresh profile for every group; no packaged App or real Agent',baseline:join(output,'baseline.json'),groups:[]};
let child;
const run=(script,args,log)=>new Promise((ok,no)=>{
  child=spawn(process.execPath,[script,...args],{stdio:['ignore','pipe','pipe']});let text='';
  child.stdout.on('data',bytes=>text+=bytes);child.stderr.on('data',bytes=>text+=bytes);
  child.once('error',no);child.once('close',async(code,signal)=>{await writeFile(log,text);child=undefined;ok({code,signal});});
});
const update=async(group,status)=>{
  const round=JSON.parse(await readFile(roundFile,'utf8'));
  round.updatedAt=new Date().toISOString();round.currentHelperRegression={output,group,status,runnerPid:process.pid};
  round.resources={build:status==='complete'?'free':'allocated /root '+group+' frozen helper regression',nativeUi:status==='complete'?'free (regression groups own cleanup terminal)':'allocated /root '+group+' isolated native group'};
  await writeFile(roundFile+'.tmp',JSON.stringify(round,null,2)+'\n');await rename(roundFile+'.tmp',roundFile);
};
try{
 const round=JSON.parse(await readFile(roundFile,'utf8'));if(!Object.values(round.resources).every(value=>value.startsWith('free')))throw Error('Native/build lease not free');
 for(const [name,driver,adjudicator] of selected){
  await check();await update(name,'running');
  const directory=output+'-'+name,started=Date.now();
  console.log(JSON.stringify({started:name,directory,at:new Date().toISOString()}));
  const execution=await run('scripts/browser/'+driver,[directory],join(output,name+'-runner.log'));
  if(execution.code!==0)throw Error('Driver terminal failure: '+name);
  const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
  if(raw.failure||raw.hostExit?.code!==0||raw.cleanup?.helpers?.some(helper=>!['stopped','absent'].includes(helper.daemonState)||!helper.socketFilesRemoved||!helper.clientStopped))throw Error('Driver/raw cleanup failure: '+name);
  const decision=await run('scripts/browser/'+adjudicator,[directory],join(output,name+'-adjudicator.log'));
  if(decision.code!==0)throw Error('Adjudicator did not finish: '+name);
  const verdict=JSON.parse(await readFile(join(directory,'adjudication.json'),'utf8'));
  result.groups.push({name,directory,driver,adjudicator,ms:Date.now()-started,passed:verdict.passed,cleanup:raw.cleanup});
  await writeFile(join(output,'live.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result.groups.at(-1)));
  if(!verdict.passed)throw Error('Actual criteria failed: '+name);
 }
 await check();result.passed=true;await update('all','complete');
}catch(error){result.failure=String(error.stack??error);result.passed=false;console.log(JSON.stringify({failure:result.failure}));}
finally{result.finishedAt=new Date().toISOString();await writeFile(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');}

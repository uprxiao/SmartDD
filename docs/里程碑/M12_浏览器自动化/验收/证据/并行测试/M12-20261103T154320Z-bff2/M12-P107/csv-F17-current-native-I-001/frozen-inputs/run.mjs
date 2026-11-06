import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT,NODE,BROKER,json,save,lease,verify,fingerprints} from './io.mjs';
assert.deepEqual(process.argv.slice(2),['--execute']);lease();assert(!fs.existsSync(path.join(ROOT,'execution.json')),'once-only execution already exists');
for(const leaf of ['cache/vitest','cache/node','tmp','home','output'])fs.mkdirSync(path.join(ROOT,leaf),{recursive:true});
assert(!fs.existsSync(path.join(ROOT,'output/vitest.json')),'old report must not exist');
const record={at:new Date().toISOString(),driverPID:process.pid,case:'M12-T130/F17',level:'I-only; original production-source components + exact App026 native files under Node; no packaged main/UI/OS Office claim',preflight:verify(),before:fingerprints(),status:'starting'};save('execution.json',record);
const env={PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',HOME:path.join(ROOT,'home'),TMPDIR:path.join(ROOT,'tmp'),NODE_COMPILE_CACHE:path.join(ROOT,'cache/node'),WILLYOU_TEST_CACHE_DIR:path.join(ROOT,'cache/vitest'),NODE_OPTIONS:`--require=${ROOT}/observe.cjs`,M12_CSV_I_ROOT:ROOT,SMARTDD_CSV_ACCEPTANCE_PROJECT:path.join(ROOT,'fixture/project'),SMARTDD_FILES_NATIVE_PATH:BROKER,SMARTDD_CSV_ACCEPTANCE_EVIDENCE:path.join(ROOT,'output/native-evidence.json')};
const args=[path.join(ROOT,'inputs/node_modules/vitest/vitest.mjs'),'run','--config',path.join(ROOT,'vitest.private.config.mjs'),'--configLoader','runner','--maxWorkers','1','--no-file-parallelism'];
const stdout=fs.openSync(path.join(ROOT,'output/stdout.private.log'),'wx'),stderr=fs.openSync(path.join(ROOT,'output/stderr.private.log'),'wx');
let child;
try{child=spawn(NODE,args,{cwd:path.join(ROOT,'inputs'),env,stdio:['ignore',stdout,stderr],detached:true});record.runnerPID=child.pid;record.command={executable:NODE,args,cwd:path.join(ROOT,'inputs'),environmentKeys:Object.keys(env)};record.status='running';save('execution.json',record);console.log(JSON.stringify({driverPID:process.pid,runnerPID:child.pid,stage:'original-csv-native-I-started',noApp:true,noListeners:true}));
 const terminal=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});record.terminal=terminal;record.status=terminal.code===0&&!terminal.signal?'test-process-exited-zero':'failed';process.exitCode=terminal.code===0&&!terminal.signal?0:1;
}catch(e){record.status='driver-failed';record.error={name:e.name,message:e.message};fs.writeFileSync(path.join(ROOT,'output/failure.private.log'),e.stack||String(e));process.exitCode=1;
}finally{fs.closeSync(stdout);fs.closeSync(stderr);try{record.after=fingerprints();record.postflight=verify();}catch(e){record.postflightError={name:e.name,message:e.message};record.status='postflight-failed';fs.writeFileSync(path.join(ROOT,'output/postflight-failure.private.log'),e.stack||String(e));process.exitCode=1;}record.finishedAt=new Date().toISOString();save('execution.json',record);console.log(JSON.stringify({status:record.status,terminal:record.terminal??null,runnerPID:record.runnerPID??null}));}

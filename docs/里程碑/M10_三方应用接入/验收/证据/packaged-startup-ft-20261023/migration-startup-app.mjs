// Packaged startup integration; no business setup or system input is simulated.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {openElectron} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable);
const root=await mkdtemp('/private/tmp/willyou-m10-migration-startup-'),userData=join(root,'userdata'),home=join(root,'home');await mkdir(home);
const result={root,startedAt:new Date().toISOString(),layer:'packaged startup integration; no UI input or complete T60 claim',checks:[]};let app;
const sql=query=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),query],{encoding:'utf8'})||'[]');
async function journal(){const dir=join(userData,'capabilities/operations'),files=(await readdir(dir)).filter(x=>x.endsWith('.json'));assert.equal(files.length,1);return JSON.parse(await readFile(join(dir,files[0]),'utf8'));}
async function open(){return openElectron({executable,userData,env:{HOME:home},inspectMain:true});}
async function quit(){await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");const exit=await app.waitForExit();assert.equal(exit.code,0);await app.close();app=undefined;}
try{
 result.asar= createHash('sha256').update(await readFile(join(dirname(dirname(executable)),'Resources/app.asar'))).digest('hex');
 app=await open();const first=await journal();assert.equal(first.state,'complete');assert(first.backup);
 const receipt=sql("SELECT operation_id,state FROM capability_resource_operations WHERE kind='database-migration'");assert.deepEqual(receipt,[{operation_id:first.operationId,state:'committed'}]);
 const watermarks=sql('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id');assert.deepEqual(watermarks,first.target.map(x=>({hash:x.hash,created_at:x.when})));
 await app.screenshot(join(root,'first-start.png'));result.checks.push('First packaged start completed journal, backup and matching transactional schema receipt');
 await writeFile(join(root,'first.log'),app.logs());await quit();result.checks.push('Actual app.quit exited code zero without confirmation injection');
 app=await open();assert.deepEqual(await journal(),first);assert.deepEqual(sql("SELECT operation_id,state FROM capability_resource_operations WHERE kind='database-migration'"),receipt);assert.deepEqual(sql('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id'),watermarks);assert.deepEqual(app.rendererErrors,[]);
 result.checks.push('Reopen retained the same operation and schema without an extra migration or backup');await writeFile(join(root,'reopen.log'),app.logs());await quit();result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){await writeFile(join(root,'failure.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}

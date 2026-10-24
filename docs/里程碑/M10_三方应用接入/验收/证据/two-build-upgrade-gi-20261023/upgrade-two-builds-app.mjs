// Two immutable historical/current packages, private userData; startup integration only.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {openElectron} from '../lib/electron-harness.mjs';
const old=process.env.WILLYOU_OLD_APP,current=process.env.WILLYOU_ACCEPTANCE_APP;assert(old&&current);
const root=await mkdtemp('/private/tmp/willyou-m10-two-builds-'),userData=join(root,'userdata'),home=join(root,'home');await mkdir(home);
const result={root,startedAt:new Date().toISOString(),layer:'two packaged builds startup integration; no business UI acceptance',checks:[],packages:[]};let app;
const hash=b=>createHash('sha256').update(b).digest('hex');
const sql=q=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),q],{encoding:'utf8'})||'[]');
const defaults=()=>sql('SELECT app_id,package_hash,activation_generation FROM capability_active_packages ORDER BY app_id');
async function tree(path){const rows=[];async function walk(dir,rel=''){for(const name of (await readdir(dir)).sort()){const p=join(dir,name),r=join(rel,name),s=await lstat(p);assert(!s.isSymbolicLink());if(s.isDirectory())await walk(p,r);else rows.push([r,hash(await readFile(p))]);}}await walk(path);return rows;}
async function start(executable){app=await openElectron({executable,userData,env:{HOME:home},inspectMain:true});}
async function quit(label){await writeFile(join(root,label+'.log'),app.logs());await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");assert.equal((await app.waitForExit()).code,0);await app.close();app=undefined;}
try{
 for(const executable of [old,current]){const resources=join(dirname(dirname(executable)),'Resources');result.packages.push({executable,asar:hash(await readFile(join(resources,'app.asar'))),index:JSON.parse(await readFile(join(resources,'capability-bundles/index.json'),'utf8'))});}
 const target=result.packages[1].index.apps;assert(target.every(a=>result.packages[0].index.apps.find(b=>b.appId===a.appId)?.hash!==a.hash),'Both applications must actually differ');
 await start(old);const before=defaults();assert.equal(before.length,2);const oldFiles=await tree(join(userData,'capabilities/apps'));await quit('old');result.checks.push('Historical package installed distinct old mail and zentao defaults');
 await start(current);const after=defaults();for(const row of after){assert.equal(row.package_hash,target.find(a=>a.appId===row.app_id).hash);assert.equal(row.activation_generation,before.find(a=>a.app_id===row.app_id).activation_generation+1);}
 const upgradedFiles=new Map((await tree(join(userData,'capabilities/apps'))).map(([p,h])=>[p,h]));for(const [p,h] of oldFiles)assert.equal(upgradedFiles.get(p),h);
 const ops=sql("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE kind='application-activation'");assert.equal(ops.length,1);assert.equal(ops[0].state,'committed');const plan=JSON.parse(ops[0].plan_json);assert.equal(plan.result.length,2);assert.equal(plan.preflight.issues.length,0);assert.deepEqual(plan.backup.applications.defaults.map(x=>({app_id:x.app_id,package_hash:x.package_hash,activation_generation:x.activation_generation})),before);
 result.checks.push('Both defaults advanced exactly once in one committed activation with old-default backup');result.checks.push('Every historical app package file retained its original hash');await app.screenshot(join(root,'upgraded.png'));await quit('upgraded');
 await start(current);assert.deepEqual(defaults(),after);assert.deepEqual(sql("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE kind='application-activation'"),ops);await quit('reopened');result.checks.push('New package restart retained exact defaults and operation without replay');result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){await writeFile(join(root,'failure.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}

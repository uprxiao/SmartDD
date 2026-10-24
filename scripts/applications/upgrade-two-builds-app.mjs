// Two immutable historical/current packages, private userData; startup integration only.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {openElectron} from '../lib/electron-harness.mjs';
const old=process.env.WILLYOU_OLD_APP,current=process.env.WILLYOU_ACCEPTANCE_APP;assert(old&&current);
const identityCheck=process.env.WILLYOU_UPGRADE_IDENTITY_CHECK==='1';
const liveOldCheck=process.env.WILLYOU_UPGRADE_LIVE_OLD_CHECK==='1';
const businessCheck=process.env.WILLYOU_UPGRADE_BUSINESS_CHECK==='1';assert(!liveOldCheck||businessCheck);let projectId,projectBefore,projectAfter;
const projectInput={name:'M10 upgrade retained project',aliases:['旧别名'],description:'Historical business value',rulesPath:null};
const root=await mkdtemp('/private/tmp/willyou-m10-two-builds-'),userData=join(root,'userdata'),home=join(root,'home');await mkdir(home);
const result={root,startedAt:new Date().toISOString(),layer:'two packaged builds startup integration; no business UI acceptance',checks:[],packages:[]};let app;
const hash=b=>createHash('sha256').update(b).digest('hex');
const sql=q=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(userData,'smartdd.db'),q],{encoding:'utf8'})||'[]');
const defaults=()=>sql('SELECT app_id,package_hash,activation_generation FROM capability_active_packages ORDER BY app_id');
async function tree(path){const rows=[];async function walk(dir,rel=''){for(const name of (await readdir(dir)).sort()){const p=join(dir,name),r=join(rel,name),s=await lstat(p);assert(!s.isSymbolicLink());if(s.isDirectory())await walk(p,r);else rows.push([r,hash(await readFile(p))]);}}await walk(path);return rows;}
const businessRows=()=>{assert.match(projectId,/^[a-f0-9-]{36}$/);return {project:sql(`SELECT * FROM projects WHERE id='${projectId}'`),dirs:sql(`SELECT * FROM project_dirs WHERE project_id='${projectId}' ORDER BY id`)};};
async function start(executable){app=await openElectron({executable,userData,env:{HOME:home},inspectMain:true});}
async function quit(label){await writeFile(join(root,label+'.log'),app.logs());await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");assert.equal((await app.waitForExit()).code,0);await app.close();app=undefined;}
try{
 for(const executable of [old,current]){const resources=join(dirname(dirname(executable)),'Resources');result.packages.push({executable,asar:hash(await readFile(join(resources,'app.asar'))),index:JSON.parse(await readFile(join(resources,'capability-bundles/index.json'),'utf8'))});}
 const target=result.packages[1].index.apps;assert(target.every(a=>result.packages[0].index.apps.find(b=>b.appId===a.appId)?.hash!==a.hash),'Both applications must actually differ');
 await start(old);if(businessCheck){const path=join(root,'business-project');await mkdir(path);const project=await app.invoke('projects.create',projectInput,[{label:'private-upgrade',path}]);projectId=project.id;projectBefore=businessRows();assert.equal(projectBefore.project.length,1);assert.equal(projectBefore.dirs.length,1);result.projectId=projectId;}const before=defaults();assert.equal(before.length,2);const oldFiles=await tree(join(userData,'capabilities/apps'));
 if(liveOldCheck){
  const migrations=sql('SELECT * FROM __drizzle_migrations ORDER BY id'),operations=sql('SELECT * FROM capability_resource_operations ORDER BY operation_id');
  const env={...process.env,HOME:home,SMARTDD_USER_DATA:userData,SMARTDD_PROBE:'1'};for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|ANTHROPIC_|OPENAI_|CLAUDECODE|CLAUDE_CODE_)/.test(key))delete env[key];
  let failure;try{execFileSync(current,[],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000});}catch(error){failure=error;}
  assert.equal(failure?.status,1);assert.match(failure.stderr,/其他进程仍打开此数据库|仍有宿主使用数据库/);await writeFile(join(root,'live-old-rejection.log'),failure.stderr);
  assert.deepEqual(defaults(),before);assert.deepEqual(sql('SELECT * FROM __drizzle_migrations ORDER BY id'),migrations);assert.deepEqual(sql('SELECT * FROM capability_resource_operations ORDER BY operation_id'),operations);assert.deepEqual(businessRows(),projectBefore);
  result.checks.push('Current packaged host refused migration while the real historical App held the database; business/defaults/migrations/operations unchanged');
  await app.invoke('projects.update',projectId,{...projectInput,description:'Old host remains writable after rejected upgrade'});projectBefore=businessRows();assert.equal(projectBefore.project[0].description,'Old host remains writable after rejected upgrade');result.checks.push('Historical App remained usable and wrote new business data after the upgrade attempt was rejected');
 }
 await quit('old');result.checks.push('Historical package installed distinct old mail and zentao defaults');
 if(identityCheck){
  // Deliberate invalid stored identity in this test directory; no credentials.
  const config=JSON.stringify({kind:'zentao',baseUrl:'https://identity.example.test/',username:'fixture-user',authMode:'token'});
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  execFileSync('/usr/bin/sqlite3',[join(userData,'smartdd.db')],{input:`INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES('upgrade-identity','zentao','zentao','Private identity fault',${quote(config)},1,1,1,'{}','unknown',1,1,1,'connected','healthy','now','now');`,encoding:'utf8'});
  await start(current);assert.deepEqual(defaults(),before);
  const inventory=await app.invoke('applications.versions','zentao');assert(inventory.ok,JSON.stringify(inventory));
  assert(inventory.value.upgrade.preflight.issues.some(issue=>issue.connectionId==='upgrade-identity'&&issue.code==='CONNECTION_CONTRACT_UNVERIFIED'));
  assert.equal(sql("SELECT * FROM capability_resource_operations WHERE kind='application-activation'").length,0);
  assert.equal(sql("SELECT verified_identity_json FROM application_connections WHERE id='upgrade-identity'")[0].verified_identity_json,'{}');
  await quit('identity-rejected');result.checks.push('Unknown persisted identity deferred both application upgrades before activation writes; actual packaged diagnostic listed the affected connection');
  const identity={providerId:'zentao',serviceId:'https://identity.example.test/',accountId:'fixture-user',contractMajor:1};
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(identity).sort(([a],[b])=>a.localeCompare(b))));
  execFileSync('/usr/bin/sqlite3',[join(userData,'smartdd.db')],{input:`UPDATE application_connections SET verified_identity_json=${quote(JSON.stringify(identity))},identity_hash=${quote(hash(Buffer.from(canonical)))} WHERE id='upgrade-identity';`,encoding:'utf8'});
  result.checks.push('Repaired only synthetic identity fixture; no account authentication or reconnect UI claimed');
 }
 await start(current);if(businessCheck){assert.deepEqual(businessRows(),projectBefore);result.checks.push('Historical project and directory rows survived upgrade byte-for-byte');}const after=defaults();for(const row of after){assert.equal(row.package_hash,target.find(a=>a.appId===row.app_id).hash);assert.equal(row.activation_generation,before.find(a=>a.app_id===row.app_id).activation_generation+1);}
 const upgradedFiles=new Map((await tree(join(userData,'capabilities/apps'))).map(([p,h])=>[p,h]));for(const [p,h] of oldFiles)assert.equal(upgradedFiles.get(p),h);
 const ops=sql("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE kind='application-activation'");assert.equal(ops.length,1);assert.equal(ops[0].state,'committed');const plan=JSON.parse(ops[0].plan_json);assert.equal(plan.result.length,2);assert.equal(plan.preflight.issues.length,0);assert.deepEqual(plan.backup.applications.defaults.map(x=>({app_id:x.app_id,package_hash:x.package_hash,activation_generation:x.activation_generation})),before);
 result.checks.push('Both defaults advanced exactly once in one committed activation with old-default backup');result.checks.push('Every historical app package file retained its original hash');if(businessCheck){await app.invoke('projects.update',projectId,{...projectInput,description:'New business write after upgrade',aliases:['旧别名','new-alias']});projectAfter=businessRows();assert.equal(projectAfter.project[0].description,'New business write after upgrade');assert.deepEqual(projectAfter.dirs,projectBefore.dirs);result.checks.push('Current host accepted a new production project update after upgrade');}await app.screenshot(join(root,'upgraded.png'));await quit('upgraded');
 await start(current);if(businessCheck){assert.deepEqual(businessRows(),projectAfter);result.checks.push('Restart retained post-upgrade business changes without replay or restoring older data');}assert.deepEqual(defaults(),after);assert.deepEqual(sql("SELECT operation_id,state,plan_json FROM capability_resource_operations WHERE kind='application-activation'"),ops);await quit('reopened');result.checks.push('New package restart retained exact defaults and operation without replay');
 if(process.env.WILLYOU_VERIFY_OLD_REOPEN==='1'){
  execFileSync(process.execPath,[new URL('./old-host-rejection.mjs',import.meta.url).pathname],{env:{...process.env,WILLYOU_TEST_ROOT:root,WILLYOU_OLD_APP:old,WILLYOU_ACCEPTANCE_APP:current},stdio:'pipe',timeout:30000});
  const rejection=JSON.parse(await readFile(join(root,'old-rejection-result.json'),'utf8'));assert.equal(rejection.status,'passed');result.oldHostRejection=rejection;
  result.checks.push('Historical host rejected the newer schema without changing database bytes; current host reopened successfully');
 }
 result.status='passed';
}catch(error){if(error.electronStartupLogs)await writeFile(join(root,'startup-failure.log'),error.electronStartupLogs);result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){await writeFile(join(root,'failure.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}

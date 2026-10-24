// Packaged IPC fault injection, synthetic persisted configuration; no UI or authentication claim.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {openElectron} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable);
const root=await mkdtemp('/private/tmp/willyou-m10-config-fault-'),userData=join(root,'userdata'),home=join(root,'home');await mkdir(home);
const result={root,startedAt:new Date().toISOString(),layer:'packaged IPC; synthetic SQLite fault injection; no UI/authentication acceptance',checks:[]};let app;
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const sql=q=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-json',join(userData,'smartdd.db'),q],{encoding:'utf8'})||'[]');
try{
 result.asar=createHash('sha256').update(await readFile(join(dirname(dirname(executable)),'Resources/app.asar'))).digest('hex');
 assert.equal(result.asar,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
 app=await openElectron({executable,userData,env:{HOME:home},inspectMain:true});
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok,JSON.stringify(catalog));
 const config={kind:'zentao',baseUrl:'https://fixture.example.test/',username:'fixture',authMode:'token'};
 const identity={providerId:'zentao',serviceId:'fixture',accountId:'fixture',contractMajor:1};
 sql(`INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES('config-fault','zentao','zentao','Synthetic config fault',${quote(JSON.stringify(config))},1,1,1,${quote(JSON.stringify(identity))},'synthetic',0,1,1,'disconnected','healthy','now','now')`);
 const before=await app.invoke('applications.connections','zentao');assert(before.ok,JSON.stringify(before));assert.equal(before.value.length,1);
 for(const [name,bytes] of [['broken-json','{broken'],['unknown-authentication',JSON.stringify({...config,authMode:'unknown'})],['missing-account',JSON.stringify({...config,username:undefined})],['extra-security-field',JSON.stringify({...config,tlsVerification:false})]]){
  sql(`UPDATE application_connections SET config_json=${quote(bytes)} WHERE id='config-fault'`);
  const damaged=sql("SELECT * FROM application_connections WHERE id='config-fault'");
  const reply=await app.invoke('applications.connections','zentao');assert.equal(reply.ok,false,JSON.stringify(reply));assert.equal(reply.code,'CONFIG_INCOMPATIBLE',JSON.stringify(reply));
  assert.deepEqual(sql("SELECT * FROM application_connections WHERE id='config-fault'"),damaged);
  assert((await app.invoke('applications.catalog')).ok);
  assert.deepEqual(await app.invoke('applications.connections','mail'),{ok:true,value:[]});
  sql(`UPDATE application_connections SET config_json=${quote(JSON.stringify(config))} WHERE id='config-fault'`);
  assert.deepEqual(await app.invoke('applications.connections','zentao'),before);
  result.checks.push({name,reply,preserved:true,recovered:true});
 }
 result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){await writeFile(join(root,'app.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}

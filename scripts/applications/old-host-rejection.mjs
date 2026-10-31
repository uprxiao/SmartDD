// Existing packaged diagnostic mode exposes the same pre-service startup rejection.
import assert from 'node:assert/strict';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {openElectron} from '../lib/electron-harness.mjs';
const root=process.env.WILLYOU_TEST_ROOT,old=process.env.WILLYOU_OLD_APP,current=process.env.WILLYOU_ACCEPTANCE_APP;assert(root?.startsWith('/private/tmp/willyou-m10-two-builds-')&&old&&current);
const file=join(root,'userdata/smartdd.db'),hash=async()=>createHash('sha256').update(await readFile(file)).digest('hex');
const result={root,startedAt:new Date().toISOString(),layer:'actual packaged startup in existing diagnostic mode; not native dialog UI acceptance',checks:[]};let app;
try{
 for(const suffix of ['-wal','-shm'])await assert.rejects(lstat(file+suffix),{code:'ENOENT'});
 result.before=await hash();
 const env={...process.env,HOME:join(root,'home'),SMARTDD_USER_DATA:join(root,'userdata'),SMARTDD_PROBE:'1'};for(const key of Object.keys(env))if(/^(ELECTRON_RUN_AS_NODE|ANTHROPIC_|OPENAI_|CLAUDECODE|CLAUDE_CODE_)/.test(key))delete env[key];
 let failure;try{execFileSync(old,[],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000});}catch(error){failure=error;}
 assert.equal(failure?.status,1);assert.match(failure.stderr,/数据库已执行 29 个迁移，当前版本只包含 27 个/);await writeFile(join(root,'old-rejection.stderr.log'),failure.stderr);result.after=await hash();assert.equal(result.after,result.before);
 result.checks.push('Old packaged host rejected 29-migration database with 27-migration build before business initialization');result.checks.push('Database main file SHA256 identical before and after old-host rejection');
 app=await openElectron({executable:current,userData:join(root,'userdata'),env:{HOME:join(root,'home')},inspectMain:true});const rows=JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',file,"SELECT operation_id,state FROM capability_resource_operations WHERE kind='application-activation'"],{encoding:'utf8'}));assert.equal(rows.length,1);assert.equal(rows[0].state,'committed');result.receipts=rows;
 await writeFile(join(root,'new-after-rejection.log'),app.logs());await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()");assert.equal((await app.waitForExit()).code,0);await app.close();app=undefined;result.checks.push('Current packaged host reopened retained database and original committed activation');result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app)await app.close();result.finishedAt=new Date().toISOString();await writeFile(join(root,'old-rejection-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}

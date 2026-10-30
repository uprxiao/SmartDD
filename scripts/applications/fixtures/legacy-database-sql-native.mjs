import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {checkLegacyDatabaseUi} from './legacy-database-ui-native.mjs';
import {requireDatabaseSqlPermission,reserveDatabaseSqlRead} from './database-sql-permission.mjs';

const shell=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const SQL="SELECT value, current_setting('transaction_read_only') AS transaction_read_only, current_user AS username, current_database() AS database FROM wy_fixture.marker";
const sha=b=>createHash('sha256').update(b).digest('hex');

export async function checkLegacyDatabaseSql(input){
  const permission=requireDatabaseSqlPermission();
  input.result.databaseSqlPermission={...permission,maxSqlAttempts:3,networkSwitchIsNotLoopbackAllowlist:true};
  await checkLegacyDatabaseUi({...input,nativeDatabaseRead:async({e,item,label,command,script,pgInfo,task,project,sql})=>{
    e.layer='A original DB UI/task/restart;I real PostgreSQL14 SCRAM read-only role, original projected DB script+audit through actual native CLI; explicit TR workspace-write/network exception; no SSH/SMTP/reply/import/daily data';
    const before=sql("SELECT COUNT(*) n FROM mail_send_executions")[0].n;assert.equal(before,0);
    const scriptBytes=await readFile(script),source=await readFile(new URL('../../../resources/standard-skills/project-db-diagnostics/scripts/db_query.py',import.meta.url));
    assert(scriptBytes.equals(source),'Run the original projected DB script byte-for-byte');
    const scriptSha256=sha(scriptBytes);
    const budget=reserveDatabaseSqlRead(permission,label,{taskId:item.task.id,runId:item.binding.run});
    const cmd=shell('/private/tmp/willyou-m10-ma-20261026/python-ci/bin/python3')+' -I -B '+shell(script)+' --db '+shell(e.database.id)+' --sql '+shell(SQL)+' --format json --limit 1 --connect-timeout 2 --read-timeout 5';
    let phase=await command(item,label+'-db-sql','exec_command',{cmd,max_output_tokens:1800,yield_time_ms:10000});
    let output=phase.value;
    for(let n=0;n<3&&/Process running with session ID (\d+)/.test(output);n++){
      const session_id=Number(/Process running with session ID (\d+)/.exec(output)[1]);
      phase=await command(item,label+'-db-sql-wait-'+n,'write_stdin',{session_id,chars:'',max_output_tokens:1800,yield_time_ms:10000},true);output=phase.value;
    }
    assert(!/Process running with session ID/.test(output),'Observe the original command to completion; never launch a replacement query');
    for(const[key,value]of Object.entries({value:'TO_T67_READ_ONLY_MARKER',transaction_read_only:'on',username:'wy_reader',database:'wy_t67'})){
      assert(output.includes(JSON.stringify(key)+': '+JSON.stringify(value)),'Missing actual query field '+key);
    }
    assert(!output.includes(pgInfo.secret));
    const auditPath=task.runtimeSnapshot.auditPath;
    const audit=(await readFile(auditPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    e.nativeSqlReads??=[];
    assert.equal(audit.length,(e.nativeSqlReads.length+1)*3);
    for(let n=0;n<audit.length;n++){
      const row=audit[n];assert.equal(row.status,['attempted','connected','completed'][n%3]);
      for(const[key,value]of Object.entries({kind:'database',skill:'project-db-diagnostics',projectId:project.id,resourceId:e.database.id,host:'127.0.0.1',port:pgInfo.port,database:'wy_t67',schema:'wy_fixture',username:'wy_reader'}))assert.equal(row[key],value);
      assert.equal(row.configHash,task.runtimeSnapshot.configHash);
    }
    e.nativeSqlReads.push({label,budget,script,scriptSha256,cmd,output,auditPath,audit});
    input.checked('TR: '+label+' actual original DB SQL returns canary/read-only role and preserves all three original audit stages');
    assert.equal(sql("SELECT COUNT(*) n FROM mail_send_executions")[0].n,0);
  }});
  const e=input.result.legacyDatabaseUi;
  assert.equal(e.nativeSqlReads.length,3);assert(e.nativeDatabaseQueryExecuted);
  assert.equal(e.nativeSqlReads.at(-1).audit.length,9);
  input.result.databaseSqlPermission.executedSqlReads=e.nativeSqlReads.length;
}

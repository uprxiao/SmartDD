import { startPostgres, startSshd } from './fixtures.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
const root=mkdtempSync('/private/tmp/willyou-m14-stage6.WRvdST/g03/prep-next/a42-db-ssh/smoke-');
const pg=await startPostgres(root,54342), sshd=await startSshd(root,22342);
try{
  const rows=execFileSync('/opt/homebrew/bin/psql',['-h','127.0.0.1','-p','54342','-U',pg.username,'-d',pg.database,'-qAt','-c','select count(*) from customer_orders'],{env:{PATH:'/usr/bin:/bin',PGPASSWORD:pg.password},encoding:'utf8'}).trim();
  let denied='';try{execFileSync('/opt/homebrew/bin/psql',['-h','127.0.0.1','-p','54342','-U',pg.username,'-d',pg.database,'-qAt','-c',"insert into customer_orders values (9,'x','x',1)"],{env:{PATH:'/usr/bin:/bin',PGPASSWORD:pg.password},encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(e){denied=String(e.stderr).trim().slice(0,80);}
  const out=execFileSync('/usr/bin/ssh',['-F','/dev/null','-i',sshd.clientKey,'-p','22342','-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile='+root+'/known_hosts','-o','IdentitiesOnly=yes','-o','BatchMode=yes',sshd.user+'@127.0.0.1','echo A42_PROBE; hostname; id'],{encoding:'utf8',timeout:20000}).trim();
  console.log(JSON.stringify({rows,denied,ssh:out,logged:execFileSync('/bin/cat',[sshd.commandsLog],{encoding:'utf8'}).trim()}));
}finally{await pg.stop();await sshd.stop();}

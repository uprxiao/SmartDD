// A42 private DB / SSH fixtures. Everything lives under the attempt root; nothing touches the user's own services or keys.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import * as fsMod from 'node:fs';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
globalThis.__fs=fsMod;
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

const waitPort=(port,timeout=20000)=>new Promise((resolve,reject)=>{const end=Date.now()+timeout;const tryOnce=()=>{const s=createConnection({host:'127.0.0.1',port},()=>{s.destroy();resolve();});s.on('error',()=>{s.destroy();Date.now()>end?reject(Error('port '+port+' not ready')):setTimeout(tryOnce,200);});};tryOnce();});

export async function startPostgres(root,port){
  assert(root.startsWith('/private/tmp/willyou-m14-stage6.WRvdST/g03/'));
  const dir=join(root,'pg'),data=join(dir,'data'),sock=join(dir,'sock');mkdirSync(sock,{recursive:true,mode:0o700});
  const superPass=randomBytes(12).toString('hex'),readerPass=randomBytes(12).toString('hex');
  writeFileSync(join(dir,'superpass'),superPass,{mode:0o600});
  execFileSync('/opt/homebrew/bin/initdb',['-D',data,'-U','a42admin','--auth=scram-sha-256','--pwfile='+join(dir,'superpass'),'-E','UTF8','--locale=C'],{stdio:'ignore',timeout:60000});
  writeFileSync(join(data,'postgresql.auto.conf'),`listen_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories='${sock}'\n`);
  const proc=spawn('/opt/homebrew/bin/postgres',['-D',data],{stdio:['ignore','ignore',openLog(join(dir,'postgres.log'))]});
  await waitPort(port);
  const psql=(sql,db='postgres')=>execFileSync('/opt/homebrew/bin/psql',['-h','127.0.0.1','-p',String(port),'-U','a42admin','-d',db,'-v','ON_ERROR_STOP=1','-qAt','-c',sql],{env:{PATH:'/usr/bin:/bin',PGPASSWORD:superPass},encoding:'utf8',timeout:20000}).trim();
  for(let i=0;i<50;i++){try{psql('select 1');break;}catch{await new Promise(r=>setTimeout(r,200));}}
  psql('create database a42_orders');
  psql("create table customer_orders(id int primary key, customer text not null, status text not null, amount numeric(10,2) not null); insert into customer_orders values (1,'合成客户甲','paid',120.50),(2,'合成客户乙','pending',88.00),(3,'合成客户丙','paid',42.00);",'a42_orders');
  psql(`create role a42_reader login password '${readerPass}'; grant connect on database a42_orders to a42_reader;`);
  psql('grant usage on schema public to a42_reader; grant select on all tables in schema public to a42_reader;','a42_orders');
  return {proc,port,database:'a42_orders',username:'a42_reader',password:readerPass,stop:()=>new Promise(r=>{proc.once('exit',r);proc.kill('SIGINT');})};
}
function openLog(path){return require_fs().openSync(path,'a');}
function require_fs(){return {openSync:(p,f)=>{const fs=globalThis.__fs;return fs.openSync(p,f);}};}

export async function startSshd(root,port){
  assert(root.startsWith('/private/tmp/willyou-m14-stage6.WRvdST/g03/'));
  const dir=join(root,'sshd');mkdirSync(dir,{recursive:true,mode:0o700});
  const hostKey=join(dir,'host_ed25519'),clientKey=join(dir,'client_ed25519'),auth=join(dir,'authorized_keys'),forced=join(dir,'forced.sh'),log=join(dir,'commands.log');
  execFileSync('/usr/bin/ssh-keygen',['-q','-t','ed25519','-N','','-f',hostKey]);
  execFileSync('/usr/bin/ssh-keygen',['-q','-t','ed25519','-N','','-C','a42-test-only','-f',clientKey]);
  writeFileSync(auth,readFileSync(clientKey+'.pub'),{mode:0o600});
  // Whatever the client asks, only this synthetic script runs; the original request is logged for the check.
  writeFileSync(forced,`#!/bin/sh\nprintf '%s\\n' "$SSH_ORIGINAL_COMMAND" >> '${log}'\necho 'A42_SYNTH_HOST a42-synthetic-server'\necho 'uid=4242(a42) gid=4242(a42) groups=4242(a42)'\nexit 0\n`,{mode:0o700});
  const user=execFileSync('/usr/bin/id',['-un'],{encoding:'utf8'}).trim();
  writeFileSync(join(dir,'sshd_config'),[`Port ${port}`,'ListenAddress 127.0.0.1',`HostKey ${hostKey}`,`PidFile ${join(dir,'sshd.pid')}`,`AuthorizedKeysFile ${auth}`,'PasswordAuthentication no','KbdInteractiveAuthentication no','PubkeyAuthentication yes','UsePAM no','PermitRootLogin no',`AllowUsers ${user}`,`ForceCommand ${forced}`,'PermitTTY yes','AllowTcpForwarding no','X11Forwarding no','AllowAgentForwarding no','PermitUserEnvironment no','StrictModes no','LogLevel VERBOSE'].join('\n')+'\n',{mode:0o600});
  execFileSync('/usr/sbin/sshd',['-t','-f',join(dir,'sshd_config')]);
  const proc=spawn('/usr/sbin/sshd',['-D','-e','-f',join(dir,'sshd_config')],{stdio:['ignore','ignore',globalThis.__fs.openSync(join(dir,'sshd.log'),'a')]});
  await waitPort(port);
  return {proc,port,user,clientKey,commandsLog:log,stop:()=>new Promise(r=>{proc.once('exit',r);proc.kill('SIGTERM');})};
}

// T08 packaged service evidence. IPC actions are not UI acceptance.
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {mkdtemp,mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {openElectron} from '../lib/electron-harness.mjs';

const manualKeychain=process.env.WILLYOU_SECRET_SYSTEM_HOME==='1',systemHome=manualKeychain?homedir():null;
const executable=process.env.WILLYOU_ACCEPTANCE_APP,expectedAsar=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;assert(executable&&expectedAsar);
const traceStorage=process.env.WILLYOU_SECRET_TRACE==='1';let tracedPid;
const root=await mkdtemp('/private/tmp/willyou-m10-connection-secrets-'),userData=join(root,'userdata'),home=join(root,'home');await mkdir(home);
const secret='T08_SYNTHETIC_'+randomUUID(),replacement='T08_REJECTED_'+randomUUID();
if(manualKeychain){for(const k of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL'].includes(k))delete process.env[k];}
const privateEnv={HOME:systemHome??home,ZDOTDIR:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')};
const sha=b=>createHash('sha256').update(b).digest('hex');
const result={schema:'m10-connection-secrets-service-v1',root,startedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),asarSha256:sha(await readFile(resolve(dirname(executable),'../Resources/app.asar'))),layer:'packaged production service IPC;real safeStorage;loopback synthetic SMTP;system HOME only for native keychain,private userData/ZDOTDIR/Agent configs,no Agent/profile import/external-send/UI business claim',checks:[],smtp:{authenticated:0,rejected:0,data:0},scans:[]};
assert.equal(result.asarSha256,expectedAsar);
const needles=[secret,replacement,Buffer.from(secret).toString('base64'),Buffer.from(replacement).toString('base64')];
const clean=value=>{const text=typeof value==='string'?value:JSON.stringify(value);for(const needle of needles)assert(!text.includes(needle),'Synthetic credential exposed');return value;};
const unwrap=value=>{clean(value);assert(value.ok,JSON.stringify(value));return value.value;};
const checked=name=>result.checks.push({name,passed:true});
const sockets=new Set();let reject=false,app,stage='setup';
const smtp=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setEncoding('utf8');socket.write('220 isolated ESMTP\r\n');let buffer='';socket.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);const command=line.split(' ')[0].toUpperCase();if(command==='EHLO')socket.write('250-isolated\r\n250 AUTH PLAIN\r\n');else if(command==='AUTH'){const fields=Buffer.from(line.split(' ')[2]??'','base64').toString().split('\0');if(reject){result.smtp.rejected++;socket.write('535 '+replacement+' authentication rejected\r\n');}else{assert.equal(fields.at(-1),secret);result.smtp.authenticated++;socket.write('235 authenticated\r\n');}}else if(command==='QUIT')socket.end('221 bye\r\n');else if(command==='DATA'){result.smtp.data++;socket.write('554 sending forbidden\r\n');}else socket.write('250 OK\r\n');}});});
await new Promise(r=>smtp.listen(0,'127.0.0.1',r));
async function initialFocus(){if(!manualKeychain)return;const value=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own secret test window only');const windows=E.BrowserWindow.getAllWindows();if(windows.length!==1)throw Error('Single own window required');const w=windows[0];w.show();E.app.focus({steal:false});w.focus();w.webContents.focus();return{pid:process.pid}})()`);result.initialFocus??=[];result.initialFocus.push(value);await app.waitFor('document.hasFocus()&&document.visibilityState==="visible"',3000);await app.evaluate("document.title='A · M10 OY · 隔离 真实安全存储验证';true");}
async function scan(){let files=0,bytes=0;async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){await visit(file);continue;}if(!entry.isFile())continue;const info=await lstat(file);assert(info.size<=64*1024*1024,'Unbounded fixture file');const data=await readFile(file);for(const needle of needles)assert(!data.includes(Buffer.from(needle)),'Synthetic credential persisted in '+file);files++;bytes+=data.length;}}await visit(userData);await visit(home);return{files,bytes,scope:'all regular files in this closed App userData and private HOME; no symlink traversal'};}
async function trace(){
 if(!traceStorage)return;
 tracedPid=await app.mainEvaluate('process.pid');
 const path=join(root,'safe-storage-calls.log');
 await app.mainEvaluate(`(()=>{const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),storage=req('electron').safeStorage,fs=process.getBuiltinModule('fs'),path=${JSON.stringify(path)};for(const name of ['isEncryptionAvailable','encryptString','decryptString']){const original=storage[name];storage[name]=function(...args){fs.appendFileSync(path,name+':enter\\n');try{return original.apply(storage,args);}finally{fs.appendFileSync(path,name+':return\\n');}};}return true;})()`);
 result.instrumentation='Private process wrappers record method entry/return only; original safeStorage executes with unchanged arguments. No secrets logged; wrappers discarded with test process.';
}
async function close(){if(!app)return;const logs=app.logs();clean(logs);await app.close();clean(app.logs());await writeFile(join(root,'electron-'+result.scans.length+'.log'),app.logs());app=undefined;}
try{
 app=await openElectron({executable,userData,env:privateEnv,inspectMain:traceStorage||manualKeychain});await trace();await initialFocus();
 await app.evaluate("document.title='A · M10 · isolated credential service';true");
 const catalog=unwrap(await app.invoke('applications.catalog')),mail=catalog.find(a=>a.appId==='mail');unwrap(await app.invoke('applications.setAdded','mail',true,mail.revision));
 const config={kind:'smtp',host:'127.0.0.1',port:smtp.address().port,username:'t08@example.test',fromAddress:'t08@example.test',authMode:'password',mode:'plain'};
 stage='save';const candidate=unwrap(await app.invoke('applications.testConnection',{name:'T08 isolated SMTP',expectedRevision:0,config,secret}));
 const saved=unwrap(await app.invoke('applications.saveConnection','mail',candidate.operationId,candidate.candidateHash));assert(saved.hasSecret);result.connectionId=saved.id;checked('Production SMTP verification consumes synthetic credential; IPC candidate and saved response contain no secret');
 stage='failed-rotation';reject=true;const failure=clean(await app.invoke('applications.testConnection',{id:saved.id,expectedRevision:saved.revision,name:saved.name,config,secret:replacement}));assert.equal(failure.ok,false);result.rotationFailure=failure;
 const unchanged=unwrap(await app.invoke('applications.connections','mail')).find(c=>c.id===saved.id);assert.equal(unchanged.revision,saved.revision);assert.equal(unchanged.secretRevision,saved.secretRevision);checked('Provider echoes rejected synthetic secret; renderer error is sanitized and old credential revision retained');
 stage='restart';await close();result.scans.push(await scan());reject=false;
 app=await openElectron({executable,userData,env:privateEnv,inspectMain:traceStorage||manualKeychain});await trace();await initialFocus();
 const reopened=unwrap(await app.invoke('applications.connections','mail')).find(c=>c.id===saved.id);assert.equal(reopened.id,saved.id);assert.equal(reopened.secretRevision,saved.secretRevision);
 const verified=unwrap(await app.invoke('applications.testConnection',{id:saved.id,expectedRevision:reopened.revision,name:reopened.name,config}));assert(verified.operationId);assert.equal(result.smtp.authenticated,2);assert.equal(result.smtp.rejected,1);assert.equal(result.smtp.data,0);checked('After real host restart, omitted password uses original secure-store credential; SMTP authenticates without sending');
 stage='closed-file-scan';await close();result.scans.push(await scan());checked('Closed App logs, userdata and private HOME contain neither synthetic secret nor its base64 encoding');result.status='passed-partial';
}catch(error){result.status='failed';result.stage=stage;result.error=String(error);if(traceStorage&&tracedPid)try{execFileSync('/usr/bin/sample',[String(tracedPid),'1','1','-file',join(root,'blocked-stack.txt')],{timeout:10000,stdio:'pipe'});result.sample='blocked-stack.txt';}catch{result.sample='unavailable';}process.exitCode=2;}
finally{try{await close();result.cleanup=true;}catch(error){result.cleanup=false;result.cleanupError=String(error);process.exitCode=2;}for(const socket of sockets)socket.destroy();await new Promise(r=>smtp.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,stage:result.stage,checks:result.checks.length,error:result.error}));}

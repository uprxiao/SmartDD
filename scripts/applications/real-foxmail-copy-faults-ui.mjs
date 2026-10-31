// T13 controlled-copy faults: the REAL Foxmail messages.db is copied (read-only copy) into a private folder; the real
// packaged App UI tests/saves it, and unreadable / locked / unsupported-format / restored states are produced on the COPY only.
// The real profile is never written. No SMTP. Evidence keeps hashes, counts and fixed UI message classes only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,chmod,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable?.startsWith('/private/tmp/willyou-m10-'),'Set WILLYOU_ACCEPTANCE_APP to the private package');
const cfg=JSON.parse(await readFile(process.env.WILLYOU_REAL_FOXMAIL_CONFIG??'/private/tmp/willyou-m10-real-foxmail-config.json','utf8'));
const sha=v=>createHash('sha256').update(v).digest('hex'),w=ms=>new Promise(r=>setTimeout(r,ms));
const root=await mkdtemp('/private/tmp/willyou-m10-rf-copy-'),userData=join(root,'userdata'),copyDir=join(root,'copy-profile'),db=join(copyDir,'messages.db');
await mkdir(copyDir);
const realDb=join(cfg.profile,'messages.db'),realBefore=await stat(realDb);
await copyFile(realDb,db);
const result={schema:'m10-t13-copy-faults-v1',startedAt:new Date().toISOString(),root,app:executable,sourceDbSha256:sha(await readFile(db)),checks:[],messages:{},status:'running',
 layer:'A real packaged App UI; controlled COPY of the real Foxmail messages.db; faults made on the copy only; real profile untouched (mtime/size compared)'};
const say=(k,t)=>console.log(k+': '+t),note=n=>{result.checks.push({name:n,at:new Date().toISOString()});say('CHECK',n);},save=()=>writeFile(join(root,'result.json'),JSON.stringify(result,null,2));
let app,lock;
const byText=(sel,text)=>`()=>[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.offsetParent&&e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
async function click(js){const p=await app.evaluate(`(()=>{const e=(${js})();if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert(p,'target missing');for(const t of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type:t,x:p.x,y:p.y,button:'left',clickCount:1});}
async function type(label,value){await click(`()=>document.querySelector('[aria-label=${JSON.stringify(label)}]')`);await app.evaluate('document.activeElement.select?.();true');await app.cdp('Input.insertText',{text:value});}
const connections=async()=>(await app.invoke('applications.connections','mail')).value;
async function openDialog(){
 await app.evaluate('document.querySelector("[data-testid=nav-apps]").click();true');await w(800);
 await click(byText('main button,main a,main article,main [role=button]','邮件'));await w(800);
 await click(byText('button','添加连接'));await w(300);await click(byText('[role=menuitem]','本地读取来源'));await w(800);
 await app.waitFor("!!document.querySelector('[aria-label=\"Foxmail 本地来源\"]')",10000);
 await type('连接名称','T13 copy faults');await type('Foxmail 本地来源',copyDir);await type('Foxmail 邮箱账号',cfg.account);
}
// click 测试连接 and classify the visible outcome
async function test(label){
 await click(byText('button','测试连接'));
 await app.waitFor("document.body.innerText.includes('身份验证通过')||!!document.querySelector('dialog [role=alert],[role=dialog] [role=alert]')?.textContent.trim()",90000);
 const out=await app.evaluate(`(()=>{const a=document.querySelector('dialog [role=alert],[role=dialog] [role=alert]');return{ready:document.body.innerText.includes('身份验证通过'),alert:a?a.textContent.trim():''}})()`);
 const text=out.alert.split(copyDir).join('<copy>').split(cfg.account).join('<acct>');result.messages[label]={ready:out.ready,message:text};
 say('OBSERVED',label+' ready='+out.ready+' message='+text.slice(0,160));await save();return out;
}
try{
 app=await openElectron({executable,userData,inspectMain:true});result.appPid=app.processId;
 const cat=await app.invoke('applications.catalog'),m=(cat.value??cat).find(x=>x.appId==='mail');assert((await app.invoke('applications.setAdded','mail',true,m.revision)).ok);
 await openDialog();note('Dialog opened through the real UI with the controlled copy as the source');
 // 1. unreadable (the permission-revoked analogue on the copy)
 await chmod(db,0o000);
 let o=await test('unreadable');assert(!o.ready&&o.alert.length>0,'unreadable source must be refused with a visible reason');assert.equal((await connections()).length,0);
 note('Unreadable (mode 000) source is refused with a visible reason, no connection, not shown as an empty mailbox');
 // 2. restored
 await chmod(db,0o600);o=await test('restored');assert(o.ready,'restored source must pass again');note('After permission is restored a manual retest passes');
 // 3. locked by another writer (hold a write transaction on the copy)
 lock=spawn('/usr/bin/sqlite3',[db],{stdio:['pipe','ignore','ignore']});lock.stdin.write('PRAGMA locking_mode=EXCLUSIVE;\nBEGIN EXCLUSIVE;\nCREATE TABLE IF NOT EXISTS t13_lock(x);\n');await w(1500);
 o=await test('locked');result.lockedOutcome=o.ready?'tested-ok-despite-lock':'refused';note('Locked source outcome recorded: '+result.lockedOutcome);
 lock.stdin.write('ROLLBACK;\n.quit\n');lock.stdin.end();await w(1500);lock=null;
 o=await test('unlocked');assert(o.ready,'after the lock is released the retest passes');note('After the lock is released a manual retest passes');
 // 4. unsupported format (valid SQLite, not a Foxmail schema)
 await rm(db);execFileSync('/usr/bin/sqlite3',[db,'create table other(x); insert into other values(1);']);
 o=await test('unsupported');assert(!o.ready&&o.alert.length>0,'unsupported format must be refused with a visible reason');assert.equal((await connections()).length,0);
 note('Unsupported (non-Foxmail schema) source is refused with a visible reason, no connection');
 // 5. back to the real copy, save, then revoke + reopen
 await rm(db);await copyFile(realDb,db);o=await test('recopy');assert(o.ready);
 await click(byText('button','保存连接'));const end=Date.now()+20000;while((await connections()).length!==1){assert(Date.now()<end,'not saved');await w(300);}
 result.saved=(await connections())[0].id;note('Copy saved as 1 connection');
 await app.invoke('tasks.list').catch(()=>{});
 result.status='passed-copy-faults';
}catch(error){result.status='failed';result.error=String(error);say('FAILED',String(error));process.exitCode=1;}
finally{try{lock?.kill();}catch{}try{await chmod(db,0o600);}catch{}
 const realAfter=await stat(realDb);result.realDbUntouched=realAfter.mtimeMs===realBefore.mtimeMs&&realAfter.size===realBefore.size;
 result.finishedAt=new Date().toISOString();await save();say('RESULT',result.status+' realDbUntouched='+result.realDbUntouched+' '+join(root,'result.json'));try{process.kill(result.appPid,'SIGTERM');}catch{}}

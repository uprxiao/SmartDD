// T04 packaged-App slot interaction. IPC prepares connections only; selection uses UI.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '../lib/app-focus-guard.mjs';
// This prerequisite mode never requests credentials; the original verification path stays available.
if(process.env.WILLYOU_MAIL_SLOTS_PREREQUISITE==='disconnected'){
 await import('./fixtures/mail-slots-disconnected-ui.mjs');
}else{
const executable=process.env.WILLYOU_ACCEPTANCE_APP;assert(executable);
const root=await mkdtemp('/private/tmp/willyou-m10-mail-slots-');
const sha=b=>createHash('sha256').update(b).digest('hex');
const result={schema:'m10-mail-slots-ui-v1',root,startedAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),layer:'A packaged UI with synthetic local mailboxes and loopback SMTP; no real mailbox, Agent or external send',asarSha256:sha(await readFile(resolve(dirname(executable),'../Resources/app.asar'))),checks:[],inputs:[],smtpData:0};
assert.equal(result.asarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
const sockets=new Set();const smtp=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setEncoding('utf8');socket.write('220 isolated ESMTP\r\n');let pending='';socket.on('data',data=>{pending+=data;let i;while((i=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+2);const command=line.split(' ')[0];if(command==='EHLO')socket.write('250-isolated\r\n250 AUTH PLAIN\r\n');else if(command==='AUTH')socket.write('235 authenticated\r\n');else if(command==='QUIT')socket.end('221 bye\r\n');else if(command==='DATA'){result.smtpData++;socket.write('554 no sending\r\n');}else socket.write('250 OK\r\n');}});});
await new Promise(r=>smtp.listen(0,'127.0.0.1',r));let app,stage='setup',project;const ids={};
const unwrap=r=>{assert(r.ok,JSON.stringify(r));return r.value;};
async function key(key,code,vk,extra={}){for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,...extra});}
async function click(selector,modifiers=0){const point=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.disabled||!e.contains(document.elementFromPoint(x,y)))throw Error('blocked control');return{x,y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,modifiers,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});result.inputs.push({selector,modifiers});}
const radio=name=>'input[type=radio][aria-label='+JSON.stringify(name)+']';
async function check(expected,name){await app.waitFor(`Array.from(document.querySelectorAll('.m10-project-application fieldset')).filter(f=>['本地读取来源','SMTP 发件账号'].includes(f.querySelector('legend')?.textContent)).length===2 && !Array.from(document.querySelectorAll('.m10-project-application fieldset')).filter(f=>['本地读取来源','SMTP 发件账号'].includes(f.querySelector('legend')?.textContent)).some(f=>f.querySelector('input:disabled'))`);const value=unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));assert.deepEqual(value.connections,expected);const dom=await app.evaluate(`Array.from(document.querySelectorAll('.m10-project-application fieldset')).map(f=>({label:f.querySelector('legend').textContent,checked:Array.from(f.querySelectorAll('input:checked')).map(x=>x.getAttribute('aria-label'))}))`);for(const f of dom.filter(f=>['本地读取来源','SMTP 发件账号'].includes(f.label)))assert.equal(f.checked.length,1);assert.equal(dom.filter(f=>['本地读取来源','SMTP 发件账号'].includes(f.label)).length,2);result.checks.push({name,expected,dom,revision:value.revision});}
try{
 app=await openElectron({executable,userData:join(root,'userdata')});installAppFocusGuard(app,result);
 await app.evaluate("document.title='A · M10 · isolated mail slots';true");
 project=await app.invoke('projects.create',{name:'M10 双槽隔离',aliases:[],description:'Synthetic T04 slot fixture',rulesPath:null});
 const mail=unwrap(await app.invoke('applications.catalog')).find(x=>x.appId==='mail');unwrap(await app.invoke('applications.setAdded','mail',true,mail.revision));
 for(const slot of ['foxmail','smtp'])for(const letter of ['A','B']){
  let config;if(slot==='foxmail'){const source=join(root,'mail-'+letter);await mkdir(join(source,'Mail/Inbox'),{recursive:true});execFileSync('/usr/bin/sqlite3',[join(source,'messages.db'),'CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);']);config={kind:'foxmail',sourcePath:source,account:'fixture-'+letter,queryDays:30};}else config={kind:'smtp',host:'127.0.0.1',port:smtp.address().port,username:letter+'@example.test',fromAddress:letter+'@example.test',authMode:'password',mode:'plain'};
  const name=slot+' '+letter,receipt=unwrap(await app.invoke('applications.testConnection',{name,expectedRevision:0,config,...(slot==='smtp'?{secret:'private-fixture-only'}:{})}));ids[name]=unwrap(await app.invoke('applications.saveConnection','mail',receipt.operationId,receipt.candidateHash)).id;
 }
 result.setup={projectId:project.id,ids,boundary:'IPC created prerequisites only; no project selection performed through IPC'};
 const old=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${old}&&Boolean(document.querySelector('[data-testid=nav-apps]'))`,15000,{navigation:true});
 stage='navigate';await click('[data-testid=nav-apps]');await app.waitFor(`Boolean(document.querySelector('.m10-sidebar .m10-nav'))`);
 const selector=await app.evaluate(`(()=>{const buttons=[...document.querySelectorAll('.m10-sidebar button')];const index=buttons.findIndex(b=>b.textContent.trim()==='项目选用');if(index<0)throw Error('missing project page');return '.m10-sidebar button:nth-of-type('+(index+1)+')';})()`);await click(selector);
 await app.waitFor(`Boolean(document.querySelector('select[aria-label="当前应用项目"]'))`);
 let focused=false;for(let i=0;i<60;i++){if(await app.evaluate(`document.activeElement?.getAttribute('aria-label')==='当前应用项目'`)){focused=true;break;}await key('Tab','Tab',9);}assert(focused);await key('Home','Home',36);await key('ArrowDown','ArrowDown',40);await key('Enter','Enter',13);await key('Tab','Tab',9);
 await app.waitFor(`Boolean(document.querySelector('[aria-label="为M10 双槽隔离启用邮件"]'))`);await click('[aria-label="为M10 双槽隔离启用邮件"]');await app.waitFor(`document.querySelector('[aria-label="为M10 双槽隔离启用邮件"]')?.getAttribute('aria-checked')==='true'`);
 stage='slot-selection';await check({foxmail:null,smtp:null},'Explicit enable starts with both slots empty');
 const expected={foxmail:null,smtp:null};
 for(const [slot,letter,modifiers] of [['foxmail','A',0],['smtp','A',0],['foxmail','B',4],['smtp','B',8]]){await click(radio('为M10 双槽隔离选用'+slot+' '+letter),modifiers);await app.waitFor(`document.querySelector(${JSON.stringify(radio('为M10 双槽隔离选用'+slot+' '+letter))})?.checked`);expected[slot]=ids[slot+' '+letter];await check({...expected},slot+' '+letter+' single choice; modifier='+modifiers);}
 for(const [slot,label] of [['foxmail','本地读取来源'],['smtp','SMTP 发件账号']]){await click(radio(label+'不选用'));await app.waitFor(`document.querySelector(${JSON.stringify(radio(label+'不选用'))})?.checked`);expected[slot]=null;await check({...expected},'Clear '+slot+' preserves other slot');}
 await app.screenshot(join(root,'slots-cleared.png'));assert.equal(result.smtpData,0);assert.deepEqual(app.rendererErrors,[]);result.status='passed-partial';
}catch(error){result.status=isAppFocusYield(error)?'deferred-focus-loss':'failed';result.stage=stage;result.error=String(error);process.exitCode=2;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(root,'failure.png'));}catch{}}
finally{if(app){await writeFile(join(root,'electron.log'),app.logs());await app.close();result.cleanup=true;}for(const s of sockets)s.destroy();await new Promise(r=>smtp.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,error:result.error}));}
}

// T13 user-assisted: real packaged App, real native folder picker, real local Foxmail profile (read-only).
// The script prepares the dialog and waits; the human clicks the native picker (cancel, then choose the profile).
// A main-process observer only RECORDS dialog.showOpenDialog results; it never answers or alters them.
// Evidence keeps ids, counts and hashes only: no path contents, account or mail text are written.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {openElectron} from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable?.startsWith('/private/tmp/willyou-m10-'),'Set WILLYOU_ACCEPTANCE_APP to the private package');
const cfg=JSON.parse(await readFile(process.env.WILLYOU_REAL_FOXMAIL_CONFIG??'/private/tmp/willyou-m10-real-foxmail-config.json','utf8'));
const sha=v=>createHash('sha256').update(v).digest('hex'),profile=cfg.profile,parent=dirname(profile);
const root=await mkdtemp('/private/tmp/willyou-m10-rf-picker-'),userData=join(root,'userdata');
const result={schema:'m10-t13-picker-ui-v1',startedAt:new Date().toISOString(),root,app:executable,profileSha:sha(profile),checks:[],status:'running',
 layer:'A real packaged App UI + real native macOS folder picker operated by the user; read-only real Foxmail profile; no SMTP; only hashes/ids/counts recorded'};
const w=ms=>new Promise(r=>setTimeout(r,ms));
const say=(kind,text)=>{console.log(kind+': '+text);};
const note=name=>{result.checks.push({name,at:new Date().toISOString()});say('CHECK',name);};
const save=()=>writeFile(join(root,'result.json'),JSON.stringify(result,null,2));
let app;
async function click(js){const p=await app.evaluate(`(()=>{const e=(${js})();if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);assert(p,'target missing: '+js);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});}
const byText=(sel,text)=>`()=>[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.offsetParent&&e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
async function type(label,value){await click(`()=>document.querySelector('dialog [aria-label=${JSON.stringify(label)}],[role=dialog] [aria-label=${JSON.stringify(label)}],[aria-label=${JSON.stringify(label)}]')`);await app.evaluate(`(()=>{const e=document.activeElement;e.select?.();return true})()`);await app.cdp('Input.insertText',{text:value});}
const field=label=>app.evaluate(`document.querySelector('[aria-label=${JSON.stringify(label)}]')?.value??null`);
const dialogText=()=>app.evaluate(`(document.querySelector('[role=dialog]')??document.querySelector('dialog')??document.body).innerText`);
async function waitCalls(n,ms){const end=Date.now()+ms;for(;;){const c=await app.mainEvaluate('globalThis.__t13.calls',{label:'t13-calls',timeoutMs:15000});if(c.length>=n)return c;assert(Date.now()<end,'Waited for the user at the native picker, no response');await w(1000);}}
try{
 app=await openElectron({executable,userData,inspectMain:true});result.appPid=app.processId;
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');const g=globalThis.__t13={calls:[]};const o=E.dialog.showOpenDialog.bind(E.dialog);E.dialog.showOpenDialog=async(...a)=>{const r=await o(...a);g.calls.push({at:Date.now(),canceled:r.canceled,count:r.filePaths.length,picked:r.filePaths[0]?process.getBuiltinModule('crypto').createHash('sha256').update(r.filePaths[0]).digest('hex'):null,dir:a.at(-1)?.properties?.includes('openDirectory')});return r;};return true})()`,{label:'t13-observer',timeoutMs:15000});
 const catalog=await app.invoke('applications.catalog'),mail=(catalog.value??catalog).find(x=>x.appId==='mail');
 assert((await app.invoke('applications.setAdded','mail',true,mail.revision)).ok);
 await app.evaluate('document.querySelector("[data-testid=nav-apps]").click();true');await w(800);
 await click(byText('main button,main a,main article,main [role=button]','邮件'));await w(800);
 await click(byText('button','添加连接'));await w(300);await click(byText('[role=menuitem]','本地读取来源'));await w(800);
 await app.waitFor("!!document.querySelector('[aria-label=\"Foxmail 本地来源\"]')",10000);
 note('Added-connection dialog for Foxmail local read-only source opened through the real UI');
 // Step 5 (wrong directory): the parent folder is not a Foxmail account source.
 await type('连接名称','T13 real Foxmail');await type('Foxmail 本地来源',parent);await type('Foxmail 邮箱账号',cfg.account);
 await click(byText('button','测试连接'));await app.waitFor("(()=>{const a=document.querySelector('[role=dialog] [role=alert],dialog [role=alert]');return !!a&&a.textContent.trim().length>0&&!a.textContent.includes('请输入')&&!document.body.innerText.includes('身份验证通过');})()",30000);
 result.wrongDirectoryMessageSha=sha(await app.evaluate("(document.querySelector('[role=dialog] [role=alert],dialog [role=alert]')).textContent"));assert.equal((await app.invoke('applications.connections','mail')).value.length,0);note('Wrong directory (Profiles parent) is refused with a visible message, not shown as an empty mailbox');
 // Step 1: user cancels the native picker.
 result.status='waiting-user-cancel';await save();
 say('ACTION_NEEDED','【第1步-拒绝】在 WillYou 的“添加 Foxmail 本地读取连接”窗口里点“选择目录”，在 macOS 文件框里点【取消】。');
 const c1=await waitCalls(1,15*60*1000);assert.equal(c1[0].canceled,true,'First picker must be cancelled');await w(500);
 assert.equal(await field('Foxmail 本地来源'),parent,'Cancelling must keep the previous path');
 note('Native picker cancelled: no path changed, no connection created ('+(await app.invoke('applications.connections','mail')).value.length+' connections)');
 // Step 2: user allows.
 result.status='waiting-user-choose';await save();
 say('ACTION_NEEDED','【第2步-允许】再点一次“选择目录”：文件框会停在 Profiles 文件夹，选中里面你的账号文件夹，点【打开】；若 macOS 弹出访问权限提示，点【允许】。');
 const c2=await waitCalls(2,15*60*1000);assert.equal(c2[1].canceled,false);
 assert.equal(c2[1].picked,sha(profile),'The chosen folder must be the real Foxmail account profile');
 await app.waitFor(`document.querySelector('[aria-label="Foxmail 本地来源"]')?.value===${JSON.stringify(profile)}`,10000);note('User chose the real profile through the native picker; field shows the chosen path');
 await click(byText('button','测试连接'));await app.waitFor("document.body.innerText.includes('身份验证通过')",60000);note('Real profile test passed through the real UI');
 await click(byText('button','保存连接'));
 const end=Date.now()+20000;let list;for(;;){list=(await app.invoke('applications.connections','mail')).value;if(list.length===1)break;assert(Date.now()<end,'connection not saved');await w(300);}
 result.savedConnection={id:list[0].id,count:list.length};note('Real Foxmail connection saved (1 connection)');
 result.status='passed-picker-allow-subset';
}catch(error){result.status='failed';result.error=String(error);say('FAILED',String(error));process.exitCode=1;}
finally{result.finishedAt=new Date().toISOString();await save();say('RESULT',result.status+' '+join(root,'result.json'));try{await app?.invoke?.('tasks.list');}catch{}process.kill(result.appPid,'SIGTERM');}

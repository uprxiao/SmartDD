// W24 tool operations through one isolated original packaged App. No system clipboard/picker.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {installFileMethodObserver,observeFileMethods,restoreFileMethodObserver} from '../lib/file-method-observer.mjs';
const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-xlsx-tool-matrix-A-'),root=join(scratch,'project');await mkdir(root);
await mkdir(join(scratch,'inputs'));for(const path of ['scripts/files/xlsx-tool-matrix-ui.mjs','scripts/files/xlsx-tool-matrix-fixtures.py','src/renderer/features/files/office/preview.tsx','src/renderer/features/files/office/format-panel.tsx'])await writeFile(join(scratch,'inputs',path.replaceAll('/','__')),await readFile(path));
const fields=process.env.WILLYOU_XLSX_TOOLS_FIELDS==='1';
const fixtures=JSON.parse(execFileSync('python3',['scripts/files/xlsx-tool-matrix-fixtures.py',fields?'create-fields':'create',root],{encoding:'utf8',maxBuffer:16*1024*1024}));
await writeFile(join(scratch,'fixtures.json'),JSON.stringify(fixtures,null,2)+'\n');
const sha=x=>createHash('sha256').update(x).digest('hex');
const r={at:new Date().toISOString(),caseIds:['M9-T-W24'],layer:'A partial independent tool matrix',scratch,root,executable,asarSha256:sha(await readFile(resolve(executable,'../../Resources/app.asar'))),checks:[],status:'running',boundary:'Original packaged App/Worker/FileService/native;owned rich OOXML copies,fresh userData. Trusted UI filter/open/range/menu/inspector/input/save/close/reopen;passive original RPC and independent ZIP/XML source readback. No DOM/store/editor assignments,substitute business RPC,clipboard/native color/font picker/external app/daily credentials or model. Fixture preparation is not a tested product operation.'};
let app,observed=false,stage='setup';
const ev=(f,...a)=>app.evaluate(`(${f.toString()})(...${JSON.stringify(a)})`),wait=(f,...a)=>app.waitFor(`(${f.toString()})(...${JSON.stringify(a)})`,30000);
const cell=a=>`[role=gridcell][data-office-row="${Number(a.slice(1))-1}"][data-office-column="${a.charCodeAt(0)-65}"]`;
async function key(key,code,modifiers=0){const v={Enter:13,Escape:27,ContextMenu:93,KeyA:65,Home:36,End:35,ArrowDown:40,ArrowUp:38,Tab:9}[code];for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code,modifiers,...(v?{windowsVirtualKeyCode:v}:{}),...(code==='KeyA'&&type==='keyDown'?{commands:['selectAll']}:{})});}
async function choose(selector,value){
 for(let attempt=0;attempt<6;attempt++){
  await wait(()=>!!document.querySelector('.fw-office-inspector fieldset:not(:disabled)'));const state=await ev(s=>({value:document.querySelector(s).value,options:[...document.querySelector(s).options].map(o=>o.value)}),selector);if(state.value===value)return;assert(state.options.includes(value));
  // Tab focus leaves the native popup closed. Each real arrow change may make
  // the busy inspector temporarily inert, so reacquire actual focus next time.
  const nearby={'[aria-label="单元格字体"]':'[aria-label="单元格字号"]','[aria-label="数值格式"]':'[aria-label="小数位"]','[aria-label="数据验证"]':'[aria-label="条件填充阈值"]'}[selector];assert(nearby);await app.click(nearby);await wait(s=>document.activeElement===document.querySelector(s),nearby);await key('Tab','Tab',8);assert(await ev(s=>document.activeElement===document.querySelector(s),selector),'Native select never received nearby Shift+Tab focus');
  const direction=state.options.indexOf(value)>state.options.indexOf(state.value)?'ArrowDown':'ArrowUp';await key(direction,direction);await key('Enter','Enter');await wait((s,old)=>document.querySelector(s)?.value!==old,selector,state.value);const after=await ev(s=>document.querySelector(s).value,selector);r.selectSteps??=[];r.selectSteps.push({selector,before:state.value,after,wanted:value,focusedBy:'Tab'});
 }
 assert.equal(await ev(s=>document.querySelector(s).value,selector),value);
}
async function text(selector,value){await app.click(selector);await key('a','KeyA',4);await app.cdp('Input.insertText',{text:value});await wait((s,v)=>document.querySelector(s)?.value===v,selector,value);}
async function open(name){await text('[aria-label="筛选文件"]',name);const s='[role=option][title='+JSON.stringify(join(root,name))+']';await wait(s=>!!document.querySelector(s),s);await app.click(s);await wait(path=>document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.title===path&&!!document.querySelector('[role=gridcell][data-office-row="0"][data-office-column="0"]'),join(root,name));}
async function close(name){await app.click('[aria-label='+JSON.stringify('关闭 '+name)+']');await wait(n=>!document.querySelector('[aria-label="关闭 '+n+'"]'),name);}
async function select(start,end=start){await app.click(cell(start));if(end!==start&&!await ev(a=>document.querySelector('[aria-label=当前选区]')?.textContent===a,start+':'+end)){const p=await ev(s=>{const e=document.querySelector(s);e.scrollIntoView({block:'nearest',inline:'nearest'});const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Occluded real range endpoint');return{x,y}},cell(end));for(const type of ['mouseMoved','mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,modifiers:8,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}await wait(a=>document.querySelector('[aria-label=当前选区]')?.textContent===a,start===end?start:start+':'+end);}
async function format(){if(!await ev(()=>!!document.querySelector('.fw-office-inspector')))await app.click('[aria-label="格式"]');await wait(()=>!!document.querySelector('.fw-office-inspector fieldset:not(:disabled)'));}
async function saved(name){await wait(()=>!!document.querySelector('.fw-tab.selected [aria-label=未保存]')&&!document.querySelector('[aria-label="保存工作簿"]').disabled);await app.click('[aria-label="保存工作簿"]');await wait(()=>document.querySelector('.fw-footer [role=status]')?.textContent==='已保存'&&!document.querySelector('.fw-tab.selected [aria-label=未保存]'));const snapshot=JSON.parse(execFileSync('python3',['scripts/files/xlsx-tool-matrix-fixtures.py','inspect',join(root,name)],{encoding:'utf8'}));await close(name);await open(name);const actual=(await observeFileMethods(app)).findLast(x=>x.method==='openOffice'&&x.delivered).output;assert.equal(actual.hash,snapshot.sha256);return snapshot;}
const labels={'fill-down':'向下填充','fill-right':'向右填充',merge:'合并单元格',unmerge:'取消合并','clear-contents':'清除内容','clear-format':'清除格式','clear-all':'全部清除','fit-column':'适应列宽','fit-row':'适应行高'};
const styles={bold:'加粗',italic:'斜体',underline:'下划线',strike:'删除线',center:'居中',right:'右对齐',left:'左对齐'};
try{
 app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata'),name:'A W24 independent XLSX tool matrix',inspectMain:true});r.pid=app.processId;await app.click('[aria-label="文件全屏"]');await installFileMethodObserver(app,['openOffice','officeCell','officeWindow','editOffice','editOfficeRange','saveOffice','closeOffice']);observed=true;
 const only=process.env.WILLYOU_XLSX_TOOL_ACTIONS?.split(',');
 for(const c of fixtures.cases.filter(c=>!only||only.includes(c.action))){
  stage=c.theme+':'+c.action+':open';console.log(JSON.stringify({stage,at:new Date().toISOString()}));await app.invoke('appSettings.update','theme','y'+c.theme);await open(c.name);const path=join(root,c.name),traceStart=(await observeFileMethods(app)).length;
  const a=c.action,target=['checkbox'].includes(a)?'H8':['fill-down'].includes(a)?'B2':labels[a]?'C2':'C3',end=a==='fill-down'?'B3':['fill-right','merge','unmerge'].includes(a)?'D2':target;await select(target,end);
  stage=c.theme+':'+a+':operate';
  if(labels[a]){await key('ContextMenu','ContextMenu');await wait(()=>!!document.querySelector('.fw-office-sheet-menu[aria-label="单元格操作"]'));await app.click('.fw-office-sheet-menu[aria-label="单元格操作"] [role=menuitem]',labels[a]);await wait(()=>!document.querySelector('.fw-office-sheet-menu[aria-label="单元格操作"]'));}
  else{
   await format();
   if(styles[a])await app.click('.fw-office-inspector [aria-label='+JSON.stringify(styles[a])+']');
   else if(a==='wrap'||a==='border')await app.click('.fw-office-inspector label',a==='wrap'?'自动换行':'单元格边框');
   else if(a==='font-size'||a==='invalid-size'){await text('[aria-label="单元格字号"]',a==='font-size'?'20':'999');await key('Enter','Enter');}
   else if(a==='conditional'){await text('[aria-label="条件填充阈值"]','20');await key('Enter','Enter');}
   else if(a==='checkbox')await app.click('.fw-office-inspector button','插入复选框');
   else if(a==='font-family')await choose('[aria-label="单元格字体"]','Georgia');
   else if(['number','currency','percent','general'].includes(a))await choose('[aria-label="数值格式"]',a);
   else if(a==='decimals'){await text('[aria-label="小数位"]','3');await key('Enter','Enter');}
   else if(a==='validation')await choose('[aria-label="数据验证"]','number');
   else throw Error('Unimplemented actual UI action '+a);
  }
  if(a==='invalid-size'){
   await wait(()=>document.querySelector('.fw-office-inspector [role=alert]')?.textContent.includes('8–48'));const message=await ev(()=>document.querySelector('.fw-office-inspector [role=alert]').textContent);await key('Escape','Escape');await wait(()=>!document.querySelector('.fw-office-inspector [role=alert]')&&document.querySelector('[aria-label="单元格字号"]').value!=='999');assert.equal(sha(await readFile(path)),c.before.sha256);assert(!((await observeFileMethods(app)).slice(traceStart)).some(x=>['formatOffice','editOfficeRange','saveOffice'].includes(x.method)));assert(!await ev(()=>!!document.querySelector('.fw-tab.selected [aria-label=未保存]')));r.checks.push({theme:c.theme,action:a,target,error:message,sourceUnchanged:true,pass:true});await close(c.name);continue;
  }
  stage=c.theme+':'+a+':save-and-reopen';const after=await saved(c.name);await copyFile(path,join(scratch,c.theme+'-'+a+'-saved.xlsx'));
  if(a==='checkbox'){await wait(()=>!!document.querySelector('[aria-label="H8 复选框"]'));assert.equal(await ev(()=>document.querySelector('[aria-label="H8 复选框"]').checked),false);await app.click('[aria-label="H8 复选框"]');const toggled=await saved(c.name);assert.equal(await ev(()=>document.querySelector('[aria-label="H8 复选框"]').checked),true);await copyFile(path,join(scratch,c.theme+'-checkbox-toggled.xlsx'));r.checks.push({theme:c.theme,action:a,target,after,toggled,pass:true});}
  else r.checks.push({theme:c.theme,action:a,target,end,after,pass:true});
  if(['merge','font-size','conditional','checkbox'].includes(a))await app.screenshot(join(scratch,c.theme+'-'+a+'.png'));await close(c.name);
 }
 r.trace=await observeFileMethods(app);for(const t of r.trace.filter(x=>x.delivered)){assert.equal(t.input,t.inputAfter);assert.equal(t.before,t.after);}r.restored=await restoreFileMethodObserver(app);observed=false;assert(Object.values(r.restored).every(Boolean));assert.deepEqual(app.rendererErrors,[]);await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()",{synchronous:true});r.exit=await app.waitForExit(20000);assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);r.status='UI save/reopen passed;independent action assertions separate';
}catch(error){r.status='failed';r.failedStage=stage;r.error=String(error);r.stack=error.stack;process.exitCode=1;if(app)try{r.trace=observed?await observeFileMethods(app):[];r.dom=await ev(()=>document.body.innerText);await app.screenshot(join(scratch,'failure.png'));}catch{}}
finally{if(app){if(observed)try{r.cleanupRestored=await restoreFileMethodObserver(app)}catch{}await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,checks:r.checks.length,scratch,failedStage:r.failedStage,error:r.error}));}

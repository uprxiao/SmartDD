// M10-T23: existing project/file/terminal UI in the ordinary packaged App.
// Local Responses controls timing only. Actual Codex, MCP, PTY and file broker run unchanged.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {dragElectronElement} from '../../lib/electron-drag.mjs';
import {pause} from '../../lib/electron-harness.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source={'legacy 中文.txt':'Existing project source 中文🙂\nKeep this line.\n','stable.txt':'Unchanged source sentinel\n'};
const exists=selector=>`!!document.querySelector(${JSON.stringify(selector)})`;
const documentText="document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()";
const tree=(cwd,name)=>`[role=treeitem][title=${JSON.stringify(join(cwd,name))}]`;
const tab=(cwd,name)=>`.fw-tab [role=tab][title=${JSON.stringify(join(cwd,name))}]`;
const settledClick=(app,click)=>async(selector,text)=>{
 // The existing project-transfer dialog moves during its opening animation.
 // Wait for the actual control and finite layout animations, then measure afresh.
 await app.waitFor(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});return !!e&&!e.matches(':disabled')&&document.getAnimations().every(a=>a.playState!=='running'||a.effect?.getTiming().iterations===Infinity)})()`);
 await click(selector,text);
};

export function legacyRegressionProbe(marker){
 const probe={phase:null,calls:[],outputs:[],held:false,connections:[]};
 const send=(res,type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 probe.respond=(body,res)=>{
  if(!probe.phase||!JSON.stringify(body).includes(marker+'_T23_'))return false;
  const phase=probe.phase,callId='call_t23_'+phase,output=(body.input??[]).find(x=>x.type==='function_call_output'&&x.call_id===callId);
  if(!probe.calls.some(x=>x.phase===phase)){
   const ns=(body.tools??[]).find(x=>x.type==='namespace'&&(x.tools??[]).some(t=>t.name==='smartdd_mail_draft_get_v1'));assert(ns,'T23 must use the real fixed Mail MCP');
   const call={type:'function_call',id:'fc_t23_'+phase,call_id:callId,name:'smartdd_mail_draft_get_v1',namespace:ns.name,arguments:JSON.stringify({draftId:probe.draft.draftId,revision:probe.draft.revision}),status:'completed'};
   probe.calls.push({phase,call,at:new Date().toISOString()});
   send(res,'response.created',{response:{id:'resp_t23_'+phase,object:'response',status:'in_progress',output:[]}});
   send(res,'response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
   send(res,'response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:call.arguments});
   send(res,'response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:call.arguments});
   send(res,'response.output_item.done',{output_index:0,item:call});
   send(res,'response.completed',{response:{id:'resp_t23_'+phase,object:'response',status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return true;
  }
  assert(output,'Actual Codex must return the local read result');
  const text=typeof output.output==='string'?output.output:JSON.stringify(output.output);assert(text.includes(probe.draft.draftId)&&text.includes(probe.draft.contentHash)&&text.includes(marker+'_LOCAL_DRAFT'),'T23 must read the unchanged actual draft identity, content hash and subject; text bodies remain resource references');
  probe.outputs.push({phase,output,at:new Date().toISOString()});
  if(phase==='hold'){
   // The local read has finished; keep the subsequent model response pending.
   // This is an active CLI turn, not a blocked native backend or an in-flight write.
   send(res,'response.created',{response:{id:'resp_t23_pending',object:'response',status:'in_progress',output:[]}});
   probe.held=true;probe.connections.push({phase,at:new Date().toISOString(),closed:false});const connection=probe.connections.at(-1);res.on('close',()=>{connection.closed=true;connection.closedAt=new Date().toISOString();});return true;
  }
  const final=marker+'_T23_RESUMED_DONE',message={id:'msg_t23_resumed',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:final,annotations:[]}]};
  send(res,'response.created',{response:{id:'resp_t23_resumed',object:'response',status:'in_progress',output:[]}});
  send(res,'response.output_item.added',{output_index:0,item:{...message,status:'in_progress',content:[]}});
  send(res,'response.content_part.added',{item_id:message.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
  send(res,'response.output_text.delta',{item_id:message.id,output_index:0,content_index:0,delta:final});
  send(res,'response.output_text.done',{item_id:message.id,output_index:0,content_index:0,text:final});
  send(res,'response.content_part.done',{item_id:message.id,output_index:0,content_index:0,part:message.content[0]});
  send(res,'response.output_item.done',{output_index:0,item:message});
  send(res,'response.completed',{response:{id:'resp_t23_resumed',object:'response',status:'completed',model:body.model,output:[message],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return true;
 };
 return probe;
}

async function fingerprint(cwd){
 return Object.fromEntries(await Promise.all(Object.keys(source).map(async name=>{const path=join(cwd,name),info=await stat(path,{bigint:true});return[name,{sha256:sha(await readFile(path)),inode:String(info.ino),mtimeNs:String(info.mtimeNs)}];})));
}
async function projectView(app,click,project){
 if(await app.evaluate(exists('.m10-shell .m10-sidebar')))await click('.m10-sidebar button','返回工作台');
 await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);await app.waitFor(exists('[data-testid=sidebar-project-edit]'));await click('[data-testid=sidebar-project-edit]');await app.waitFor(exists('[data-testid=project-files]'));
}
async function fileView(app,click,kind){
 const button=`[data-testid=${kind}-files]`;await app.waitFor(exists(button));
 if(!await app.evaluate(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-pressed')==='true'`))await click(button);
 await app.waitFor(exists('[data-testid=file-workspace]'));
}
async function open(app,click,cwd,name,expected){
 await app.waitFor(exists(tree(cwd,name)));await click(tree(cwd,name));
 try{await app.waitFor(`document.querySelector(${JSON.stringify(tab(cwd,name))})?.getAttribute('aria-selected')==='true'&&${documentText}===${JSON.stringify(expected)}`);}
 catch(error){const observation=await app.evaluate(`({requested:${JSON.stringify(name)},tabs:[...document.querySelectorAll('.fw-tab [role=tab]')].map(e=>({title:e.title,selected:e.getAttribute('aria-selected')})),document:${documentText},inputs:window.__t23InputTrace})`);error.message+='; file-open observation='+JSON.stringify(observation);throw error;}
}
async function pin(app,cwd,name){
 const selector=tab(cwd,name),point=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+Math.min(30,r.width/2),y:r.y+r.height/2}})()`);
 for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:2});
 await app.waitFor(`!document.querySelector(${JSON.stringify(selector)})?.parentElement.classList.contains('preview')`);
}

export async function prepareLegacyRegression({app,result,root,cwd,project,click:rawClick,checked}){
 const click=settledClick(app,rawClick);
 const record=result.legacyRegression={stage:'before-applications',checks:[],boundary:'M10 affected regression only; M9 remains paused. Real packaged UI/file broker/actual Codex. Model response held after a completed local read; no in-flight SMTP or remote-write claim.'};
 await app.evaluate("(()=>{window.__t23InputTrace=[];document.addEventListener('click',e=>{const item=e.target.closest('[role=treeitem],.fw-tab');if(item)window.__t23InputTrace.push({at:performance.now(),type:e.type,title:item.title||item.querySelector('[role=tab]')?.title,detail:e.detail,meta:e.metaKey,ctrl:e.ctrlKey,trusted:e.isTrusted})},true);return true})()");
 for(const [name,text] of Object.entries(source))await writeFile(join(cwd,name),text);
 record.before=await fingerprint(cwd);record.projectBefore=await app.invoke('projects.get',project.id);
 const catalog=await app.invoke('applications.catalog');assert(catalog.ok&&!catalog.value.find(x=>x.appId==='mail').added);
 await projectView(app,click,project);await fileView(app,click,'project');await open(app,click,cwd,'legacy 中文.txt',source['legacy 中文.txt']);await pin(app,cwd,'legacy 中文.txt');
 await app.screenshot(join(root,'t23-before-applications.png'));
 await click('[data-testid=project-files]');await app.waitFor('!document.querySelector("[data-testid=file-workspace]")');
 await click('.project-actions button','导出项目');await app.waitFor(exists('[data-testid=project-transfer-dialog]'));assert((await app.evaluate("document.querySelector('[data-testid=project-transfer-dialog]').innerText")).includes('口令'));
 await click('[aria-label="关闭项目迁移"]');await app.waitFor('!document.querySelector("[data-testid=project-transfer-dialog]")');
 record.checks.push({step:1,phase:'before',projectId:project.id,fileReadable:true,exportEntry:true});checked('T23 before adding Mail: existing project file view, exact document and M8 export form remain reachable');
}

export async function checkLegacyRegression({app,result,root,cwd,project,task,secondTask,probe,marker,click:rawClick,key,poll,checked}){
 const click=settledClick(app,rawClick);
 const record=result.legacyRegression;record.stage='after-applications';
 await app.evaluate("(()=>{window.__t23InputTrace=[];document.addEventListener('click',e=>{const item=e.target.closest('[role=treeitem],.fw-tab');if(item)window.__t23InputTrace.push({at:performance.now(),type:e.type,title:item.title||item.querySelector('[role=tab]')?.title,detail:e.detail,meta:e.metaKey,ctrl:e.ctrlKey,trusted:e.isTrusted})},true);return true})()");
 const before=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.nativeSessionId&&t.ptyId?t:null;}),secondBefore=await poll(async()=>{const t=await app.invoke('tasks.get',secondTask.id);return t.nativeSessionId&&t.ptyId?t:null;}),diagnostic=await app.invoke('applications.session',task.id);assert(diagnostic.ok);
 const draft=await app.invoke('applications.draft',project.id,result.createdDraft.id,result.createdDraft.revision);assert(draft.ok);
 const snapshotPath=join(result.userData,'capabilities/sessions',task.id,'snapshot.json'),snapshotBytes=await readFile(snapshotPath);
 const show=async t=>{if(await app.evaluate(exists('.m10-shell .m10-sidebar')))await click('.m10-sidebar button','返回工作台');await click(`[data-task-id="${t.id}"]`);await app.waitFor(`!!document.querySelector('[data-testid=task-header]')&&!!document.querySelector('[data-testid=task-terminal][data-pty="${t.ptyId}"]')`);};
 await show(before);await fileView(app,click,'task');
 const edited=source['legacy 中文.txt']+'M10 regression saved by actual editor 中文🙂\n';
 await open(app,click,cwd,'legacy 中文.txt',source['legacy 中文.txt']);await pin(app,cwd,'legacy 中文.txt');await click('.cm-content');await key('End','End',35,4);await app.cdp('Input.insertText',{text:'M10 regression saved by actual editor 中文🙂\n'});await app.waitFor(`${documentText}===${JSON.stringify(edited)}`);
 await poll(async()=>await readFile(join(cwd,'legacy 中文.txt'),'utf8')===edited);await app.waitFor("!document.querySelector('.fw-tab.selected .fw-dirty')&&document.querySelector('[data-testid=file-workspace] footer')?.textContent.includes('已保存')");record.savedFile={text:edited,sha256:sha(await readFile(join(cwd,'legacy 中文.txt')))};
 await open(app,click,cwd,'stable.txt',source['stable.txt']);await pin(app,cwd,'stable.txt');
 const requestsBeforeDrag=result.requests.length,terminal=`[data-testid=task-terminal][data-pty="${before.ptyId}"] .xterm-screen`;
 const drag=await dragElectronElement(app,tree(cwd,'stable.txt'),terminal);await app.waitFor(`document.querySelector('[data-testid=task-terminal][data-pty="${before.ptyId}"]')?.innerText.includes('stable.txt')`);
 assert.equal(result.requests.length,requestsBeforeDrag,'Dropping a file path must not submit a native model turn');
 await click(terminal);await key('u','KeyU',85,2);record.checks.push({step:3,drag,requestCountBefore:requestsBeforeDrag,requestCountAfter:result.requests.length});checked('T23 after Mail use: exact file edit autosaves; genuine Chromium file drag inserts path into actual Codex input without submitting');
 for(const theme of ['light','dark']){
  await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await app.waitFor(`document.documentElement.classList.contains('ydark')===${theme==='dark'}`);
  await open(app,click,cwd,'legacy 中文.txt',edited);await app.screenshot(join(root,'t23-file-'+theme+'.png'));
 }
 await projectView(app,click,project);const afterProject=await app.invoke('projects.get',project.id);for(const name of ['dirs','databases','servers'])assert.deepEqual(afterProject[name],record.projectBefore[name]);
 await click('.project-actions button','导出项目');await app.waitFor(exists('[data-testid=project-transfer-dialog]'));await click('[aria-label="关闭项目迁移"]');await app.waitFor('!document.querySelector("[data-testid=project-transfer-dialog]")');
 await click('[data-testid=sidebar-new-project]');await app.waitFor(exists('[role=menu]'));await click('[role=menuitem]','导入项目');await app.waitFor(exists('[data-testid=project-transfer-dialog]'));assert((await app.evaluate("document.querySelector('[data-testid=project-transfer-dialog]').innerText")).includes('选择项目文件'));await click('[aria-label="关闭项目迁移"]');await app.waitFor('!document.querySelector("[data-testid=project-transfer-dialog]")');
 record.checks.push({step:1,phase:'after',project:afterProject,m8Boundary:'Only actual entry and cancellation; no native picker or transfer claim'});checked('T23 project resources and existing M8 import/export entries survive application use unchanged');
 await show(before);await fileView(app,click,'task');await open(app,click,cwd,'legacy 中文.txt',edited);
 probe.draft={draftId:result.createdDraft.id,revision:result.createdDraft.revision,contentHash:draft.value.draft.contentHash};assert.match(probe.draft.contentHash,/^[a-f0-9]{64}$/);probe.phase='hold';
 await click(terminal);await key('u','KeyU',85,2);await app.cdp('Input.insertText',{text:marker+'_T23_HOLD: Read the existing isolated local draft. Do not change or send anything.'});await pause(400);await key('Enter','Enter',13);
 await poll(async()=>probe.held&&probe.outputs.some(x=>x.phase==='hold'));assert(probe.connections.some(x=>!x.closed));
 record.activeTurn={phase:'model response pending after completed real MCP draft read',task:await app.invoke('tasks.get',task.id),output:probe.outputs.find(x=>x.phase==='hold')};
 await show(secondBefore);const alive=await app.invoke('tasks.get',task.id);assert.equal(alive.ptyId,before.ptyId);assert.equal(alive.nativeSessionId,before.nativeSessionId);assert(probe.connections.some(x=>!x.closed));
 await show(before);await fileView(app,click,'task');await open(app,click,cwd,'legacy 中文.txt',edited);await app.screenshot(join(root,'t23-active-turn-file-restored.png'));
 await click('[data-testid=task-actions]');await app.waitFor(exists('[data-testid=task-kill]'));await click('[data-testid=task-kill]');
 const stopped=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return !t.ptyId&&t.recovery==='resumable'?t:null;});assert.equal(stopped.nativeSessionId,before.nativeSessionId);
 await poll(async()=>probe.connections.every(x=>x.closed));record.stopped=stopped;record.checks.push({step:2,activeTurn:record.activeTurn,stopped});checked('T23 switches to an ordinary unselected Codex task during a pending turn, returns with exact file state, then stops A through its actual task menu');
 probe.phase='resumed';record.stage='actual-ui-resume';await click('[data-testid=task-actions]');await app.waitFor(exists('[data-testid=task-header-resume]'));await click('[data-testid=task-header-resume]');
 const resumed=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.ptyId&&t.ptyId!==before.ptyId?t:null;});assert.equal(resumed.nativeSessionId,before.nativeSessionId);await app.waitFor(exists(`[data-testid=task-terminal][data-pty="${resumed.ptyId}"] .xterm-screen`));
 await app.waitFor(`document.querySelector('[data-testid=task-terminal][data-pty="${resumed.ptyId}"]')?.innerText.includes('for shortcuts')`,20000);
 await click(`[data-testid=task-terminal][data-pty="${resumed.ptyId}"] .xterm-screen`);await app.cdp('Input.insertText',{text:marker+'_T23_RESUME: Read the same isolated draft once and reply. No changes or sending.'});await pause(400);await key('Enter','Enter',13);
 await poll(async()=>probe.outputs.some(x=>x.phase==='resumed')&&(await app.output(resumed.ptyId)).includes(marker+'_T23_RESUMED_DONE'));probe.phase=null;
 const final=await app.invoke('applications.session',task.id);assert(final.ok);assert.equal(final.value.snapshotHash,diagnostic.value.snapshotHash);assert.deepEqual(await readFile(snapshotPath),snapshotBytes);assert.notEqual(final.value.currentRun.id,diagnostic.value.currentRun.id);
 const draftAfter=await app.invoke('applications.draft',project.id,result.createdDraft.id,result.createdDraft.revision);assert(draftAfter.ok);assert.deepEqual(draftAfter.value,draft.value);
 await fileView(app,click,'task');await open(app,click,cwd,'legacy 中文.txt',edited);await app.screenshot(join(root,'t23-resumed-file-and-terminal.png'));
 const bAfter=await app.invoke('tasks.get',secondTask.id);assert.equal(bAfter.ptyId,secondBefore.ptyId);assert.equal(bAfter.nativeSessionId,secondBefore.nativeSessionId);
 record.after=await fingerprint(cwd);assert.deepEqual(record.after['stable.txt'],record.before['stable.txt']);assert.equal(record.after['legacy 中文.txt'].sha256,record.savedFile.sha256);
 record.inputTrace=await app.evaluate('window.__t23InputTrace');assert(record.inputTrace.every(x=>x.trusted));record.resumed={before,resumed,diagnosticBefore:diagnostic.value,diagnosticAfter:final.value,probe:{calls:probe.calls,outputs:probe.outputs,connections:probe.connections},bBefore:secondBefore,bAfter,snapshotBytesSha256:sha(snapshotBytes)};record.checks.push({step:4,sameNativeIdentity:true,newPtyAndRun:true,sameSnapshot:true,sameDraft:true,fileRestored:true,otherTaskUnchanged:true});record.stage='passed';
 checked('T23 actual header Resume keeps original native session, fixed package/snapshot, unchanged local draft and file workspace; new PTY/run completes actual MCP read while B remains intact');
}

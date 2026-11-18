import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron } from '../../../scripts/lib/electron-harness.mjs';
import { scenes, projectTitle, seed, sizes } from './state-fixture.mjs';

const output=process.argv[2];
const styleReview=process.argv.includes('--review-styles');
const styleScenes=new Set(['done','links','stopping']);
mkdirSync(output,{recursive:true});
const root=realpathSync(mkdtempSync('/private/tmp/willyou-m14-state-'));
const home=join(root,'home'), userData=join(root,'data');
mkdirSync(home);mkdirSync(userData);
const q=JSON.stringify, sel=s=>`document.querySelector(${q(s)})`;
const report={layer:'development App / synthetic UI comparison',root,results:[],failures:[]};
let app;
const menuText=(t,scope='document')=>`[...${scope}.querySelectorAll('button')].find(e=>e.innerText.trim()===${q(t)})`;
const click=async element=>{
 const coords=`(()=>{const node=${element};if(!node||node.disabled)return null;node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return r.width&&r.height&&node.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`;
 await app.waitFor(`Boolean(${coords})`,8000);
 const point=await app.evaluate(coords);
 assert(point,element);
 for(const type of ['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
};
const identify=`const rq=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
 const E=rq('electron');
 if(E.app.getPath('userData')!==${q(userData)})throw Error('Test process identity changed');`;
const sql=async body=>app.mainEvaluate(`(()=>{
 ${identify}
 const db=new (rq('better-sqlite3'))(${q(join(userData,'smartdd.db'))});
 try{return ${body};}finally{db.close();}
})()`);
const chooseTask=async (id,title)=>{
 await click(sel(`[data-testid="sidebar-agent-task"][data-task-id="${id}"]`));
 await app.waitFor(`document.querySelector('.agent-task-head h1')?.innerText===${q(title)}`,8000);
};
const dialogStable=`(() => {
 const dialog=document.querySelector('[data-slot="dialog-content"]');
 return dialog && getComputedStyle(dialog).opacity === '1' && !document.querySelector('[data-slot="popover-content"]') &&
 !dialog.getAnimations({subtree:true}).some(a=>a.playState==='running');
})()`;
const collect=async (view,name)=>{
 await app.evaluate('document.fonts.ready.then(()=>true)');
 await app.waitFor("!document.getAnimations().some(a=>a.playState==='running' && a.effect?.getTiming().iterations!==Infinity && a.effect.target?.closest('.agent-task-view,[data-slot=dialog-content]'))",8000);
 const state=await app.evaluate(`(() => {
   const part=document.querySelector('[data-slot="dialog-content"]')??document.querySelector('[data-testid="archived-agent-tasks"]')??document.querySelector('.agent-task-view');
   const rect=part?.getBoundingClientRect();
   return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,
    panelWidth:rect?.width,text:part?.innerText.slice(-3400),status:part?.querySelector('.agent-status')?.innerText,
    request:part?.querySelector('.agent-request-head')?.innerText,discussion:part?.querySelector('.agent-assistant.streaming')?.innerText,
    taskWidth:document.querySelector('.agent-task-view')?.clientWidth,visibleComposer:!!part?.querySelector('.agent-composer'),
    layer:document.querySelector('[data-slot="dialog-content"]')?.getAttribute('data-state'),
    overlapsMenu:!!document.querySelector('[data-slot="dialog-content"]')&&!!document.querySelector('[data-slot="popover-content"]'),
    diff:[...document.querySelectorAll('select[aria-label="差异回合"] option')].map(o=>o.text),
   };
 })()`);
 await app.screenshot(join(output,`${view}-${name}.png`));
 report.results.push({view,name,...state});
};

try {
 app=await openElectron({userData,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')},inspectMain:true});
 await app.invoke('agents.refreshTools');
 const tool=(await app.invoke('agents.tools')).find(t=>t.kind==='codex'&&t.installed);
 assert(tool,'test fixture needs the locally detected Codex profile type');
 const provider=await app.invoke('agents.saveProvider',{name:'M14 夹具',preset:'magpie',endpoints:{responses:'http://127.0.0.1:1/v1',anthropic:'http://127.0.0.1:1'},models:[{id:'fixture',name:'Fixture'}]});
 await sql(`db.prepare("UPDATE ai_providers SET models=json_set(models,'$[0].availability.codex','available') WHERE id=?").run(${q(provider.id)})`);
 const profile=await app.invoke('agents.save',{name:'Fixture Codex',toolId:tool.id,source:'provider',providerId:provider.id,models:['fixture'],defaultModel:'fixture',isDefault:true});
 async function createProject(title,dir){
  const cwd=join(root,dir);mkdirSync(cwd);
  const project=await app.invoke('projects.create',{name:title,aliases:[],description:'',rulesPath:null},[{label:'workspace',path:cwd}]);
  return {...project,cwd};
 }
 const p=await createProject(projectTitle,'compare'), deletion=await createProject('核对归档项目','delete'), refusal=await createProject('还有待批准请求','refuse');
 const makeTask=async(p,title)=>(await app.invoke('agentTasks.create',{projectId:p.id,dirId:p.dirs[0].id,cwd:p.cwd,profileId:profile.id,tier:'ask',title})).taskId;
 const file=(name,text)=>{const path=join(p.cwd,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text);};
 file('scripts/build.mjs','export const platforms = ["arm64"];\n');
 file('src/main.ts',Array.from({length:42},(_,i)=>`// fixture line ${i+1}`).join('\n'));
 file('src/renderer/App.tsx','// fixture editor target');
 file('notes/round-1.md','检查记录\n');
 file('docs/发布说明.md','测试说明');
 const git=(...args)=>execFileSync('git',args,{cwd:p.cwd}).toString().trim();
 git('init','-qb','main');git('add','-A');git('-c','user.name=M14 Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
 const worktrees={}, tasks=[];
 for(const scene of scenes){
  const id=await makeTask(p,scene.name);
  const children=[];
  for(const [n,child] of (scene.children??[]).entries()){
   const childId=await makeTask(p,child.title);
   if(child.branch)worktrees[childId]=join(root,'worktree-'+scene.id+'-'+n);
   children.push({child,id:childId});
  }
  tasks.push({id,scene,children});
 }
 const archived=await makeTask(deletion,'整理启动检查结果'), blocker=await makeTask(refusal,'待批准命令');
 const keys=tasks.filter(t=>['done','diff-history'].includes(t.scene.id)).map(({scene,id})=>[scene.id,id+'-'+scene.turns[0].id]);
 const capture=async side=>app.mainEvaluate(`(async()=>{
  ${identify}
  const Worker=process.getBuiltinModule('worker_threads').Worker;
  const jobs=${q(keys.map(([key,turnId])=>({key,turnId,cwd:p.cwd,storage:join(userData,'agent-diffs'),side,kind:'willyou-turn-diff-job',action:'capture'})))};
  return Object.fromEntries(await Promise.all(jobs.map(({key,...workerData})=>new Promise((resolve,reject)=>{
   const worker=new Worker(${q(join(process.cwd(),'out/main/agent-diff-worker.js'))},{workerData});
   worker.on('message',m=>{if(m.ok)resolve([key,JSON.stringify(m.value)]);else if(m.error)reject(Error(m.error));});
   worker.once('error',reject);
   worker.once('exit',code=>{if(code)reject(Error('worker '+code));});
  }))));
 })()`);
 const before=await capture('before');
 file('scripts/build.mjs','export const platforms = ["arm64", "x64"];\n');
 file('notes/round-1.md','检查记录 1\n');
 const after=await capture('after');
 const snapshots=Object.fromEntries(keys.map(([key])=>[key,[before[key],after[key]]]));
 const archivedScene={id:'g5-readonly',turns:[{id:'archive',state:'done',user:{text:'整理启动检查结果'},final:['启动与设置检查已整理完成。']}]};
 const setupError=await sql(`(()=>{try{(${seed.toString()})(db,${q({tasks:[...tasks,{id:archived,scene:archivedScene,children:[]}],cwd:p.cwd,worktrees,archived,blocker,snapshots})});return null;}
 catch(error){return String(error.stack??error);}})()`);
 assert.equal(setupError,null,'synthetic seed');
 // Set the pending-stop clock only for the one visual fixture. The real handler builds the
 // rest of its snapshot and checks the actual sender; no test action calls forceStop.
 const stopId=tasks.find(t=>t.scene.id==='stopping').id;
 await app.mainEvaluate(`(()=>{
  ${identify}
  const channel='agentTasks.snapshot', handler=E.ipcMain._invokeHandlers.get(channel);
  if(!handler)throw Error('Test snapshot endpoint missing');
  E.ipcMain.removeHandler(channel);
  E.ipcMain.handle(channel,async(event,taskId)=>{
   const snapshot=await handler(event,taskId);
   return taskId===${q(stopId)}?{...snapshot,stopping:{runId:'fixture-stop',requestedAt:Date.now()-11000,forceAt:Date.now()-1000,closing:false}}:snapshot;
  });
  return true;
 })()`);

 await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');true");
 const openSettings=async()=>{
  await click(sel('[data-testid="nav-settings"]'));
  await click(menuText('已归档任务'));
  await app.waitFor(`Boolean(${sel('[data-testid="archived-agent-tasks"]')})`,8000);
 };
 const openDelete=async project=>{
  await click(sel(`[data-testid="sidebar-project"][data-project-id="${project.id}"] [data-testid="sidebar-project-more"]`));
  await click(sel('[data-testid="sidebar-project-delete"]'));
  await app.waitFor(dialogStable,10000);
 };
 for(const [view,theme,width,height] of sizes) {
  if(styleReview && view==='narrow')continue;
  await app.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await app.invoke('appSettings.update','theme',theme);
  await app.evaluate('location.reload();true');
  await app.waitFor(`document.documentElement?.classList.contains(${q(theme)}) && Boolean(document.querySelector('.reference-sidebar'))`,8000);
  for(const {id,scene} of tasks){
   if(styleReview && !styleScenes.has(scene.id))continue;
   try{
    await chooseTask(id,scene.name);
    if(scene.id==='done' && await app.evaluate(`Boolean(document.querySelector('[data-testid="agent-workspace-panel"]'))`)){
     await click(sel('.agent-task-head [title="打开右侧面板"]'));
     await app.waitFor(`!document.querySelector('[data-testid="agent-workspace-panel"]')`,8000);
    }
    if(scene.id==='streaming'){
     const text=scene.turns.at(-1).final.join('\n\n');
     await app.mainEvaluate(`(()=>{
      ${identify}
      const target=E.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/index.html'));
      if(target.length!==1)throw Error('Fixture WebContents is ambiguous');
      target[0].webContents.send('agentTasks:live',${q({taskId:id,runId:'fixture',itemKey:'fixture-stream',text})});
      return true;
     })()`);
     await app.waitFor("Boolean(document.querySelector('.agent-assistant.streaming'))",8000);
    }
    if(scene.teamPanel){
     const toggle=sel('.agent-lineage-toggle');
     await app.waitFor(`Boolean(${toggle})`,8000);
     assert.equal(await app.evaluate(`!document.querySelector('.agent-lineage')`),true);
     await click(toggle);
     await app.waitFor("Boolean(document.querySelector('.agent-lineage [aria-current=page]'))",8000);
     if(scene.id==='team'){
      await click(sel('.agent-child-request-link'));
      await app.waitFor("Boolean(document.querySelector('.agent-lineage .agent-child-card [aria-current=page]'))",8000);
      await click(sel('.agent-lineage>.agent-child-list>.agent-child-open'));
      await app.waitFor(`document.querySelector('.agent-task-head h1')?.innerText===${q(scene.name)} && Boolean(document.querySelector('.agent-lineage'))`,8000);
     }
    }
    if(scene.id==='native'){
     await click(sel('.agent-work-row:has(button.agent-older) summary'));
     await click(menuText('查看过程'));
     await app.waitFor("Boolean(document.querySelector('.agent-task-aux .agent-native-process'))",8000);
     assert(await app.evaluate(`!document.querySelector('[data-slot="dialog-content"]')`));
    }
    if(scene.id==='starting')await app.waitFor("document.querySelector('.agent-timeline')?.innerText.includes('思考中') || [...document.querySelectorAll('[role=status]')].some(e=>e.innerText.startsWith('思考中'))",8000);
    if(scene.id==='stopping')await app.waitFor("Boolean([...document.querySelectorAll('.agent-task-view button')].find(e=>e.innerText.trim()==='强制停止'))",8000);
    if(scene.id==='limited')assert(await app.evaluate("document.querySelector('.agent-turn-footer')?.innerText.startsWith('已暂停')"));
    if(scene.id==='length')assert(await app.evaluate("[...document.querySelectorAll('.agent-limited')].some(e=>e.innerText.includes('部分回答已保留，可手动继续'))"));
    if(scene.id==='diff-history'){
     const firstCard="[...document.querySelectorAll('.agent-change-card')].find(e=>e.closest('.agent-turn')?.innerText.includes('更新第 1 轮')) ?? document.querySelector('.agent-change-card')";
     await click(firstCard);
     await app.waitFor(`document.querySelector('select[aria-label="差异回合"]')?.value===${q(id+'-history-1')}`,8000);
     await click(menuText('加载更早轮次'));
     await app.waitFor("document.querySelector('select[aria-label=\"差异回合\"]')?.options.length===54",8000);
    }
    if(styleReview && scene.id!=='stopping'){
     const markdown=await app.evaluate(`(()=>{
      const reply=document.querySelector('.agent-assistant .agent-md');
      const links=[...reply.querySelectorAll('a[data-agent-link]')];
      const heading=[...reply.querySelectorAll('p > strong')].find(node=>node.textContent.startsWith('不会打开'));
      return {
       markers:[...reply.querySelectorAll('ul')].map(node=>getComputedStyle(node).listStyleType),
       weight:getComputedStyle(reply.querySelector('strong')).fontWeight,
       colors:[...new Set(links.map(link=>getComputedStyle(link).color))],
       separateBlockedHeading:!!heading&&!heading.closest('li'),
      };
     })()`);
     assert(markdown.markers.length && markdown.markers.every(style=>style==='disc'));
     assert.equal(markdown.weight,'700');
     assert.deepEqual(markdown.colors,[theme==='ydark'?'rgb(122, 167, 255)':'rgb(47, 111, 222)']);
     if(scene.id==='links')assert(markdown.separateBlockedHeading);
     report.checks??=[];
     report.checks.push({view,scene:scene.id,markdown});
    }
    if(styleReview && scene.id==='stopping'){
     const banner=await app.evaluate(`(()=>{
      const panel=document.querySelector('.agent-stop-banner');
      return {text:panel.innerText,color:getComputedStyle(panel.querySelector('.agent-force-stop')).backgroundColor};
     })()`);
     assert.match(banner.text,/Agent 未响应停止（已等待 [1-9][0-9] 秒）/);
     assert.match(banner.text,/可能内存不足，强制停止会结束它的进程/);
     assert.equal(banner.color,'rgb(189, 48, 55)');
     report.checks??=[];
     report.checks.push({view,scene:scene.id,banner});
    }
    await collect(view,scene.id);
    if(scene.teamPanel){
     const row=report.results.at(-1);
     row.lineage=await app.evaluate("document.querySelector('.agent-lineage')?.innerText");
     assert(row.lineage?.includes('任务关系'));
    }
   }catch(error){
    report.failures.push({view,name:scene.id,error:String(error)});
    await app.screenshot(join(output,`${view}-${scene.id}-failure.png`));
   }
  }
  if(styleReview){
   console.log(view,report.results.filter(x=>x.view===view).length,'screenshots');
   continue;
  }
  await openDelete(deletion);
  await app.waitFor("document.querySelector('[data-slot=\"dialog-content\"]')?.innerText.includes('将删除 1 个 Agent 任务')",8000);
  await collect(view,'g1-delete');
  assert.equal(report.results.at(-1).panelWidth,490);
  assert.equal(report.results.at(-1).overlapsMenu,false);
  await click(menuText('取消',"document.querySelector('[data-slot=dialog-content]')"));
  await openDelete(refusal);
  await app.waitFor("document.querySelector('[data-slot=\"dialog-content\"]')?.innerText.includes('项目暂时无法删除')",8000);
  await collect(view,'g1-refusal');
  await click(menuText('取消',"document.querySelector('[data-slot=dialog-content]')"));
  await openSettings();
  await collect(view,'g5-settings');
  await click(sel('.agent-archive-open'));
  await app.waitFor("document.querySelector('[aria-label=\"已归档任务输入\"]')?.disabled===true",8000);
  await collect(view,'g5-readonly');
  console.log(view,report.results.filter(x=>x.view===view).length,'screenshots');
 }
} catch(error) {
 report.error=String(error.stack??error);
 if(app){report.visible=await app.evaluate('document.body.innerText').catch(()=>null);await app.screenshot(join(output,'failure.png')).catch(()=>{});}
} finally {
 if(app){
  try {
   // The isolated data contains deliberately pending requests and partial turns.
   await sql("db.transaction(()=>{db.prepare(\"UPDATE agent_requests SET status='retired' WHERE status='pending'\").run();db.prepare(\"UPDATE agent_turns SET status='interrupted' WHERE status IN ('accepted','dispatching','started')\").run();db.prepare(\"UPDATE agent_delegations SET delivery_state='canceled' WHERE delivery_state IN ('running','queued','queued_for_parent')\").run();return true;})()");
   await app.mainEvaluate(`(()=>{${identify}setTimeout(()=>E.app.quit(),50);return true;})()`);
   report.exit=await app.waitForExit(20000);
   assert.equal(report.exit.code,0);
  }catch(error){report.exitError=String(error);}
  report.rendererErrors=app.rendererErrors;
  await app.close();
 }
 writeFileSync(join(output,'app.json'),JSON.stringify(report,null,2)+'\n');
 if(report.error||report.exitError||report.failures.length||report.rendererErrors?.length)process.exitCode=1;
}

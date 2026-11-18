import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { openElectron } = await import(pathToFileURL(join(process.cwd(),'scripts/lib/electron-harness.mjs')));
const out = process.argv[2];
const theme = process.argv[3] === 'dark' ? 'ydark' : 'ylight';
mkdirSync(out,{recursive:true});
const root=realpathSync(mkdtempSync('/private/tmp/willyou-m14-overall-'));
const home=join(root,'home'),userData=join(root,'data');
mkdirSync(home);mkdirSync(userData);
const evidence={layer:'development App, isolated synthetic project and task data',root,theme,checks:[]};
let app;
let blockerRecord;

const check = name=>evidence.checks.push(name);
const lit=JSON.stringify;
const visible=text=>`document.body.innerText.includes(${lit(text)})`;
const selector=q=>`document.querySelector(${lit(q)})`;
const textButton=(text,scope='document')=>`[...${scope}.querySelectorAll('button')].find(e=>e.innerText.trim()===${lit(text)})`;
async function click(element) {
 const expression=`(()=>{const e=${element};if(!e||e.disabled)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))return null;return {x,y}})()`;
 await app.waitFor(`Boolean(${expression})`,10000);
 const xy=await app.evaluate(expression);
 assert(xy);
 for(const type of ['mousePressed','mouseReleased']) await app.cdp('Input.dispatchMouseEvent',{...xy,type,button:'left',clickCount:1});
}
async function writeFixture(data){
 const payload=lit(data);
 return app.mainEvaluate(`(()=>{
   const rq=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'), E=rq('electron');
   if(E.app.getPath('userData')!==${lit(userData)})throw Error('test identity changed');
   const f=${payload}, db=new (rq('better-sqlite3'))(${lit(join(userData,'smartdd.db'))});
   db.pragma('foreign_keys=ON');
   const stamp=new Date().toISOString();
   try{
    db.transaction(()=>{
     const makeRelation=(child,mode)=>{
      db.prepare('UPDATE agent_tasks SET parent_task_id=? WHERE task_id=?').run(f.main,child);
      db.prepare("INSERT INTO agent_delegations(delegation_id,parent_task_id,child_task_id,target_json,access,request_key,delivery_state,created_at,updated_at) VALUES(?,?,?,?,'write',?,'delivered',?,?)").run(child,f.main,child,JSON.stringify({strategy:mode,title:mode==='git'?'隔离子任务':'共用子任务',profile:{name:'Fixture Codex'}}),child,stamp,stamp);
      db.prepare("INSERT INTO agent_delegation_attempts(attempt_id,delegation_id,ordinal,kind,input_ref,created_at) VALUES(?,?,1,'initial','{}',?)").run(child,child,stamp);
     };
     makeRelation(f.shared,'serial');makeRelation(f.worktree,'git');
     db.prepare("INSERT INTO agent_workspaces(workspace_id,task_id,child_task_id,kind,repo_root,path,branch,state,created_at,updated_at) VALUES(?,?,?,'git_worktree',?,?,?,'ready',?,?)").run(f.worktree,f.main,f.worktree,f.cwd,f.worktreePath,'fixture-child',stamp,stamp);
     db.prepare('UPDATE tasks SET cwd=? WHERE id=?').run(f.worktreePath,f.worktree);
     db.prepare("INSERT INTO agent_requests(request_id,task_id,class,origin_json,payload_ref,kind,status,created_at,updated_at) VALUES(?,?,'native','{}','{}','command','pending',?,?)").run(f.blocker,f.blocker,stamp,stamp);
     const turn=db.prepare("INSERT INTO agent_turns(turn_id,task_id,input_ref,client_input_id,source_kind,status,accepted_at) VALUES(?,?, '{}',?,'user','completed',?)");
     const change=db.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,status,incomplete_reason) VALUES(?,?,'none',?)");
     for(let i=1;i<=55;i++){const id='fixture-turn-'+i;turn.run(id,f.main,id,stamp);change.run(id,f.main,i===1?'快照已清理（空间回收）':'第 '+i+' 轮的合成快照');}
     db.prepare("INSERT INTO agent_items(item_id,task_id,turn_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES('fixture-diff',?,'fixture-turn-1','files_changed',1,1,'history-diff',?,'completed',?,?)").run(f.main,JSON.stringify({turnId:'fixture-turn-1',reason:'快照已清理（空间回收）'}),stamp,stamp);
     db.prepare("INSERT INTO agent_items(item_id,task_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES('fixture-reply',?,'assistant_message',1,1,'fixture-reply',?,'completed',?,?)").run(f.shared,JSON.stringify({text:'已归档子任务的历史'}),stamp,stamp);
    })();
   }finally{db.close();}
   return true;
 })()`);
}

try {
 app=await openElectron({userData,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')},inspectMain:true});
 const size=(width,height)=>app.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await size(1440,900);
 await app.invoke('appSettings.update','theme',theme);
 await app.invoke('agents.refreshTools');
 const installed=(await app.invoke('agents.tools')).find(t=>t.kind==='codex'&&t.installed);
 assert(installed,'the isolated App needs a local Codex executable to register a task profile');
 const provider=await app.invoke('agents.saveProvider',{name:'Isolated UI fixture',preset:'magpie',endpoints:{responses:'http://127.0.0.1:1/v1',anthropic:'http://127.0.0.1:1'},models:[{id:'fixture',name:'Fixture'}]});
 await app.mainEvaluate(`(()=>{
   const rq=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
   if(rq('electron').app.getPath('userData')!==${lit(userData)})throw Error('test identity changed');
   const db=new (rq('better-sqlite3'))(${lit(join(userData,'smartdd.db'))});
   try{db.prepare("UPDATE ai_providers SET models=json_set(models,'$[0].availability.codex','available') WHERE id=?").run(${lit(provider.id)});}finally{db.close();}
   return true;
 })()`);
 const profile=await app.invoke('agents.save',{name:'Fixture',toolId:installed.id,source:'provider',providerId:provider.id,models:['fixture'],defaultModel:'fixture',isDefault:true});
 async function makeProject(title,basename) {
  const cwd=join(root,basename);mkdirSync(cwd);
  const project=await app.invoke('projects.create',{name:title,aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  return {cwd,project};
 }
 async function makeTask({project},title) {
  return (await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd:'/invalid-client-cwd',title,profileId:profile.id,tier:'ask'})).taskId;
 }
 const p=await makeProject('M14 审阅项目','repo'),blocked=await makeProject('M14 未收口','blocked');
 const worktreePath=join(root,'owned-worktree');
 execFileSync('git',['init','-qb','main'],{cwd:p.cwd});
 writeFileSync(join(p.cwd,'source.txt'),'source');
 execFileSync('git',['add','-A'],{cwd:p.cwd});
 execFileSync('git',['-c','user.name=M14 Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base'],{cwd:p.cwd});
 execFileSync('git',['worktree','add','-b','fixture-child',worktreePath,'HEAD'],{cwd:p.cwd});
 const main=await makeTask(p,'M14 审阅任务'),shared=await makeTask(p,'共用子任务'),worktree=await makeTask(p,'隔离子任务'),blocker=await makeTask(blocked,'等待审批的任务');
 await writeFixture({main,shared,worktree,worktreePath,cwd:p.cwd,blocker});
 blockerRecord=blocker;

 // The feature flag is setup; the reviewed actions use real Electron Input clicks.
 await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
 const taskSelector=id=>selector(`[data-testid="sidebar-agent-task"][data-task-id="${id}"]`);
 const projectSelector=id=>selector(`[data-testid="sidebar-project"][data-project-id="${id}"] [data-testid="sidebar-project-more"]`);
 await click(taskSelector(main));
 await app.waitFor(`document.documentElement.classList.contains(${lit(theme)})`,10000);
 await app.waitFor(visible('共用目录 · 写入队列'),10000);
 assert(await app.evaluate(visible('工作副本 · fixture-child')));
 await app.screenshot(join(out,'app-G3-委派模式.png'));
 check('App relations show both actual workspace modes and branch');

 await click(selector('.agent-change-card'));
 await app.waitFor(`document.querySelector('select[aria-label="差异回合"]')?.value==='fixture-turn-1'`,10000);
 await app.waitFor(`document.querySelector('.agent-diff-surface [role="status"]')?.innerText.includes('快照已清理')`,10000);
 await click(textButton('加载更早轮次'));
 await app.waitFor(`document.querySelector('select[aria-label="差异回合"]')?.options.length===55`,10000);
 await app.screenshot(join(out,'app-G2-第1轮差异.png'));
 check('Exact older card, reclaimed status and pagination to all 55');

 const archiveUi=async()=>{
  await click(selector('.agent-task-head [title="更多"]'));
  await click(selector('[data-testid="agent-archive"]'));
  await app.waitFor(visible('已归档'),10000);
 };
 await archiveUi();
 await click(textButton('撤销'));
 await app.waitFor(`Boolean(${taskSelector(main)})`,10000);
 await app.waitFor(`Boolean(document.querySelector('.agent-task-head [title="更多"]'))`,10000);
 assert((await app.invoke('agentTasks.list')).some(t=>t.taskId===shared));
 check('UI undo restores parent and both children');
 await archiveUi();
 const openArchive=async()=>{
  await click(selector('[data-testid="nav-settings"]'));
  await click(textButton('已归档任务'));
  await app.waitFor(`Boolean(document.querySelector('[data-testid="archived-agent-tasks"]'))`,10000);
 };
 await openArchive();
 await app.screenshot(join(out,'app-G5-归档设置.png'));
 await click(`[...document.querySelectorAll('.agent-archive-open')].find(e=>e.innerText.includes('M14 审阅任务'))`);
 await app.waitFor(`document.querySelector('[aria-label="已归档任务输入"]')?.disabled===true`,10000);
 await click(selector(`[data-child-id="${shared}"] button.agent-child-open`));
 await app.waitFor(visible('已归档子任务的历史'),10000);
 await size(950,780);
 await app.screenshot(join(out,'app-G5-窄窗只读子任务.png'));
 await click(textButton('恢复', "document.querySelector('.agent-task-head')"));
 await app.waitFor(`Boolean(document.querySelector('.agent-composer button[type=submit]'))`,10000);
 assert((await app.invoke('agentTasks.list')).some(t=>t.taskId===main));
 check('Archived project grouping, child history read-only, restore group from child');

 await click(taskSelector(main));
 await archiveUi();
 const openDelete=async project=>{
  await click(projectSelector(project.id));
  await click(selector('[data-testid="sidebar-project-delete"]'));
  await app.waitFor(`Boolean(document.querySelector('[data-slot="dialog-content"]'))`,10000);
 };
 await openDelete(blocked.project);
 await app.waitFor(visible('项目暂时无法删除'),10000);
 assert(await app.evaluate(visible('等待审批的任务')));
 assert(!(await app.evaluate(`Boolean(${textButton('删除',"document.querySelector('[data-slot=dialog-content]')")})`)));
 await app.screenshot(join(out,'app-G1-拒绝删除.png'));
 await click(textButton('取消',"document.querySelector('[data-slot=dialog-content]')"));
 await openDelete(p.project);
 await app.waitFor(visible('将删除 3 个 Agent 任务'),10000);
 assert(await app.evaluate(visible(worktreePath)));
 await app.screenshot(join(out,'app-G1-删除确认.png'));
 await click(textButton('删除',"document.querySelector('[data-slot=dialog-content]')"));
 await app.waitFor(`!${projectSelector(p.project.id)}`,10000);
 assert(!(await app.invoke('agentTasks.listArchived')).some(t=>t.taskId===main));
 assert(existsSync(worktreePath)&&existsSync(join(p.cwd,'source.txt')));
 check('Refusal is non-destructive; real confirmation deletes task group and preserves registered paths');
 assert.deepEqual(app.rendererErrors,[]);
 evidence.passed=true;
} catch(error) {
 evidence.passed=false;evidence.error=String(error.stack??error);
 if(app){try{evidence.visible=await app.evaluate('document.body.innerText');await app.screenshot(join(out,'app-failure.png'));}catch{}}
} finally {
 if(app){
  try{
   // Remove the deliberately orphaned synthetic request before normal-quit verification.
   if(blockerRecord)await app.mainEvaluate(`(()=>{
     const rq=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
     if(rq('electron').app.getPath('userData')!==${lit(userData)})throw Error('test identity changed');
     const db=new (rq('better-sqlite3'))(${lit(join(userData,'smartdd.db'))});
     try{db.prepare("UPDATE agent_requests SET status='retired' WHERE request_id=? AND task_id=?").run(${lit(blockerRecord)},${lit(blockerRecord)});}finally{db.close();}
     return true;
   })()`);
   await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${lit(userData)})throw Error('Test App identity changed');setTimeout(()=>E.app.quit(),50);return true;})()`);
   evidence.exit=await app.waitForExit(20000);
   assert.equal(evidence.exit.code,0);
  }catch(error){evidence.passed=false;evidence.exitError=String(error);}
  evidence.rendererErrors=app.rendererErrors;
  await app.close();
 }
 writeFileSync(join(out,'app-cdp.json'),JSON.stringify(evidence,null,2)+'\n');
 if(!evidence.passed)process.exitCode=1;
}

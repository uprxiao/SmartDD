import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron } from '../../../scripts/lib/electron-harness.mjs';
import { scenes, seed, sizes } from '../evidence-20261118-claude-phase1-5-s1-s2-followup/state-fixture.mjs';

const output = process.argv[2];
assert(output);
mkdirSync(output, { recursive:true });
const root = realpathSync(mkdtempSync('/private/tmp/willyou-m14-d1-d4-'));
const home = join(root, 'home'), userData = join(root, 'data'), cwd = join(root, 'workspace');
for (const dir of [home,userData,cwd]) mkdirSync(dir);
const q = JSON.stringify;
const report = { layer:'development App / work, failures and draft conflict', results:[] };
let app;
const identify = `const rq=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
 const E=rq('electron');
 if(E.app.getPath('userData')!==${q(userData)})throw Error('Test process identity changed');`;
const sql = body => app.mainEvaluate(`(()=>{
 ${identify}
 const db=new (rq('better-sqlite3'))(${q(join(userData,'smartdd.db'))});
 try{return ${body};}finally{db.close();}
})()`);
const selector = s => `document.querySelector(${q(s)})`;
const button = (s, text) => `[...${selector(s)}.querySelectorAll('button')].find(b=>b.innerText.trim()===${q(text)})`;
async function click(expr) {
  const point = `(()=>{const e=${expr};if(!e||e.disabled)return null;e.scrollIntoView({block:'nearest'});
    const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`;
  await app.waitFor(`Boolean(${point})`,8000);
  const coords = await app.evaluate(point);
  for (const type of ['mousePressed','mouseReleased'])
    await app.cdp('Input.dispatchMouseEvent',{type,...coords,button:'left',clickCount:1});
}
try {
  app = await openElectron({userData, env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude')},inspectMain:true});
  await app.invoke('agents.refreshTools');
  const tool = (await app.invoke('agents.tools')).find(t=>t.kind==='codex'&&t.installed);
  assert(tool);
  const vendor = await app.invoke('agents.saveProvider',{name:'M14 夹具',preset:'magpie',endpoints:{responses:'http://127.0.0.1:1/v1',anthropic:'http://127.0.0.1:1'},models:[{id:'fixture',name:'Fixture'}]});
  await sql(`db.prepare("UPDATE ai_providers SET models=json_set(models,'$[0].availability.codex','available') WHERE id=?").run(${q(vendor.id)})`);
  const profile=await app.invoke('agents.save',{name:'Fixture Codex',toolId:tool.id,source:'provider',providerId:vendor.id,models:['fixture'],defaultModel:'fixture',isDefault:true});
  const project=await app.invoke('projects.create',{name:'M14 状态对照',aliases:[],description:'',rulesPath:null},[{label:'workspace',path:cwd}]);
  const makeTask=async title=>(await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,profileId:profile.id,tier:'ask',title})).taskId;
  const states = ['running','approval','stopping','done','failed','message-ui'];
  const tasks=[];
  for(const scene of scenes.filter(s=>states.includes(s.id)))tasks.push({id:await makeTask(scene.name),scene,children:[]});
  const blocker=await makeTask('隔离夹具 · 待处理');
  await sql(`(${seed.toString()})(db,${q({tasks,cwd,projectId:project.id,blocker,archived:null})})`);
  const stopId=tasks.find(t=>t.scene.id==='stopping').id;
  await app.mainEvaluate(`(()=>{
    ${identify}
    const channel='agentTasks.snapshot',handler=E.ipcMain._invokeHandlers.get(channel);
    if(!handler)throw Error('Test snapshot endpoint missing');
    E.ipcMain.removeHandler(channel);
    E.ipcMain.handle(channel,async(event,taskId)=>{
      const snapshot=await handler(event,taskId);
      return taskId===${q(stopId)} ? {...snapshot,stopping:{runId:'fixture-stop',requestedAt:Date.now()-11000,forceAt:Date.now()-1000,closing:false}} : snapshot;
    });
    return true;
  })()`);
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');true");
  for (const [view,theme,width,height] of sizes) {
    await app.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await app.invoke('appSettings.update','theme',theme);
    await app.evaluate('location.reload();true');
    await app.waitFor(`document.documentElement?.classList.contains(${q(theme)}) && Boolean(document.querySelector('.reference-sidebar'))`,8000);
    for (const {id,scene} of tasks) {
      await click(selector(`[data-testid="sidebar-agent-task"][data-task-id="${id}"]`));
      await app.waitFor(`document.querySelector('.agent-task-head h1')?.innerText===${q(scene.name)}`,8000);
      if(scene.id==='message-ui'){
        if(view!=='light')continue;
        const original=await app.invoke('agentTasks.snapshot',id);
        const saved=await app.invoke('agentTasks.saveDraft',id,{text:'另一窗口保留的草稿',attachments:[]},original.draft?.revision??0);
        assert(saved.ok);
        await click(selector('.agent-composer textarea'));
        await app.cdp('Input.insertText',{text:'正在这边输入的草稿'});
        await app.waitFor("Boolean(document.querySelector('.agent-draft-conflict'))",8000);
        await app.screenshot(join(output,'light-draft-conflict.png'));
        await click(button('.agent-draft-conflict','用另一份'));
        await app.waitFor("document.querySelector('[role=dialog]')?.innerText.includes('将替换输入框中尚未保存的文字和附件')",8000);
        assert.equal(await app.evaluate("document.querySelector('.agent-composer textarea')?.value"),'正在这边输入的草稿');
        await app.waitFor("!document.getAnimations().some(a=>a.playState==='running' && a.effect?.getTiming().iterations!==Infinity)",8000);
        await app.screenshot(join(output,'light-draft-confirmation.png'));
        await click(button('[role=dialog]','确认替换'));
        await app.waitFor("document.querySelector('.agent-composer textarea')?.value==='另一窗口保留的草稿' && !document.querySelector('.agent-draft-conflict')",8000);
        report.draftConflict={originalRevision:original.draft?.revision??0,otherRevision:saved.revision,confirmedReplacement:true};
        continue;
      }
      if(scene.id==='done'){
        const work=selector('.agent-work-head[aria-expanded=false]');
        await click(work);
        await app.waitFor("Boolean(document.querySelector('.agent-work-rows > .agent-assistant'))",8000);
      }
      if(scene.id==='running'){
        await app.waitFor("document.querySelector('.agent-work-group summary')?.innerText.includes('读取了 3 个文件，运行了 1 条命令') && Boolean(document.querySelector('.agent-work-rows > .agent-assistant .agent-md'))",8000);
      }
      if(scene.id==='approval')await app.waitFor("Boolean(document.querySelector('.agent-request') && document.querySelector('.agent-work-group'))",8000);
      if(scene.id==='stopping')await app.waitFor("Boolean(document.querySelector('.agent-force-stop') && document.querySelector('.agent-turn-start'))",8000);
      if(scene.id==='failed'){
        await app.waitFor("Boolean(document.querySelector('.agent-turn-failed') && document.querySelector('.agent-unknown-result'))",8000);
        await click(selector('.agent-error-details summary'));
        assert(await app.evaluate("document.querySelector('.agent-error-details details[open] pre')?.innerText.includes('Provider 返回 500')"));
        await click(selector('.agent-error-details summary'));
      }
      await app.evaluate('document.fonts.ready.then(()=>true)');
      await app.waitFor("!document.getAnimations().some(a=>a.playState==='running' && a.effect?.getTiming().iterations!==Infinity)",8000);
      const viewport=await app.evaluate('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})');
      assert.deepEqual(viewport,{width,height,overflow:false});
      await app.screenshot(join(output,`${view}-${scene.id}.png`));
      report.results.push({view,scene:scene.id,...viewport});
    }
  }
} catch (error) {
  report.error=String(error.stack??error);
  if(app) {
    report.visible=await app.evaluate('document.body.innerText').catch(()=>null);
    await app.screenshot(join(output,'failure.png')).catch(()=>{});
  }
} finally {
  if (app) {
    try {
      await sql("db.transaction(()=>{db.prepare(\"UPDATE agent_requests SET status='retired' WHERE status='pending'\").run();db.prepare(\"UPDATE agent_turns SET status='interrupted' WHERE status IN ('accepted','dispatching','started')\").run();return true;})()");
      await app.mainEvaluate(`(()=>{${identify}setTimeout(()=>E.app.quit(),50);return true;})()`);
      report.exit=await app.waitForExit(20000);
      assert.equal(report.exit.code,0);
    } catch(error) { report.exitError=String(error); }
    report.rendererErrors=app.rendererErrors;
    await app.close();
  }
  writeFileSync(join(output,'app.json'),JSON.stringify(report,null,2)+'\n');
  if(report.error||report.exitError||report.rendererErrors?.length)process.exitCode=1;
}

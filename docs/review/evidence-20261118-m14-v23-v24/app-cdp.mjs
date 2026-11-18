import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron } from '../../../scripts/lib/electron-harness.mjs';
import { scenes, seed, sizes } from '../evidence-20261118-claude-phase1-5-s1-s2-followup/state-fixture.mjs';

const output = process.argv[2];
assert(output);
mkdirSync(output, { recursive:true });
const root = realpathSync(mkdtempSync('/private/tmp/willyou-v23-v24-'));
const home = join(root, 'home'), userData = join(root, 'data'), cwd = join(root, 'workspace');
for (const dir of [home,userData,cwd]) mkdirSync(dir);
const q = JSON.stringify;
const report = { layer:'development App / isolated mail and browser request shapes', results:[] };
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
  const project=await app.invoke('projects.create',{name:'M14 审阅对照',aliases:[],description:'',rulesPath:null},[{label:'workspace',path:cwd}]);
  const makeTask=async title=>(await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,profileId:profile.id,tier:'ask',title})).taskId;
  const tasks=[];
  for(const scene of scenes.filter(s=>['business','access'].includes(s.id)))tasks.push({id:await makeTask(scene.name),scene,children:[]});
  const browserTarget=await makeTask(tasks.find(t=>t.scene.id==='access').scene.access.target);
  const blocker=await makeTask('隔离夹具 · 待处理');
  await sql(`(${seed.toString()})(db,${q({tasks,cwd,projectId:project.id,browserTarget,blocker,archived:null})})`);
  const mailId=tasks.find(t=>t.scene.id==='business').id;
  // No real SMTP account or send intent exists. Only the isolated display receipt is supplied.
  await app.mainEvaluate(`(()=>{
    ${identify}
    const channel='agentTasks.businessReview', handler=E.ipcMain._invokeHandlers.get(channel);
    if(!handler)throw Error('Test mail review endpoint missing');
    E.ipcMain.removeHandler(channel);
    E.ipcMain.handle(channel,(event,taskId,requestId,revision)=>{
      if(taskId===${q(mailId)} && requestId===taskId+'-request' && revision===1 && event.senderFrame===event.sender.mainFrame)
        return {displayReceiptId:'6b1a7015-61d8-4cc7-96d4-c3b8585a430d'};
      return handler(event,taskId,requestId,revision);
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
      if (scene.id==='business') {
        await app.waitFor("document.querySelector('.agent-timeline .agent-mail-body')?.innerText.includes('发布测试 15 项通过') && !document.querySelector('.agent-bottom .agent-mail-review') && document.querySelectorAll('.agent-request [role=option]').length===4",8000);
      } else {
        await app.waitFor(`document.querySelector('.agent-request-head')?.innerText.includes(${q(scene.access.target)}) && document.querySelector('.agent-browser-access-pages')?.innerText.includes(${q(scene.access.pageUrl)}) && !document.querySelector('.agent-request-detail') && document.querySelectorAll('.agent-request [role=option]').length===3`,8000);
      }
      await app.evaluate('document.fonts.ready.then(()=>true)');
      await app.waitFor("!document.getAnimations().some(a=>a.playState==='running' && a.effect?.getTiming().iterations!==Infinity)",8000);
      const viewport=await app.evaluate('({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})');
      assert.deepEqual(viewport,{width,height,overflow:false});
      await app.screenshot(join(output,`${view}-${scene.id}.png`));
      report.results.push({view,scene:scene.id,...viewport});
      if (scene.id==='business') {
        await click(selector('.agent-request-options [aria-label="手动修改"]'));
        assert(await app.evaluate("document.querySelector('[aria-label=\"手动修改\"]')?.getAttribute('aria-selected')==='true'"));
        await click(selector('.agent-confirm-choice'));
        await app.waitFor("Boolean(document.querySelector('.agent-timeline .agent-mail-review textarea')) && document.querySelector('[aria-label=\"批准发送\"]')?.disabled",8000);
        await click(button('.agent-mail-review','取消修改'));
        await app.waitFor("Boolean(document.querySelector('.agent-timeline .agent-mail-body')) && !document.querySelector('[aria-label=\"批准发送\"]')?.disabled",8000);
        report.results.at(-1).manualEditOpenedAndCanceled=true;
      }
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

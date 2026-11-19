import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron } from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
import { redirectHome } from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/applications/fixtures/home-redirect-main.mjs';

const [dir,bundle,hash] = process.argv.slice(2);
assert(!process.env.DEEPSEEK_API_KEY);
const exe = realpathSync(join(bundle,'Contents/MacOS/WillYou'));
assert.equal(createHash('sha256').update(readFileSync(join(bundle,'Contents/Resources/app.asar'))).digest('hex'),hash);
mkdirSync(dir);
const root=realpathSync(mkdtempSync(join(dir,'runtime-')));
const home=join(root,'home'),userData=join(root,'data'),cwd=join(root,'work');
for (const path of [home,userData,cwd]) mkdirSync(path);
const result={exe,hash,root,mode:'real packaged history UI with private missing-event and delayed-page fixtures; actual app reopen callback exercised with non-focusing native reappearance for the owned window',clicks:[],passed:false};
let app;
const endPrivateGate = `(() => { if (globalThis.__m14HistoryGate) { const gate=globalThis.__m14HistoryGate; gate.restore(); delete globalThis.__m14HistoryGate; } return true; })()`;
const hit = async expr => {
  const pointExpr = `(() => {const e=(${expr});if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()`;
  await app.waitFor(`Boolean(${pointExpr})`,10000);
  return app.evaluate(pointExpr);
};
const fire=async point=>{for(const type of ['mousePressed','mouseReleased']) await app.cdp('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});result.clicks.push(point);};
const select=async selector=>fire(await hit(`document.querySelector(${JSON.stringify(selector)})`));
const capture=async name=>writeFileSync(join(dir,name+'.png'),Buffer.from((await app.cdp('Page.captureScreenshot',{format:'png',fromSurface:true})).data,'base64'));

try {
  app=await openElectron({executable:exe,userData,env:{HOME:home,CODEX_HOME:join(home,'.codex'),CLAUDE_CONFIG_DIR:join(home,'.claude'),TMPDIR:root},inspectMain:true,startupMainHook:info=>redirectHome({...info,home})});
  const probe=`(() => {const {app}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return{pid:process.pid,exe:process.execPath,userData:app.getPath('userData'),home:app.getPath('home'),packaged:app.isPackaged}})()`;
  result.identity=await app.mainEvaluate(probe);
  assert.deepEqual(result.identity,{pid:app.processId,exe,userData,home,packaged:true});
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.invoke('agents.refreshTools');
  const tool=(await app.invoke('agents.tools')).find(row=>row.kind==='codex'&&row.installed);
  assert(tool);
  const model='m14-history-fixture';
  const provider=await app.invoke('agents.saveProvider',{name:'Local seeded history',preset:'magpie',endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425/'},models:[{id:model,name:model}]});
  const profile=await app.invoke('agents.save',{name:'History profile',toolId:tool.id,source:'provider',providerId:provider.id,models:[model],defaultModel:model,isDefault:true});
  const project=await app.invoke('projects.create',{name:'History isolated project',aliases:[],description:'',rulesPath:null},[{label:'work',path:cwd}]);
  const task=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title:'A44 isolated history',profileId:profile.id,model,tier:'ask'});
  const other=await app.invoke('agentTasks.create',{projectId:project.id,dirId:project.dirs[0].id,cwd,title:'A44 separate task',profileId:profile.id,model,tier:'ask'});
  const taskId=task.taskId;
  assert(/^[\da-f-]{36}$/.test(taskId));
  const sql=`PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;
    WITH RECURSIVE i(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM i WHERE n<200)
    INSERT INTO agent_items(item_id,task_id,type,ordinal,payload_ref,terminal_state,created_at,updated_at)
    SELECT 'a44-history-'||n,'${taskId}','assistant_message',n,
      json_object('text',printf('A44-HISTORY-%04d %s', n, replace(hex(zeroblob(1015)),'00','xx'))),
      'completed','2026-11-19T00:00:00.000Z','2026-11-19T00:00:00.000Z' FROM i;
    COMMIT;`;
  execFileSync('/usr/bin/sqlite3',['-cmd','.timeout 4000',join(userData,'smartdd.db')],{input:sql});
  const snap=await app.invoke('agentTasks.snapshot',taskId);
  assert(snap.hasOlder&&snap.items.length<200&&snap.items.length>0);
  const firstOrdinal=snap.items[0].ordinal;
  result.firstOrdinal=firstOrdinal;
  const expectedMarker='A44-HISTORY-'+String(firstOrdinal-1).padStart(4,'0');
  await select('[data-testid=nav-settings]');
  await select('[data-testid=m14-toggle]');
  await app.waitFor(`document.querySelector('[data-testid=m14-toggle]')?.innerText.includes('已开启')`,12000);
  await select('[data-testid=nav-home]');
  await select('[data-testid="sidebar-agent-task"][data-task-id="'+taskId+'"]');
  await app.mainEvaluate(`(() => {
    const electron = process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    if(electron.app.getPath('userData')!==${JSON.stringify(userData)} || process.execPath!==${JSON.stringify(exe)})throw Error('wrong fixture identity');
    const windows=electron.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().startsWith('file:'));
    if(windows.length!==1)throw Error('expected only the owned packaged window');
    const window=windows[0], handlers=electron.ipcMain._invokeHandlers, taskId=${JSON.stringify(taskId)};
    const reads=[], held=[], originals=new Map(), native=[];
    const wc=window.webContents, originalSend=wc.send;
    const listeners=['show','hide','restore','minimize','focus','blur'].map(name=>{
      const listener=()=>native.push([name,window.isVisible(),window.isFocused()]);
      window.on(name,listener); return [name,listener];
    });
    wc.send=function(channel,...data){
      if(channel==='window:shown')native.push(['window:shown sent',window.isVisible(),window.isFocused()]);
      return originalSend.call(this,channel,...data);
    };
    const control={ reads, held, window, taskId, holdHistory:false, native };
    for(const name of ['agentTasks.events','agentTasks.snapshot','agentTasks.historyItems','agentTasks.history']) {
      const original=handlers.get(name);
      if(typeof original!=='function')throw Error('missing production handler '+name);
      originals.set(name,original);
      handlers.set(name,function(event,...args){
        if(args[0]!==taskId || event.sender.id!==window.webContents.id) return original.call(this,event,...args);
        reads.push([name,...args.slice(1)]);
        if(name==='agentTasks.history' && control.holdHistory) {
          control.holdHistory=false;
          const value=original.call(this,event,...args);
          return new Promise(resolve=>held.push(()=>resolve(value)));
        }
        return original.call(this,event,...args);
      });
    }
    globalThis.__m14HistoryGate={...control, control, restore(){for(const [name,original] of originals) handlers.set(name,original);for(const resume of held.splice(0))resume();for(const [name,listener] of listeners)window.off(name,listener);wc.send=originalSend;if(!window.isVisible())window.showInactive();}};
    return {windowId:window.id,senderId:window.webContents.id};
  })()`);
  const loadOlder=`[...document.querySelectorAll('button.agent-older')].find(button=>button.textContent.trim()==='加载更早的记录')`;
  await app.waitFor(`!!(${loadOlder})`,10000);
  await fire(await hit(loadOlder));
  const visible = (str) => `document.querySelector('.agent-task-view')?.innerText.includes(${JSON.stringify(str)})`;
  await app.waitFor(visible(expectedMarker),10000);
  const db=join(userData,'smartdd.db'), itemId='a44-history-'+(firstOrdinal-1);
  let seq=(await app.invoke('agentTasks.snapshot',taskId)).seq;
  const trackedBase=seq;
  const commitFixture = (text, gap, trailing) => {
    assert(/^[A-Z0-9_ ]+$/.test(text));
    const update=seq+gap+1;
    seq=update+(trailing?1:0);
    const at='2026-11-19T00:00:00.000Z';
    const stmt=`PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;
      UPDATE agent_items SET payload_ref=json_object('text','${text}'),revision=revision+1 WHERE task_id='${taskId}' AND item_id='${itemId}';
      INSERT INTO agent_events(task_id,seq,event_type,item_id,revision,payload,created_at)
      SELECT '${taskId}',${update},'item.updated','${itemId}',revision,'{}','${at}' FROM agent_items WHERE item_id='${itemId}';
      ${trailing?`INSERT INTO agent_events(task_id,seq,event_type,payload,created_at) VALUES('${taskId}',${seq},'selection.changed','{}','${at}');`:''}
      COMMIT;`;
    execFileSync('/usr/bin/sqlite3',['-cmd','.timeout 4000',db],{input:stmt});
    return {taskId,seq,type:trailing?'selection.changed':'item.updated',itemId:trailing?null:itemId,payload:{}};
  };
  const sendEvent=ev=>app.mainEvaluate(`(() => {const gate=globalThis.__m14HistoryGate;if(!gate||gate.taskId!==${JSON.stringify(taskId)})throw Error('wrong fixture journal');gate.window.webContents.send('agentTasks:event',${JSON.stringify(ev)});return true;})()`);
  const readLog = () => app.mainEvaluate(`(() => globalThis.__m14HistoryGate.reads.slice())()`);
  const gapEvent=commitFixture('A44 RECOVERED MISSING UPDATE',0,true);
  await sendEvent(gapEvent);
  await app.waitFor(visible('A44 RECOVERED MISSING UPDATE'),10000);
  result.gap = (await readLog()).filter(entry=>entry[0]==='agentTasks.events');
  assert(result.gap.some(entry=>entry[1]===trackedBase&&entry[2]===gapEvent.seq));
  assert((await readLog()).some(entry=>entry[0]==='agentTasks.historyItems'&&entry[1].includes(itemId)));
  const beforeDuplicate=(await readLog()).length;
  await sendEvent(gapEvent);
  await new Promise(resolve=>setTimeout(resolve,175));
  assert.equal((await readLog()).length,beforeDuplicate,'a duplicate notification must not reload');
  result.duplicateIgnored=true;
  await capture('01-recovered-gap');
  await app.evaluate(`(() => {globalThis.__m14ObservedShown=0;window.electronAPI.eventOn('window:shown',()=>globalThis.__m14ObservedShown+=1);return true;})()`);
  assert.equal(await app.mainEvaluate(`(() => {const w=globalThis.__m14HistoryGate.window;w.hide();return w.isVisible();})()`), false);
  result.hiddenRendererVisibility = await app.evaluate('document.visibilityState');
  const lostTail = commitFixture('A44 RECOVERED TAIL AFTER RESTORE',0,false);
  result.unsentTailSeq = lostTail.seq;
  assert(!await app.evaluate(visible('A44 RECOVERED TAIL AFTER RESTORE')));
  result.reopen = await app.mainEvaluate(`(() => {
    const gate=globalThis.__m14HistoryGate, w=gate.window;
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    if(E.app.getPath('userData')!==${JSON.stringify(userData)}||w.isVisible())throw Error('Expected exact hidden acceptance window');
    const original=w.show, focusedBefore=w.isFocused();
    let calls=0;
    w.show=function(){calls++;this.showInactive();};
    try {E.app.emit('activate',{},false);}
    finally {w.show=original;}
    return {calls,visible:w.isVisible(),focusedBefore,focusedAfter:w.isFocused()};
  })()`);
  assert.deepEqual(result.reopen,{calls:1,visible:true,focusedBefore:false,focusedAfter:false});
  result.shownRendererVisibility = await app.evaluate('document.visibilityState');
  await app.waitFor(visible('A44 RECOVERED TAIL AFTER RESTORE'),12000);
  result.recoveredWithoutPush=true;
  await capture('02-restored-tail');
  const cropped=commitFixture('A44 CORRECT AFTER CROPPED HISTORY',2,false);
  await sendEvent(cropped);
  await app.waitFor(`!${visible('A44 RECOVERED TAIL AFTER RESTORE')} && !!(${loadOlder})`,10000);
  await fire(await hit(loadOlder));
  await app.waitFor(visible('A44 CORRECT AFTER CROPPED HISTORY'),10000);
  result.authoritativeAfterCrop=true;
  await capture('03-after-pruned-sequence');
  await select('[data-testid="sidebar-agent-task"][data-task-id="'+other.taskId+'"]');
  await app.waitFor(visible('A44 separate task'),12000);
  await select('[data-testid="sidebar-agent-task"][data-task-id="'+taskId+'"]');
  await app.waitFor(`!!(${loadOlder})`,12000);
  await app.mainEvaluate(`(() => {globalThis.__m14HistoryGate.control.holdHistory=true;return true;})()`);
  await fire(await hit(loadOlder));
  const waitUntil=Date.now()+5000;
  while (!await app.mainEvaluate(`Boolean(globalThis.__m14HistoryGate.held.length)`)) {
    assert(Date.now()<waitUntil,'the actual old task page response was delayed');
    await new Promise(resolve=>setTimeout(resolve,35));
  }
  await select('[data-testid="sidebar-agent-task"][data-task-id="'+other.taskId+'"]');
  await app.waitFor(visible('A44 separate task'),12000);
  await app.mainEvaluate(`(() => {for(const resume of globalThis.__m14HistoryGate.held.splice(0))resume();return true;})()`);
  await new Promise(resolve=>setTimeout(resolve,175));
  assert(!await app.evaluate(visible('A44 CORRECT AFTER CROPPED HISTORY')));
  result.lateOldPageIgnored=true;
  result.reads=await readLog();
  await capture('04-old-page-does-not-leak');
  const afterDisconnect = commitFixture('A44 RECOVERED AFTER PAGE RECONNECT',0,false);
  result.disconnectedSeq = afterDisconnect.seq;
  await app.cdp('Page.reload');
  const reopenedTaskSelector = '[data-testid="sidebar-agent-task"][data-task-id="'+taskId+'"]';
  await app.waitFor(`!globalThis.__m14ObservedShown && !!document.querySelector(${JSON.stringify(reopenedTaskSelector)})`,12000);
  await select(reopenedTaskSelector);
  await app.waitFor(`!!(${loadOlder})`,12000);
  await fire(await hit(loadOlder));
  await app.waitFor(visible('A44 RECOVERED AFTER PAGE RECONNECT'),12000);
  result.reconnected=true;
  await capture('05-reconnected');
  assert.deepEqual(app.rendererErrors,[]);
  result.passed=true;
} catch (error) {
  result.error=String(error?.stack??error);
  if(app) try {await capture('failure');} catch {}
} finally {
  if (app) {
    try {
      result.native = await app.mainEvaluate(`globalThis.__m14HistoryGate?.native`);
      result.observedShown = await app.evaluate('globalThis.__m14ObservedShown');
      result.reads = await app.mainEvaluate(`globalThis.__m14HistoryGate?.reads`);
    } catch {}
    try {await app.mainEvaluate(endPrivateGate);} catch {}
    try {
      await app.mainEvaluate(`(() => {const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');setTimeout(()=>E.app.quit(),50);return true})()`);
      result.exit=await app.waitForExit(20000);
    } catch (error) {result.exitError=String(error);await app.crash();}
    result.rendererErrors=app.rendererErrors;
  }
  writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));
}
if (!result.passed || result.exit?.code!==0 || result.exit?.signal || result.exitError) process.exitCode=1;

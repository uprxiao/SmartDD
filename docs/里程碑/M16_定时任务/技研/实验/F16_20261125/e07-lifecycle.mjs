// Actual isolated Electron window/host lifecycle proof, not a packaged WillYou.
// The calendar/ledger are experimental; powerMonitor resume below is injected, not OS sleep.
import {app,BrowserWindow,powerMonitor,screen} from 'electron';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {LedgerCandidate,CandidateScheduler} from './ledger-candidate.mjs';
const [phase,root] = process.argv.slice(-2);
if(!['first','reopen'].includes(phase)||!root?.startsWith('/private/tmp/willyou-f16-'))throw Error('Explicit isolated test root required');
mkdirSync(join(root,'profile'),{recursive:true});
app.setName('WillYou F16 lifecycle experiment');
app.setPath('userData',join(root,'profile'));
app.disableHardwareAcceleration();
const log=(event,fields={})=>console.log(JSON.stringify({event,phase,at:Date.now(),...fields}));
let ledger,scheduler,win,quitting=false;
function plan(id,ms,grace=60){
  return ledger.create({id,schedule:{type:'once',onceAt:Date.now()+ms,zone:'UTC'},grace},Date.now());
}
async function until(predicate,label,timeout=5000){
  const start=Date.now();
  while(!predicate()){if(Date.now()-start>timeout)throw Error('Timed out: '+label);await delay(12)}
}
async function stable(predicate,label,stableMs=350,timeout=5000){
  const start=Date.now();let since=null;
  while(Date.now()-start<timeout){
    if(predicate()){since??=Date.now();if(Date.now()-since>=stableMs)return;}
    else since=null;
    await delay(15);
  }
  throw Error('Timed out waiting for stable '+label);
}
function status(id){return ledger.history(id)[0]?.status;}
function view(){
  return {visible:win?.isVisible()??false,minimized:win?.isMinimized()??false,focused:win?.isFocused()??false};
}
app.on('before-quit',()=>{
  quitting=true;scheduler?.stop();log('actual-before-quit',{timer:scheduler?.timer===null});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('will-quit',()=>{
  log('actual-will-quit',{nextDue:ledger?.nextDue()});
  if(ledger?.db.open)ledger.close();
});
app.whenReady().then(async()=>{
  assert.equal(process.platform,'darwin');
  ledger=new LedgerCandidate(join(root,'lifecycle.sqlite3'));
  const display=screen.getAllDisplays().find(d=>d.id!==screen.getPrimaryDisplay().id)??screen.getPrimaryDisplay();
  win=new BrowserWindow({show:false,width:330,height:160,x:display.workArea.x+20,y:display.workArea.y+40,
    title:'F16 试验 · 合成 · 安全隔离',focusable:false,skipTaskbar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadURL('data:text/html,<title>F16 synthetic experiment</title><p>F16 isolated lifecycle test</p>');
  win.on('close',event=>{
    if(quitting)return;
    event.preventDefault();win.hide();log('actual-close-event-hidden',view());
  });
  let error=null;
  scheduler=new CandidateScheduler(ledger,r=>{
    ledger.begin(r.id,Date.now());
    ledger.accepted(r.id,{taskId:r.task_id,inputId:r.input_id});
    ledger.finish(r.id,'completed',Date.now());
    log('dispatch',{id:r.plan_id,lagMs:Date.now()-r.due,...view()});
  },{recheckMs:100,onError:e=>{error=e;log('scheduler-error',{message:e.message})}});
  powerMonitor.on('resume',()=>{log('resume-hook');scheduler.tick('resume')});
  log('runtime',{electron:process.versions.electron,node:process.versions.node,displayCount:screen.getAllDisplays().length,backgroundFocus:win.isFocused()});
  if(phase==='first'){
    assert.equal(win.isVisible(),false);
    plan('hidden',180);scheduler.start();await until(()=>status('hidden')==='completed','hidden dispatch');
    assert.equal(win.isVisible(),false);
    win.showInactive();await until(()=>win.isVisible(),'shown without activation');
    win.minimize();await until(()=>win.isMinimized(),'actual minimize');
    plan('minimized',180);scheduler.tick();
    await until(()=>status('minimized')==='completed','minimized dispatch');assert.equal(win.isMinimized(),true);
    win.restore();win.showInactive();await stable(()=>!win.isMinimized()&&win.isVisible(),'restore animation complete');
    win.close();await stable(()=>!win.isVisible(),'close hides');
    assert.equal(win.isDestroyed(),false);
    plan('close-hidden',180);scheduler.tick();await until(()=>status('close-hidden')==='completed','close hides dispatch');
    assert.equal(win.isVisible(),false);
    // Simulate no scheduler time while asleep (we do not suspend the computer).
    scheduler.stop();plan('wake-within',60,10);plan('wake-outside',60,0);
    await delay(130);scheduler.active=true;powerMonitor.emit('resume'); // actual handler, synthetic event
    await until(()=>status('wake-within')==='completed'&&status('wake-outside')==='skipped','resume grace');
    assert.equal(ledger.history('wake-outside')[0].reason,'missed_grace');
    log('synthetic-wake-grace-pass',{within:status('wake-within'),outside:status('wake-outside')});
    // Must not run until reopening. Give the app ample time to exit before due.
    plan('reopen-within',1700,60);plan('reopen-outside',1700,0);scheduler.tick();
    assert.equal(status('reopen-within'),undefined);
  }else{
    // The launcher starts after both deadlines and proves no effects occurred while closed.
    const before=ledger.plan('reopen-within');
    assert.ok(Date.now()>before.next_due);
    assert.equal(status('reopen-within'),undefined);
    assert.equal(status('reopen-outside'),undefined);
    scheduler.start();
    await until(()=>status('reopen-within')==='completed'&&status('reopen-outside')==='skipped','app reopen grace');
    assert.equal(ledger.history('reopen-within').length,1);
    assert.equal(ledger.history('reopen-outside').length,1);
    log('actual-reopen-pass',{within:status('reopen-within'),outside:status('reopen-outside')});
  }
  if(error)throw error;
  assert.equal(win.isFocused(),false);
  log('phase-pass');app.quit();
}).catch(e=>{log('test-failure',{message:e.message,stack:e.stack});scheduler?.stop();app.exit(1)});

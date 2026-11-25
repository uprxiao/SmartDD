import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {LedgerCandidate,CandidateScheduler} from './ledger-candidate.mjs';

const MIN=60000, T=Date.parse('2026-11-25T08:00:00Z');
const interval={type:'interval',minutes:1,zone:'UTC'};
const once=at=>({type:'once',onceAt:at,zone:'UTC'});
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'f16-ledger-')), file=join(root,'ledger.sqlite3');
  let l=new LedgerCandidate(file);
  t.after(()=>{try{l.close()}catch{};rmSync(root,{recursive:true,force:true})});
  return {get l(){return l},file,reopen(){l.close();l=new LedgerCandidate(file);return l}};
}
function make(l,id,options={},now=T){return l.create({id,schedule:interval,...options},now)}
function run(l,id,now=T+MIN,options={}){return l.claim(id,{now,...options})}
function end(l,r,now=T+MIN+1,status='completed'){if(status==='completed'){l.begin(r.id,now);l.accepted(r.id,{taskId:r.task_id,inputId:r.input_id,turnId:'turn-'+r.id});}return l.finish(r.id,status,now)}
function worker(file,mode,id,now,runId=''){
  const entry=new URL('./ledger-worker.mjs',import.meta.url).pathname;
  return new Promise((resolve,reject)=>{
    const proc=spawn(process.execPath,[decodeURIComponent(entry),file,mode,id,String(now),runId],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});
    let out='',err='';proc.stdout.on('data',x=>out+=x);proc.stderr.on('data',x=>err+=x);
    const timer=setTimeout(()=>proc.kill('SIGTERM'),10000);
    proc.once('error',e=>{clearTimeout(timer);reject(e)});
    proc.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('worker '+code+' '+err));else try{resolve(JSON.parse(out))}catch(e){reject(Error(out+' '+err+' '+e.message))}});
  })
}

test('E02 persistence, foreign-key/transaction and untouched existing table across restart',t=>{
  const f=fixture(t),l=f.l;
  l.db.exec("CREATE TABLE prior_tasks(id TEXT PRIMARY KEY,note TEXT); INSERT INTO prior_tasks VALUES('existing','unmodified')");
  const p=make(l,'p',{config:{agent:'codex',profile:'p1',model:'m1',prompt:'original'}});
  assert.equal(p.next_due,T+MIN);assert.equal(p.revision,1);
  const c=run(l,'p');assert.equal(c.kind,'claimed');
  const reopen=f.reopen(), persisted=reopen.run(c.run.id);
  assert.deepEqual(persisted,c.run);
  assert.equal(reopen.plan('p').next_due,T+2*MIN);
  assert.deepEqual(reopen.db.prepare('SELECT * FROM prior_tasks').all(),[{id:'existing',note:'unmodified'}]);
  assert.equal(reopen.db.pragma('integrity_check',{simple:true}),'ok');
  assert.throws(()=>reopen.db.prepare('DELETE FROM plans WHERE id=?').run('p'),/FOREIGN KEY/);
  end(reopen,persisted);
  assert.equal(reopen.history('p')[0].status,'completed');
});
test('E02 edit revision CAS and historical frozen configuration',t=>{
  const {l}=fixture(t);const p=make(l,'p',{config:{prompt:'old'},destination:'reuse'});
  const first=run(l,'p').run;
  const edited=l.edit('p',p.revision,{config:{prompt:'new'},grace:10},T+MIN);
  assert.equal(edited.revision,2);assert.equal(l.run(first.id).snapshot.config.prompt,'old');
  assert.equal(edited.bound_task,first.task_id);assert.equal(edited.next_due,T+2*MIN);
  assert.throws(()=>l.edit('p',1,{config:{}},T+MIN),/Stale/);
  assert.throws(()=>l.edit('p',2,{grace:5},T+MIN),/Invalid grace/);
  assert.equal(run(l,'p',T+2*MIN,{expected:1}).kind,'stale');
  end(l,first);const second=run(l,'p',T+2*MIN).run;
  assert.equal(second.snapshot.config.prompt,'new');assert.equal(second.task_id,first.task_id);
  assert.notEqual(second.input_id,first.input_id);end(l,second);
});
test('E02 pause/manual/resume and deleted plan preserves active record',t=>{
  const {l}=fixture(t);let p=make(l,'p');
  p=l.setEnabled('p',p.revision,false,T+100);assert.equal(p.next_due,null);
  assert.equal(run(l,'p',T+2*MIN).kind,'not_due');
  const c=run(l,'p',T+2*MIN,{trigger:'manual',requestId:'button-1'});assert.equal(c.kind,'claimed');
  assert.equal(l.plan('p').next_due,null);
  p=l.setEnabled('p',p.revision,true,T+2*MIN+200);
  assert.equal(p.next_due,T+3*MIN);
  p=l.remove('p',p.revision);assert.equal(p.archived,1);assert.equal(p.next_due,null);
  assert.equal(run(l,'p',T+3*MIN,{trigger:'manual',requestId:'button-2'}).kind,'unavailable');
  end(l,c.run,T+2*MIN+400);
  assert.deepEqual(l.history('p').map(x=>x.status),['completed']);
});
test('E02 once early manual does not consume schedule; ended remains manually runnable and can be redated',t=>{
  const {l}=fixture(t);const p=make(l,'p',{schedule:once(T+MIN)});
  const early=run(l,'p',T+100,{trigger:'manual',requestId:'early'}).run;end(l,early,T+200);
  assert.equal(l.plan('p').ended,0);assert.equal(l.plan('p').next_due,T+MIN);
  const c=run(l,'p').run;end(l,c,T+MIN+1,'failed');const ended=l.plan('p');
  assert.equal(ended.ended,1);assert.equal(ended.enabled,0);assert.equal(ended.next_due,null);
  assert.throws(()=>l.setEnabled('p',ended.revision,true,T+2*MIN),/Ended/);
  const after=run(l,'p',T+2*MIN,{trigger:'manual',requestId:'ended'}).run;end(l,after,T+2*MIN+1);
  const edited=l.edit('p',ended.revision,{schedule:once(T+4*MIN)},T+3*MIN);
  assert.equal(edited.ended,0);assert.equal(l.setEnabled('p',edited.revision,true,T+3*MIN).next_due,T+4*MIN);
  assert.equal(l.history('p').length,3);
});
test('E02 local wall-slot not replayed after time-zone change; fixed/once/interval not rebased',t=>{
  const old=process.env.TZ;t.after(()=>{if(old===undefined)delete process.env.TZ;else process.env.TZ=old});
  process.env.TZ='UTC';const {l}=fixture(t);const time='09:00', day={type:'daily',time,zone:''};
  const p=make(l,'local',{schedule:day});make(l,'fixed',{schedule:{...day,zone:'UTC'}});
  make(l,'once',{schedule:once(T+MIN)});make(l,'interval');
  const first=run(l,'local',T+60*MIN).run;end(l,first,T+60*MIN+1);
  const before=Object.fromEntries(['fixed','once','interval'].map(x=>[x,l.plan(x).next_due]));
  process.env.TZ='America/New_York';
  assert.equal(l.reconcileZones(T+60*MIN+1),1);
  assert.equal(l.plan('local').next_due,Date.parse('2026-11-26T14:00:00Z'));
  assert.equal(run(l,'local',Date.parse('2026-11-25T14:00:00Z')).kind,'not_due');
  assert.equal(l.history('local').length,1);
  for(const [id,due] of Object.entries(before))assert.equal(l.plan(id).next_due,due);
});
test('E02 due query index; 2000 paused, 200 active real SQLite rows',t=>{
  const {l}=fixture(t);
  l.tx(()=>{for(let i=0;i<2200;i++)make(l,'p'+i,{enabled:i<200});});
  const explain=l.db.prepare('EXPLAIN QUERY PLAN SELECT id,revision FROM plans WHERE enabled=1 AND archived=0 AND ended=0 AND next_due<=?').all(T+MIN);
  assert.ok(explain.some(x=>x.detail.includes('due_plan')),JSON.stringify(explain));
  const elapsed=[];for(let i=0;i<100;i++){const start=performance.now();assert.equal(l.duePlans(T).length,0);assert.equal(l.nextDue(),T+MIN);elapsed.push(performance.now()-start)}
  elapsed.sort((a,b)=>a-b);console.log('SQLite due index rows=2200 p95 ms',elapsed[94].toFixed(3),explain.map(x=>x.detail).join(';'));
  assert.equal(l.duePlans(T+MIN).length,200);
});
test('E08 same occurrence atomic across two actual worker processes',async t=>{
  const f=fixture(t);make(f.l,'p');
  const results=await Promise.all([worker(f.file,'claim','p',T+MIN),worker(f.file,'claim','p',T+MIN)]);
  assert.deepEqual(results.map(x=>x.kind).sort(),['claimed','not_due']);
  assert.equal(f.l.history('p').length,1);
  assert.equal(f.l.history('p')[0].input_id,results.find(x=>x.kind==='claimed').run.input_id);
  console.log('two process claims',results.map(x=>x.kind).join(','));
});
test('E08 same plan and same bound task skips; separate plans can be active together',t=>{
  const {l}=fixture(t);make(l,'p',{destination:'existing',boundTask:'task-shared'});make(l,'q',{destination:'existing',boundTask:'task-shared'});make(l,'r');
  const p=run(l,'p'),q=run(l,'q'),r=run(l,'r');
  assert.equal(p.kind,'claimed');assert.equal(q.run.reason,'task_busy');assert.equal(r.kind,'claimed');
  assert.notEqual(p.run.task_id,r.run.task_id);
  assert.equal(run(l,'p',T+2*MIN).run.reason,'plan_busy');
  assert.equal(run(l,'p',T+2*MIN,{trigger:'manual',requestId:'busy'}).kind,'busy');
  end(l,p.run);const third=run(l,'q',T+2*MIN);assert.equal(third.kind,'claimed');end(l,third.run);end(l,r.run);
  assert.equal(l.history('p').length,2);
});
test('E08 host busy observation causes skipped occurrence; manual request ID replay is idempotent',t=>{
  const {l}=fixture(t);make(l,'p',{destination:'existing',boundTask:'busy-task'});
  assert.equal(run(l,'p',T+MIN,{hostBusy:true}).run.reason,'task_busy');
  const m=run(l,'p',T+2*MIN,{trigger:'manual',requestId:'same'});assert.equal(m.kind,'claimed');
  assert.equal(run(l,'p',T+2*MIN+2,{trigger:'manual',requestId:'same'}).run.id,m.run.id);
  end(l,m.run);assert.equal(run(l,'p',T+2*MIN+5,{trigger:'manual',requestId:'same'}).kind,'duplicate');
  assert.equal(l.history('p').length,2);
});
test('E08 wake coalesces to latest missed occurrence, preserves missed range and grace',t=>{
  const {l}=fixture(t);
  for(const grace of [0,10,60,720]){
    const id='g'+grace;make(l,id,{grace,schedule:{type:'daily',time:'08:01',zone:'UTC'}});
    const now=T+2*24*60*MIN+12*MIN;const c=run(l,id,now,{reason:'resume'});
    assert.equal(c.run.due,T+2*24*60*MIN+MIN);assert.equal(c.run.missed_from,T+MIN);
    assert.equal(c.kind,grace<11?'skipped':'claimed');assert.equal(l.history(id).length,1);
    assert.equal(l.plan(id).next_due,T+3*24*60*MIN+MIN);
    if(c.kind==='claimed')end(l,c.run,now+1);
  }
  make(l,'once',{schedule:once(T+MIN),grace:0});
  assert.equal(run(l,'once',T+MIN+10,{reason:'resume'}).kind,'skipped');assert.equal(l.plan('once').ended,1);
});
test('E08 crash after independent host receipt; reconcile exact immutable receipt without another effect',async t=>{
  const f=fixture(t);make(f.l,'p');const c=run(f.l,'p').run;
  const result=await worker(f.file,'receipt','p',T+MIN+1,c.id);
  assert.equal(result.committed,true);
  const l=f.reopen();assert.equal(l.run(c.id).status,'dispatching');
  const receipt=l.db.prepare('SELECT * FROM synthetic_receipts WHERE input_id=?').get(c.input_id);
  assert.throws(()=>l.recover(c.id,{receipt:{inputId:'wrong',taskId:c.task_id}},T+MIN+2),/identity/);
  const recovered=l.recover(c.id,{receipt:{inputId:receipt.input_id,taskId:receipt.task_id,turnId:receipt.turn_id}},T+MIN+2);
  assert.equal(recovered.status,'running');assert.equal(recovered.attempts,1);
  l.finish(c.id,'completed',T+MIN+3);
  assert.equal(l.db.prepare('SELECT COUNT(*) count FROM synthetic_receipts').get().count,1);
});
test('E08 crash before acceptance proof goes unknown, not retry; later explicit no-effect proof allows one retry',async t=>{
  const f=fixture(t);make(f.l,'p');const c=run(f.l,'p').run;
  assert.equal((await worker(f.file,'before-proof','p',T+MIN+1,c.id)).committed,false);
  const l=f.reopen();assert.equal(l.recover(c.id,null,T+MIN+2).status,'unknown');
  assert.equal(run(l,'p',T+MIN+3,{trigger:'manual',requestId:'blocked'}).kind,'busy');
  let proof=l.recover(c.id,{unsubmitted:true},T+MIN+4);assert.equal(proof.status,'claimed');assert.equal(proof.input_id,c.input_id);
  l.begin(c.id,T+MIN+5);
  proof=l.recover(c.id,{unsubmitted:true},T+MIN+6);
  assert.equal(proof.status,'failed');assert.equal(proof.attempts,2);
  const manual=run(l,'p',T+MIN+7,{trigger:'manual',requestId:'retry'}).run;
  assert.notEqual(manual.id,c.id);assert.notEqual(manual.input_id,c.input_id);
  l.begin(manual.id,T+MIN+8);l.accepted(manual.id,{inputId:manual.input_id,taskId:manual.task_id});
  l.wait(manual.id);l.finish(manual.id,'stopped',T+MIN+9);
  assert.throws(()=>l.recover(manual.id,{unsubmitted:true},T+MIN+10),/Cannot recover/);
});
test('E08 accepted partially failed is not replayed; retry outside original grace rejected',t=>{
  const {l}=fixture(t);make(l,'p',{grace:10});let c=run(l,'p').run;
  l.begin(c.id,T+MIN+1);l.accepted(c.id,{inputId:c.input_id,taskId:c.task_id});l.finish(c.id,'failed',T+MIN+2,'partial');
  assert.throws(()=>l.recover(c.id,{unsubmitted:true},T+MIN+3),/Cannot recover/);
  const p=make(l,'q',{grace:10});c=run(l,p.id).run;l.begin(c.id,T+MIN+1);
  assert.equal(l.recover(c.id,{unsubmitted:true},T+12*MIN).status,'failed');
});
test('E08 due timer dispatches independent plans while another is slow, no empty polling and shutdown stops new dispatch',async t=>{
  const {l}=fixture(t);const start=Date.now(), due=start+160;
  for(const id of ['slow','fast','other'])make(l,id,{schedule:once(due)},start);
  const dispatches=[],errors=[];let release;
  const gate=new Promise(r=>{release=r});
  const scheduler=new CandidateScheduler(l,async r=>{
    dispatches.push({id:r.plan_id,delay:Date.now()-r.due});
    l.begin(r.id,Date.now());l.accepted(r.id,{inputId:r.input_id,taskId:r.task_id});
    if(r.plan_id==='slow')await gate;
    l.finish(r.id,'completed',Date.now());
  },{recheckMs:40,onError:e=>errors.push(e.message)});
  t.after(()=>{scheduler.stop();release()});
  scheduler.start();let deadline=Date.now()+5000;
  while(dispatches.length<3&&Date.now()<deadline)await delay(12);
  assert.equal(dispatches.length,3);assert.deepEqual(errors,[]);
  assert.equal(l.history('slow')[0].status,'running');
  assert.equal(l.history('fast')[0].status,'completed');assert.equal(l.history('other')[0].status,'completed');
  assert.ok(dispatches.every(x=>x.delay>=0&&x.delay<=5000),JSON.stringify(dispatches));
  console.log('real timer due-to-dispatch ms',JSON.stringify(dispatches));
  const scans=scheduler.scans;await delay(150);assert.equal(scheduler.scans,scans);assert.equal(scheduler.timer,null);
  release();await Promise.all([...scheduler.inflight]);assert.equal(l.history('slow')[0].status,'completed');
  const future=Date.now()+120;make(l,'stop',{schedule:once(future)},Date.now());scheduler.tick();scheduler.stop();await delay(155);assert.equal(l.history('stop').length,0);
});
test('E02 display timezone change does not reset interval anchor and archived duplicate receipt is stable',t=>{
 const {l}=fixture(t);const p=make(l,'p');
 const edited=l.edit('p',p.revision,{schedule:{...interval,zone:'Asia/Shanghai'}},T+10);
 assert.equal(edited.schedule.anchor,T);assert.equal(edited.next_due,T+MIN);
 const first=run(l,'p',T+100,{trigger:'manual',requestId:'retained'}).run;end(l,first,T+101);
 l.remove('p',edited.revision);assert.equal(run(l,'p',T+102,{trigger:'manual',requestId:'retained'}).run.id,first.id);
});
test('E08 restore with zero grace cannot claim abandoned or repeat unsubmitted occurrence after deadline',t=>{
 const {l}=fixture(t);make(l,'p',{grace:0});make(l,'q',{grace:0});make(l,'r',{grace:0});
 const a=run(l,'p').run,b=run(l,'q').run,c=run(l,'r').run;
 assert.equal(l.recover(a.id,null,T+MIN+1).status,'skipped');
 l.begin(b.id,T+MIN);assert.equal(l.recover(b.id,{unsubmitted:true},T+MIN+1).status,'failed');
 l.begin(c.id,T+MIN);assert.equal(l.recover(c.id,{unsubmitted:true},T+MIN+1,{reason:'tick'}).status,'claimed');
});
test('E08 isolated plan gate: edit/pause/delete before actual acceptance skips old occurrence; accepted snapshot remains',t=>{
 const {l}=fixture(t);
 for(const op of ['edit','pause','delete']){
   const p=make(l,op),c=run(l,op).run;l.begin(c.id,T+MIN);
   if(op==='edit')l.edit(op,p.revision,{config:{prompt:'changed'}},T+MIN+1);
   if(op==='pause')l.setEnabled(op,p.revision,false,T+MIN+1);
   if(op==='delete')l.remove(op,p.revision);
   const check=l.checkBeforeAccept(c.id,T+MIN+2);assert.equal(check.ok,false);assert.equal(check.run.status,'skipped');assert.equal(check.run.receipt,null);
 }
 const p=make(l,'accepted'),c=run(l,p.id).run;l.begin(c.id,T+MIN);assert.ok(l.checkBeforeAccept(c.id,T+MIN).ok);
 l.accepted(c.id,{inputId:c.input_id,taskId:c.task_id});l.remove(p.id,p.revision);
 assert.equal(l.finish(c.id,'completed',T+MIN+1).status,'completed');
 const paused=make(l,'paused',{enabled:false});const manual=run(l,paused.id,T+MIN,{trigger:'manual',requestId:'manual'}).run;l.begin(manual.id,T+MIN);
 assert.equal(l.checkBeforeAccept(manual.id,T+MIN).ok,true);
});

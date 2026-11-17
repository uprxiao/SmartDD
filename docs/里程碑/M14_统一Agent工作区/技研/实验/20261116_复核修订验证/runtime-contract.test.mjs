import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,symlinkSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {capability,turnParams,resolveTier,TIERS,PendingStop,DirectoryQueue,applyEvents} from './runtime-contract.mjs';
import {normalizer} from './timeline.mjs';
const tests=[],check=(id,fn)=>{try{fn();tests.push({id,status:'passed'});}catch(e){tests.push({id,status:'failed',error:e.message});}};
const root=mkdtempSync(join(tmpdir(),'m14-contract-')),cwd=join(root,'wc'),alias=join(root,'alias');mkdirSync(cwd);symlinkSync(cwd,alias);
try{
 check('send then immediate stop waits for native started',()=>{const s=new PendingStop();s.stop();assert.equal(s.stops,0);s.turnStarted();assert.equal(s.stops,1);});
 check('default sentinel restores actual default, not the word default',()=>{assert.equal(turnParams({model:'default',permission:'ask'},[],{model:'native-default'}).model,'native-default');});
 check('unadvertised effort is skipped then applied when advertised',()=>{const s={permission:'ask',options:{effort:'high'}};assert.deepEqual(turnParams(s,[],{}).skipped,['effort']);assert.equal(turnParams(s,['effort'],{}).options.effort,'high');});
 check('inherited auto reviewer overwritten on every turn',()=>{for(let i=0;i<2;i++)assert.equal(turnParams({permission:'ask'},[],{}).approvalsReviewer,'user');});
 check('RF02 codex tiers match T1.3 exactly (policy, reviewer, sandbox)',()=>{
  const pick=p=>{const t=turnParams({permission:p},[],{});return [t.approvalPolicy,t.approvalsReviewer,t.sandboxPolicy.type];};
  assert.deepEqual(pick('ask'),['on-request','user','workspaceWrite']);
  assert.deepEqual(pick('auto'),['on-request','auto_review','workspaceWrite']);
  assert.deepEqual(pick('full'),['never','user','dangerFullAccess']);
 });
 check('RF02 only three tiers; legacy edits and unknown tiers rejected',()=>{
  assert.deepEqual(TIERS,['ask','auto','full']);
  assert.throws(()=>turnParams({permission:'edits'},[],{}),/unknown-tier/);
  assert.equal(resolveTier('claude','edits').ok,false);
  assert.equal(resolveTier('opencode','ask').ok,false);
 });
 check('RF02 claude: ask=default, full=bypassPermissions, auto downgraded to ask with reason',()=>{
  assert.equal(resolveTier('claude','ask').params.permissionMode,'default');
  assert.equal(resolveTier('claude','full').params.permissionMode,'bypassPermissions');
  const d=resolveTier('claude','auto');assert.equal(d.tier,'ask');assert.equal(d.downgraded,true);assert.equal(d.reason,'tier-unsupported-by-executor');
 });
 check('minimum version numeric ordering and independent capability gate',()=>{assert.equal(capability('0.169.0',{minVersion:'0.167.1',probe:()=>true}).enabled,true);assert.equal(capability('0.9.0',{minVersion:'0.167.1',probe:()=>true}).enabled,false);assert.equal(capability('0.169.0',{minVersion:'0.169.0',probe:()=>false}).enabled,false);});
 check('known bad version and unknown version rejected per capability',()=>{assert.equal(capability('0.169.0',{minVersion:'0.167.1',knownIncompatible:['0.169.0'],probe:()=>true}).reason,'known-incompatible');assert.equal(capability('dev',{minVersion:'0.167.1',probe:()=>true}).reason,'unparsed-version');});
 check('scheme B writer queue, read overlap, alias, stop and drain',()=>{
  const q=new DirectoryQueue();
  assert.equal(q.request({id:'parent',cwd}), 'running');
  assert.equal(q.request({id:'child',cwd:alias}), 'queued');
  assert.equal(q.request({id:'reader',cwd,permission:'read-only',hostAllowsReadOnly:true}), 'running');
  assert.equal(q.request({id:'untrusted-read-claim',cwd,permission:'read-only'}), 'queued');q.cancel('untrusted-read-claim');
  assert.equal(q.release('parent',{ownerExited:true,businessDrained:false,backgroundDrained:true}),false);
  assert.equal(q.running.has('child'),false);
  assert.equal(q.release('parent',{ownerExited:true,businessDrained:true,backgroundDrained:true}),true);
  assert.equal(q.running.has('child'),true);assert.equal(q.waiting.length,0);
 });
 check('single seq replay duplicates, gap, snapshot and item revision',()=>{
  const s={seq:0,items:{}};const e={seq:1,id:'a',revision:2};
  assert.equal(applyEvents(s,[e,e]).seq,1);assert.equal(applyEvents(s,[{...e,seq:2}]).snapshotRequired,true);
  const current=applyEvents(s,[e]);assert.equal(applyEvents(current,[{...e,seq:2,revision:1}]).items.a.revision,2);
 });
 check('completed parent turn freezes new inputs, drains and reacquires after child',()=>{
  const q=new DirectoryQueue();q.request({id:'parent',cwd});q.request({id:'child',cwd});
  assert.equal(q.release('parent',{turnCompleted:false,inputFrozen:true,pendingTools:0,businessDrained:true,backgroundDrained:true}),false);
  assert.equal(q.release('parent',{turnCompleted:true,inputFrozen:true,pendingTools:0,businessDrained:true,backgroundDrained:true}),true);
  assert.equal(q.running.has('child'),true);assert.equal(q.request({id:'parent-resume',cwd}),'queued');
  q.release('child',{ownerExited:true,businessDrained:true,backgroundDrained:true});
  assert.equal(q.running.has('parent-resume'),true);
 });
 check('turn terminal alone cannot release with tools, background, business or input admission open',()=>{
  for(const bad of [{pendingTools:1},{backgroundDrained:false},{businessDrained:false},{inputFrozen:false}]){
   const q=new DirectoryQueue();q.request({id:'p',cwd});q.request({id:'c',cwd});
   assert.equal(q.release('p',{turnCompleted:true,inputFrozen:true,pendingTools:0,businessDrained:true,backgroundDrained:true,...bad}),false);assert.equal(q.running.has('c'),false);
  }
 });
 for(const [status,expected] of [['completed','completed'],['interrupted','stopped'],['failed','failed'],['process_exit','failed']])check('terminal settles requests/tools: '+status,()=>{
  const n=normalizer(status),turn='turn';
  n({driver:'codex',method:'turn/started',params:{turn:{id:turn}}});
  n({driver:'codex',method:'item/started',params:{turnId:turn,item:{id:'cmd',type:'commandExecution'}}});
  n({driver:'codex',method:'item/commandExecution/requestApproval',id:4,params:{turnId:turn}});
  const out=status==='process_exit'?n({driver:'host',type:'process_exit',data:{}}):n({driver:'codex',method:'turn/completed',params:{turn:{id:turn,status}}});
  assert(out.some(x=>x.type==='approval_request'&&x.final));assert(out.some(x=>x.type==='command_execution'&&x.final));assert(out.some(x=>x.kind==='turn'&&x.status===expected));
 });
 check('usage limit is limited and preserves reset time',()=>{const out=normalizer('limit')({driver:'codex',method:'turn/completed',params:{turn:{id:'x',status:'failed',error:{code:'usage_limit',resetAt:'2026-11-17T00:00:00Z'}}}});assert.equal(out.at(-1).status,'limited');assert.equal(out.at(-1).resetAt,'2026-11-17T00:00:00Z');});
}finally{rmSync(root,{recursive:true,force:true});}
const result={scope:'isolated candidate contract, not actual Provider/App',tests,failed:tests.filter(x=>x.status==='failed').length,cleanup:true};
writeFileSync(join(import.meta.dirname,'results/runtime-contract.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.failed?1:0;

// Isolated @parcel/watcher 2.5.6 native probe. Mutates only a fresh mkdtemp tree.
// No app launch, user filesystem root, CLI session or Codex access.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ownPath=fileURLToPath(import.meta.url),args=process.argv.slice(2);
const arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const moduleRoot=arg('--module-root','/private/tmp/m9-r34-watch-deps');
const require=createRequire(path.join(moduleRoot,'package.json'));
const watcher=require('@parcel/watcher');
const output=arg('--out',path.join(path.dirname(ownPath),'r34-watch-result.json'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async predicate=>{const start=performance.now();while(!predicate()){if(performance.now()-start>6000)throw new Error('Timed out waiting for native event');await sleep(25);}};
const assert=(value,message)=>{if(!value)throw new Error(message);};
const requestedScratch=await fs.mkdtemp(path.join(os.tmpdir(),'m9-r34-native-watch-'));
// FSEvents reports /private/var while os.tmpdir() can return the /var symlink.
// Resolve the existing root once; deleted event paths cannot be realpath-ed later.
const scratch=await fs.realpath(requestedScratch);
const root=path.join(scratch,'root');await fs.mkdir(root);

// A small independent adapter for lifecycle proof, not production authorization.
// No timer/polling fallback: these checks must receive real native notifications.
class SharedNativeWatch {
  constructor(dir){this.dir=dir;this.listeners=new Map();this.sub=null;this.pending=null;this.closed=false;this.starts=0;this.stops=0;this.events=0;this.error=null;}
  acquire(id,callback){
    this.listeners.set(id,callback);
    if(!this.pending&&!this.sub){
      this.starts++;
      this.pending=watcher.subscribe(this.dir,(error,events)=>{
        if(this.closed)return;
        if(error){this.error=String(error);return;}
        this.events+=events.length;
        for(const listener of this.listeners.values())listener(events);
      },{backend:'fs-events'}).then(async sub=>{
        this.pending=null;
        if(this.closed||!this.listeners.size){await sub.unsubscribe();this.stops++;}else this.sub=sub;
      }).catch(error=>{this.pending=null;this.error=String(error);});
    }
    return async()=>{
      this.listeners.delete(id);
      if(this.listeners.size)return;
      this.closed=true;
      const sub=this.sub;this.sub=null;
      if(sub){await sub.unsubscribe();this.stops++;}
      if(this.pending)await this.pending;
    };
  }
  async ready(){if(this.pending)await this.pending;if(this.error)throw new Error(this.error);}
}

if(args.includes('--cleanup-child')){
  const reg=new SharedNativeWatch(root);const stop=reg.acquire('only',()=>{});await reg.ready();await stop();
  await fs.rm(scratch,{recursive:true,force:true});
  console.log(JSON.stringify({nativeSubscriptionsStarted:reg.starts,nativeSubscriptionsStopped:reg.stops}));
  // Deliberately no process.exit(): the parent proves natural process completion.
}else{
  const checks=[],raw=[],resources=[];
  const check=async(id,title,fn)=>{try{const detail=await fn();checks.push({id,title,status:'passed',detail});console.log(id,'PASS',title);}catch(error){checks.push({id,title,status:'failed',error:String(error)});console.log(id,'FAIL',String(error));}};
  const nativeFiles=Object.keys(require.cache).filter(p=>p.endsWith('.node'));
  const nativeInfo=nativeFiles.map(p=>({path:p,bytes:fsSync.statSync(p).size,sha256:crypto.createHash('sha256').update(fsSync.readFileSync(p)).digest('hex')}));
  let sub=null;
  const receive=(error,events)=>{raw.push(...(events||[]).map(event=>({time:Date.now(),type:event.type,path:path.relative(root,event.path)})));if(error)raw.push({error:String(error)});};
  const seen=(name,type,from=0)=>raw.slice(from).some(e=>e.path===name&&e.type===type);
  try{
    await check('NW01','精确版本与原生 arm64 binding 实际加载',async()=>{assert(require('@parcel/watcher/package.json').version==='2.5.6','wrong package version');assert(nativeInfo.some(v=>v.path.includes('watcher-darwin-arm64')),'native binding missing');return{version:require('@parcel/watcher/package.json').version,nativeInfo};});
    await check('NW02','递归原生 create/update/delete 通知',async()=>{
      sub=await watcher.subscribe(root,receive,{backend:'fs-events'});resources.push(()=>sub?.unsubscribe());
      await fs.mkdir(path.join(root,'nested'));await fs.writeFile(path.join(root,'nested/file.txt'),'one');await until(()=>seen('nested/file.txt','create'));
      const mark=raw.length;await fs.appendFile(path.join(root,'nested/file.txt'),' two');await until(()=>seen('nested/file.txt','update',mark));
      await fs.unlink(path.join(root,'nested/file.txt'));await until(()=>seen('nested/file.txt','delete',mark));return{observed:raw.slice(0)};
    });
    await check('NW03','rename 以旧 delete 与新 create 表达',async()=>{
      await fs.writeFile(path.join(root,'before.txt'),'rename');await until(()=>seen('before.txt','create'));const mark=raw.length;
      await fs.rename(path.join(root,'before.txt'),path.join(root,'after.txt'));await until(()=>seen('before.txt','delete',mark)&&seen('after.txt','create',mark));return{observed:raw.slice(mark)};
    });
    await check('NW04','原子替换后继续观察新 inode 的后续修改',async()=>{
      await fs.writeFile(path.join(root,'watched.txt'),'v1');await until(()=>seen('watched.txt','create'));const mark=raw.length;
      await fs.writeFile(path.join(root,'.replacement'),'v2');await fs.rename(path.join(root,'.replacement'),path.join(root,'watched.txt'));await until(()=>raw.slice(mark).some(e=>e.path==='watched.txt'));
      const next=raw.length;await fs.appendFile(path.join(root,'watched.txt'),' v3');await until(()=>seen('watched.txt','update',next));return{value:await fs.readFile(path.join(root,'watched.txt'),'utf8'),observed:raw.slice(mark)};
    });
    await sub?.unsubscribe();sub=null;
    await check('NW05','共享订阅一个消费者关闭不影响另一者，归零后无回调',async()=>{
      const a=[],b=[],reg=new SharedNativeWatch(root);const stopA=reg.acquire('a',events=>a.push(...events)),stopB=reg.acquire('b',events=>b.push(...events));resources.push(stopA,stopB);await reg.ready();
      await fs.writeFile(path.join(root,'shared1'),'one');await until(()=>a.length&&b.length);await stopA();const countA=a.length;
      await fs.writeFile(path.join(root,'shared2'),'two');await until(()=>b.some(e=>e.path.endsWith('/shared2')));assert(a.length===countA,'closed consumer received events');
      await stopB();const countB=b.length;await fs.writeFile(path.join(root,'after-stop'),'none');await sleep(450);assert(b.length===countB,'callback after final stop');assert(reg.starts===1&&reg.stops===1,'unbalanced native subscriptions');return{starts:reg.starts,stops:reg.stops,closedConsumerEvents:countA,remainingConsumerEvents:countB};
    });
    await check('NW06','subscribe 尚未返回就取消仍 await unsubscribe',async()=>{
      const events=[],reg=new SharedNativeWatch(root),stop=reg.acquire('late',batch=>events.push(...batch));await stop();await fs.writeFile(path.join(root,'cancelled-before-ready'),'none');await sleep(400);
      assert(reg.starts===1&&reg.stops===1&&events.length===0&&!reg.sub&&!reg.pending,'late subscribe leaked');return{starts:reg.starts,stops:reg.stops,events:events.length};
    });
    await check('NW07','原生快照弥补停止订阅期间的文件变化',async()=>{
      const snap=path.join(scratch,'snapshot');await watcher.writeSnapshot(root,snap,{backend:'fs-events'});
      await fs.writeFile(path.join(root,'during-gap.txt'),'offline');await fs.unlink(path.join(root,'after.txt'));await sleep(400);
      const events=await watcher.getEventsSince(root,snap,{backend:'fs-events'});assert(events.some(e=>e.path.endsWith('/during-gap.txt')&&e.type==='create'),'missed offline create');assert(events.some(e=>e.path.endsWith('/after.txt')&&e.type==='delete'),'missed offline delete');return{events:events.map(e=>({...e,path:path.relative(root,e.path)}))};
    });
    await check('NW08','根失效后显式补扫和新订阅恢复，不延用旧句柄',async()=>{
      const recovery=path.join(scratch,'recover');await fs.mkdir(recovery);const oldEvents=[],newEvents=[];
      const old=await watcher.subscribe(recovery,(_e,ev)=>oldEvents.push(...(ev||[])),{backend:'fs-events'});resources.push(()=>old.unsubscribe());
      await fs.rm(recovery,{recursive:true});await sleep(300);let unavailable=false;try{await fs.stat(recovery);}catch(e){unavailable=e.code==='ENOENT';}assert(unavailable,'root health check did not fail');await old.unsubscribe();
      await fs.mkdir(recovery);await fs.writeFile(path.join(recovery,'missed.txt'),'recover snapshot');
      const restored=await watcher.subscribe(recovery,(_e,ev)=>newEvents.push(...(ev||[])),{backend:'fs-events'});resources.push(()=>restored.unsubscribe());
      const snapshot=await fs.readdir(recovery);await fs.writeFile(path.join(recovery,'live.txt'),'native again');await until(()=>newEvents.some(e=>e.path.endsWith('/live.txt')));await restored.unsubscribe();assert(snapshot.includes('missed.txt'),'resync missing prior file');
      return{rootUnavailable:unavailable,explicitResubscribe:true,snapshot,oldNativeEvents:oldEvents.map(e=>e.type),newNativeEvents:newEvents.map(e=>({type:e.type,path:path.basename(e.path)})),boundary:'probe orchestrates recovery; not production automatic health detection'};
    });
    await check('NW09','缺失根订阅失败可识别，不能报 native 覆盖',async()=>{
      let error=null;try{const bad=await watcher.subscribe(path.join(scratch,'missing'),()=>{},{backend:'fs-events'});await bad.unsubscribe();}catch(e){error=String(e);}assert(error,'missing root unexpectedly subscribed');return{error,requiredCoverage:'none until explicit recovery/fallback'};
    });
    await check('NW10','unsubscribe 后子进程自然退出，未用强制退出掩盖句柄',async()=>{
      const result=await new Promise(resolve=>{const start=performance.now();const child=spawn(process.execPath,[ownPath,'--module-root',moduleRoot,'--cleanup-child'],{env:process.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',timeout=false;child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);const timer=setTimeout(()=>{timeout=true;child.kill('SIGKILL');},5000);child.on('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,timeout,elapsedMs:performance.now()-start,stdout:stdout.trim(),stderr:stderr.trim()});});});assert(result.code===0&&!result.timeout,'watch child retained process');return result;
    });
  }finally{
    for(const dispose of resources.reverse())try{await dispose();}catch{}
    await fs.rm(scratch,{recursive:true,force:true});
    const report={date:new Date().toISOString(),requirements:'R3.3-20261017',iteration:'r34-watch',environment:{platform:process.platform,arch:process.arch,node:process.version,electron:process.versions.electron||null,backendRequested:'fs-events',moduleRoot},boundary:'Only fresh temporary files and a real @parcel/watcher native binding. No production IPC, packaged app, other OS/arch, permission fault, OS overflow or native kernel handle census.',checks,raw,summary:{passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length},cleanup:{scratchRemoved:!fsSync.existsSync(scratch)}};
    await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
  }
}

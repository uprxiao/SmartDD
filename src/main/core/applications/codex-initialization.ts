import {randomUUID} from 'node:crypto';
import {accessSync,closeSync,constants,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {delimiter,dirname,isAbsolute,join,resolve,basename} from 'node:path';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {ResolvedProfile} from '../ai/ai-profile-service';
import {withCoordinatorLock} from './coordinator-lock';
import type {NativeSqliteFile,ProcessIdentity,ProcessIdentityReader} from './process-identity';
import {readKnownCodexDdl,type CodexDdlObservation} from './codex-database-readiness';
import metadata from './codex-ddl-0.167.1.json';
import {resolveOfficialCodexImage} from './codex-task-server';
import {digest} from './manifest';

export interface CodexInitializerProcess {
  /** False is a host-owned receipt; a missing PID after an attempted fork is unknown. */
  attempted:boolean;
  root:ProcessIdentity|null;
  executable:string;
}
export interface CodexInitializationLease {
  readonly executable:string;
  arm(slot:'backend'|'terminal'):void;
  observe(slot:'backend'|'terminal',process:CodexInitializerProcess):void;
  captureTerminal(pid:number|null):void;
  waitReady(primary:'backend'|'terminal'):Promise<void>;
}
export interface CodexInitializationGate {
  coordinate<T>(input:{profile:ResolvedProfile;cwd:string;environment:Record<string,string>;signal:AbortSignal},work:(lease?:CodexInitializationLease)=>Promise<T>):Promise<T>;
}
const identitySchema=z.object({pid:z.number().int().positive(),startedAt:z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/)}).strict();
const slotSchema=z.object({state:z.enum(['armed','unforked','observed']),root:identitySchema.optional(),child:identitySchema.optional(),executable:z.string().startsWith('/').optional()}).strict();
const markerSchema=z.object({schema:z.literal(1),token:z.uuid(),image:z.object({path:z.string().startsWith('/'),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),slots:z.partialRecord(z.enum(['backend','terminal']),slotSchema)}).strict();
type Marker=z.infer<typeof markerSchema>;
type Image={path:string;sha256:string};
const recovery=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','上次 Codex 初始化进程的退出或数据库状态尚无法核验，请保留现场后重试');
const canceled=()=>new ApplicationError('CANCELED','Codex 初始化等待已取消');
const same=(a:{dev:string;ino:string},b:{dev:string;ino:string})=>a.dev===b.dev&&a.ino===b.ino;
const sameFiles=(a:NativeSqliteFile[],b:NativeSqliteFile[])=>a.length===b.length&&a.every(x=>b.some(y=>x.path===y.path&&same(x,y)));
const eager=metadata.databases.filter(d=>d.eager);

/** One host-wide initialization gate, independent of managed capabilities.
 * A released H gate alone never proves that a forked native migrator exited.
 * The durable marker survives failure/crash until exact process or DDL proof.
 */
export class CodexInitializationCoordinator implements CodexInitializationGate {
  private readonly root:string;
  private readonly markerPath:string;
  constructor(userData:string,private readonly processes:ProcessIdentityReader,private readonly options:{
    timeoutMs?:number;queueMs?:number;pollMs?:number;
    resolveImage?:(input:{profile:ResolvedProfile;cwd:string;environment:Record<string,string>})=>Image|null;
    verifyImage?:(image:Image)=>void;
    readDdl?:typeof readKnownCodexDdl;
  }={}){
    const parent=realpathSync(userData);this.root=join(parent,'codex-initialization');
    mkdirSync(this.root,{recursive:true,mode:0o700});
    const stat=lstatSync(this.root);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(this.root)!==this.root)throw recovery();
    this.markerPath=join(this.root,'unresolved.json');
  }
  async coordinate<T>(input:{profile:ResolvedProfile;cwd:string;environment:Record<string,string>;signal:AbortSignal},work:(lease?:CodexInitializationLease)=>Promise<T>):Promise<T>{
    if(input.profile.runner!=='codex')return work();
    return withCoordinatorLock(this.root,'catalog',async()=>{
      this.recover();
      if(input.signal.aborted)throw canceled();
      const image=(this.options.resolveImage??resolveKnownImage)(input);
      // Other native versions retain their existing launch behavior. They are
      // not reported as verified by the fixed 0.167.1 DDL predicate.
      if(!image)return work();
      let marker:Marker={schema:1,token:randomUUID(),image,slots:{}};
      let ready=false;
      const save=()=>this.write(marker);
      const observe=(slot:'backend'|'terminal',process:CodexInitializerProcess)=>{
        if(!Object.hasOwn(marker.slots,slot))throw recovery();
        if(!process.attempted)marker.slots[slot]={state:'unforked'};
        else if(process.root){
          const old=marker.slots[slot]!;
          if(old.root&&(old.root.pid!==process.root.pid||old.root.startedAt!==process.root.startedAt))throw recovery();
          const child=this.processes.nativeChild?.(process.root,process.executable);
          marker.slots[slot]={state:'observed',root:{...process.root},executable:process.executable,...(child?{child:{pid:child.pid,startedAt:child.startedAt}}:old.child?{child:old.child}:{})};
        }
        save();
      };
      const lease:CodexInitializationLease={
        executable:image.path,
        arm:slot=>{if(input.signal.aborted)throw canceled();this.verifyImage(image);if(Object.hasOwn(marker.slots,slot))throw recovery();marker.slots[slot]={state:'armed'};save();},
        observe,
        captureTerminal:pid=>observe('terminal',{attempted:true,root:pid?this.processes.read(pid):null,executable:image.path}),
        waitReady:async primary=>{
          const deadline=performance.now()+(this.options.timeoutMs??15000);
          for(;;){
            if(input.signal.aborted)throw canceled();
            const slot=marker.slots[primary];
            if(slot?.root&&slot.executable){
              const child=this.processes.nativeChild?.(slot.root,slot.executable);
              if(child){slot.child={pid:child.pid,startedAt:child.startedAt};save();}
              if(this.ready(marker,primary)){ready=true;this.remove(marker);return;}
              if(slot.child&&this.processes.state(slot.child)==='stopped')throw new ApplicationError('CAPABILITY_UNAVAILABLE','Codex 在数据库初始化检查完成前退出');
            }
            if(performance.now()>=deadline)throw new ApplicationError('TIMEOUT','Codex 已启动，但数据库初始化尚未核验完成；任务与原生历史已保留');
            await new Promise<void>(done=>setTimeout(done,this.options.pollMs??25));
          }
        },
      };
      try{return await work(lease);}
      finally{
        // No fork window was opened, or every captured possible initializer is
        // proved stopped. An armed/unknown slot deliberately remains durable.
        if(!ready&&Object.keys(marker.slots).length&&this.stopped(marker))this.remove(marker);
      }
    },{signal:input.signal,timeoutMs:this.options.queueMs??60000,processes:this.processes});
  }
  private ready(marker:Marker,primary:'backend'|'terminal'):boolean{
    const slot=marker.slots[primary];
    if(!slot?.root||!slot.child||slot.executable!==marker.image.path||marker.image.sha256!==metadata.binarySha256)return false;
    const before=this.processes.nativeChild?.(slot.root,slot.executable);
    if(!before||before.pid!==slot.child.pid||before.startedAt!==slot.child.startedAt)return false;
    const files=this.processes.sqliteFiles?.(slot.child,slot.executable);if(!files)return false;
    const selected=eager.map(spec=>files.filter(f=>basename(f.path)===spec.name));
    if(selected.some(matches=>matches.length!==1))return false;
    const chosen=selected.map(matches=>matches[0]),sqliteRoots=new Set(chosen.filter(f=>basename(f.path)!=='logs_2.sqlite').map(f=>dirname(f.path)));
    if(sqliteRoots.size!==1)return false;
    const roots={sqlite:[...sqliteRoots][0],logs:dirname(chosen.find(f=>basename(f.path)==='logs_2.sqlite')!.path)};
    let ddl:CodexDdlObservation;
    try{ddl=(this.options.readDdl??readKnownCodexDdl)({version:metadata.version,binarySha256:marker.image.sha256,roots});}catch{return false;}
    if(ddl.status!=='ready'||chosen.some(f=>!ddl.databases.some(d=>d.path===f.path&&d.identity&&same(d.identity,f))))return false;
    const after=this.processes.nativeChild?.(slot.root,slot.executable),afterFiles=this.processes.sqliteFiles?.(slot.child,slot.executable);
    return Boolean(after&&after.pid===before.pid&&after.startedAt===before.startedAt&&afterFiles&&sameFiles(files,afterFiles));
  }
  private verifyImage(image:Image):void{
    if(this.options.verifyImage){this.options.verifyImage(image);return;}
    const stat=lstatSync(image.path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024*1024||realpathSync(image.path)!==image.path||digest(readFileSync(image.path))!==image.sha256)throw new ApplicationError('EXECUTABLE_MISMATCH','Codex 程序在等待初始化时已变化，请重新检测');
  }
  private stopped(marker:Marker):boolean{
    return Object.values(marker.slots).every(s=>s.state==='unforked'||s.state==='observed'&&s.root&&s.child&&this.processes.state(s.root)==='stopped'&&this.processes.state(s.child)==='stopped');
  }
  private recover():void{
    const marker=this.read();if(!marker)return;
    if(this.stopped(marker)||(['backend','terminal'] as const).some(slot=>this.ready(marker,slot))){this.remove(marker);return;}
    throw recovery();
  }
  private read():Marker|null{
    try{
      const s=lstatSync(this.markerPath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>16384)throw recovery();
      const fd=openSync(this.markerPath,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{return markerSchema.parse(JSON.parse(readFileSync(fd,'utf8')));}finally{closeSync(fd);}
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw recovery();}
  }
  private syncRoot():void{const fd=openSync(this.root,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
  private write(marker:Marker):void{
    const old=this.read();if(old&&old.token!==marker.token)throw recovery();
    const path=join(this.root,marker.token+'.tmp');writeFileSync(path,JSON.stringify(marker),{flag:'wx',mode:0o600});
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(path,this.markerPath);this.syncRoot();
  }
  private remove(marker:Marker):void{const old=this.read();if(!old)return;if(old.token!==marker.token)throw recovery();unlinkSync(this.markerPath);this.syncRoot();}
}

function resolveKnownImage(input:{profile:ResolvedProfile;cwd:string;environment:Record<string,string>}):Image|null{
  const requested=input.profile.command;
  const candidates=isAbsolute(requested)?[requested]:requested.includes('/')?[resolve(input.cwd,requested)]:(input.environment.PATH??'').split(delimiter).filter(Boolean).map(p=>resolve(input.cwd,p,requested));
  for(const candidate of candidates){
    try{accessSync(candidate,constants.X_OK);if(!statSync(candidate).isFile())continue;}catch{continue;}
    // PATH's first executable wins; do not inspect a different installation.
    try{const image=resolveOfficialCodexImage(candidate,metadata.version);return image.sha256===metadata.binarySha256?image:null;}catch{return null;}
  }
  return null;
}

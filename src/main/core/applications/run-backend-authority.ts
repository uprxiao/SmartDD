import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import type {Socket} from 'node:net';
import {ApplicationError} from '@shared/applications';
import {digest} from './manifest';
import {assertOwnedCapabilityRun,type CapabilityRunRegistry,type OwnedCapabilityRun,type OwnedRunProcess,type ProcessRow} from './run-registry';
import type {ProcessIdentity,ProcessIdentityReader} from './process-identity';
import type {UnixPeerIdentity,UnixPeerIdentityReader} from './unix-peer-identity';

/** Only host composition may provide an additional, attested process root. */
export interface RunPeerRootAuthorizer {authorize(runId:string,proof:UnixPeerIdentity):boolean}
export interface RunBackendReservation {
  /** Reserve and arm BOTH windows before the host spawns a backend or its wrapper. */
  launcher:OwnedRunProcess;
  server:OwnedRunProcess;
  /** Only the connected host control socket, never a caller-provided PID. */
  bindControl(socket:Socket):Promise<void>;
}
interface Image {path:string;sha256:string;seal:string}
interface Entry {
  run:OwnedCapabilityRun;launcher:OwnedRunProcess;server:OwnedRunProcess;image:Image;
  socket?:Socket;root?:ProcessIdentity;peer?:ProcessIdentity;binding:boolean;revoked:boolean;
  detach():void;
}
const same=(a:ProcessIdentity,b:ProcessIdentity)=>a.pid===b.pid&&a.startedAt===b.startedAt;
const denied=()=>new ApplicationError('SCOPE_DENIED','服务不是本次运行核验过的私有后端');
function seal(path:string):string {
  const stat=lstatSync(path,{bigint:true});
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512n*1024n*1024n||realpathSync(path)!==path)throw denied();
  return [stat.dev,stat.ino,stat.size,stat.mode,stat.mtimeNs,stat.ctimeNs].join(':');
}

/**
 * A Codex remote TUI and its server are siblings. This authority accepts only
 * server descendants proved through the host's own connected Unix socket.
 * Durable bridge records precede spawning; disconnect revokes, but never proves
 * exit. PID reuse and unreadable identities retain leases without being signalled.
 * This class neither opens a public endpoint nor launches/reuses a shared daemon.
 */
export class RunBackendAuthority implements RunPeerRootAuthorizer {
  private readonly entries=new Map<string,Entry>();
  private readonly pending=new Set<Promise<void>>();
  private readonly timer:ReturnType<typeof setInterval>;
  private closed=false;
  private sweeping=false;
  private closing?:Promise<void>;
  constructor(private readonly runs:CapabilityRunRegistry,private readonly peers:UnixPeerIdentityReader,private readonly processes:ProcessIdentityReader,private readonly options:{pollMs?:number;disposeWaitMs?:number;signal?:(identity:ProcessIdentity)=>void}={}) {
    this.timer=setInterval(()=>{void this.poll();},Math.max(20,options.pollMs??500));this.timer.unref();
  }
  async reserve(run:OwnedCapabilityRun,expectedImage:{path:string;sha256:string}):Promise<RunBackendReservation> {
    assertOwnedCapabilityRun(this.runs,run);
    const context=this.runs.bridgePreparation(run.runId);
    if(this.closed||run.signal.aborted||context.snapshot.runner!=='codex'||!['prepared','active'].includes(context.run.state)||this.entries.has(run.runId))throw denied();
    const image={...expectedImage,seal:seal(expectedImage.path)};
    if(!/^[a-f0-9]{64}$/.test(image.sha256)||digest(readFileSync(image.path))!==image.sha256||seal(image.path)!==image.seal)throw denied();
    const launcher=await run.reserveBridge();let server:OwnedRunProcess;
    try{server=await run.reserveBridge();}catch(error){await launcher.cancelBeforeLaunch();throw error;}
    // reserveBridge awaits the resource lock: recheck closure/concurrent admission.
    if(this.closed||run.signal.aborted||this.entries.has(run.runId)){await launcher.cancelBeforeLaunch();await server.cancelBeforeLaunch();throw denied();}
    const abort=()=>this.revokeRun(run.runId);
    const entry:Entry={run,launcher,server,image,binding:false,revoked:false,detach:()=>run.signal.removeEventListener('abort',abort)};
    this.entries.set(run.runId,entry);run.signal.addEventListener('abort',abort,{once:true});
    return{launcher,server,bindControl:socket=>{
      const work=this.bind(entry,socket).catch(error=>{if(entry.socket===socket)this.lost(entry);throw error;});this.track(work);return work;
    }};
  }
  private track(work:Promise<void>):void {
    this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});
  }
  private row(entry:Entry,handle:OwnedRunProcess):ProcessRow|undefined {
    return this.runs.store.sqlite.prepare('SELECT * FROM capability_run_processes WHERE run_id=? AND process_id=?').get(entry.run.runId,handle.processId) as ProcessRow|undefined;
  }
  private imageCurrent(entry:Entry):boolean {
    try{return seal(entry.image.path)===entry.image.seal;}catch{return false;}
  }
  private current(entry:Entry):boolean {
    return !this.closed&&!entry.revoked&&!entry.run.signal.aborted&&this.entries.get(entry.run.runId)===entry&&this.imageCurrent(entry);
  }
  private async bind(entry:Entry,socket:Socket):Promise<void> {
    if(!this.current(entry)||entry.binding||entry.socket||socket.destroyed)throw denied();
    const root=this.row(entry,entry.launcher),server=this.row(entry,entry.server);
    const direct=server?.state==='active'&&server.pid===root?.pid&&server.process_started_at===root?.process_started_at;
    if(root?.state!=='active'||!root.pid||!root.process_started_at||!(server?.state==='armed'&&server.pid===null||direct))throw denied();
    entry.binding=true;entry.root={pid:root.pid,startedAt:root.process_started_at};entry.socket=socket;
    const lost=()=>this.lost(entry);socket.once('close',lost);
    const detach=entry.detach;entry.detach=()=>{detach();socket.off('close',lost);};
    const proof=await this.peers.read(socket);
    const latest=this.row(entry,entry.launcher),context=this.runs.bridgePreparation(entry.run.runId);
    let actualImage:string|undefined;try{if(proof)actualImage=realpathSync(proof.peer.executable);}catch{/* Fail closed. */}
    if(!this.current(entry)||socket.destroyed||!proof||proof.uid!==process.getuid?.()||actualImage!==entry.image.path||proof.peer.pid===process.pid||proof.peer.pid===context.run.pid||direct&&(proof.peer.pid!==server!.pid||proof.peer.startedAt!==server!.process_started_at)||latest?.state!=='active'||latest.pid!==entry.root.pid||latest.process_started_at!==entry.root.startedAt||this.processes.state(entry.root)!=='running'||this.processes.state(proof.peer)!=='running'||!proof.ancestors.some(item=>same(item,entry.root!)))throw denied();
    // Capture a proved peer even if attach loses a race, so cancellation can still
    // signal only that exact identity and kernel-stopped recovery can settle it.
    entry.peer={pid:proof.peer.pid,startedAt:proof.peer.startedAt};
    try{await entry.server.attach(entry.peer.pid,entry.peer.startedAt);}catch(error){this.lost(entry);throw error;}
    if(!this.current(entry)||socket.destroyed){this.lost(entry);throw denied();}
    entry.binding=false;
  }
  authorize(runId:string,proof:UnixPeerIdentity):boolean {
    const entry=this.entries.get(runId);
    if(!entry||!this.current(entry)||entry.binding||!entry.socket||entry.socket.destroyed||!entry.root||!entry.peer||proof.uid!==process.getuid?.())return false;
    try {
      const context=this.runs.assertActive(runId),row=this.row(entry,entry.server),root=this.row(entry,entry.launcher);
      if(!context.run.pid||!context.run.processStartedAt||this.processes.state({pid:context.run.pid,startedAt:context.run.processStartedAt})!=='running'||row?.state!=='active'||row.pid!==entry.peer.pid||row.process_started_at!==entry.peer.startedAt||root?.state!=='active'||root.pid!==entry.root.pid||root.process_started_at!==entry.root.startedAt||this.processes.state(entry.root)!=='running'||this.processes.state(entry.peer)!=='running')return false;
      return proof.peer.pid!==entry.peer.pid&&proof.ancestors.some(item=>same(item,entry.peer!));
    }catch{return false;}
  }
  private signal(entry:Entry):void {
    const seen=new Set<string>();
    for(const identity of [entry.peer,entry.root]){
      if(!identity||seen.has(identity.pid+':'+identity.startedAt)||this.processes.state(identity)!=='running')continue;
      seen.add(identity.pid+':'+identity.startedAt);
      try{if(this.options.signal)this.options.signal(identity);else process.kill(identity.pid,'SIGTERM');}catch{/* Signals do not prove exit. */}
    }
  }
  revokeRun(runId:string):void {
    const entry=this.entries.get(runId);if(!entry)return;
    entry.revoked=true;entry.socket?.destroy();this.signal(entry);
  }
  private lost(entry:Entry):void {
    if(entry.revoked)return;
    this.revokeRun(entry.run.runId);this.track(entry.run.stop('private-backend-lost').then(()=>{}));
  }
  async poll():Promise<void> {
    if(this.sweeping)return;this.sweeping=true;
    try{for(const [id,entry]of this.entries){
      for(const [handle,identity]of [[entry.launcher,entry.root],[entry.server,entry.peer]] as const){
        if(!identity||this.processes.state(identity)!=='stopped')continue;
        this.lost(entry);
        try{await handle.exited();}catch{/* Retain the durable lease if finalization fails. */}
      }
      if(entry.revoked&&[entry.launcher,entry.server].every(handle=>['exited','canceled'].includes(this.row(entry,handle)?.state??''))){entry.detach();this.entries.delete(id);}
    }}finally{this.sweeping=false;}
  }
  dispose():Promise<void> {
    if(this.closing)return this.closing;
    this.closed=true;clearInterval(this.timer);for(const entry of this.entries.values()){
      this.revokeRun(entry.run.runId);this.track(entry.run.stop('private-backend-shutdown').then(()=>{}));
    }
    this.closing=(async()=>{
      await Promise.allSettled([...this.pending]);
      const deadline=performance.now()+Math.max(1,Math.min(5000,this.options.disposeWaitMs??1000));
      do{await this.poll();if(!this.entries.size)break;await new Promise<void>(done=>setTimeout(done,10));}while(performance.now()<deadline);
      for(const entry of this.entries.values())entry.detach();
    })();return this.closing;
  }
}

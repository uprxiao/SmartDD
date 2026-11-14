import {spawn,type ChildProcess} from 'node:child_process';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {Socket} from 'node:net';
import {join} from 'node:path';
import WebSocket from 'ws';
import {ApplicationError} from '@shared/applications';
import type {OwnedCapabilityRun} from './run-registry';
import type {RunBackendAuthority,RunBackendReservation} from './run-backend-authority';
import type {ProcessIdentity,ProcessIdentityReader} from './process-identity';
import {PrivateAgentEndpoint} from './private-agent-endpoint';
import {digest} from './manifest';
import {CodexResumeRelay,codexResumePermissions} from './codex-resume-relay';
import type {CodexPermissionKey} from './codex-client-args';

interface SkillRoot {path:string;name:string}
interface Request {resolve(value:unknown):void;reject(error:unknown):void;timer:ReturnType<typeof setTimeout>}
interface ServerOptions {startupMs?:number;requestMs?:number;stopMs?:number;observe?:(method:'initialize'|'skills/extraRoots/set'|'skills/list'|'config/read',response:unknown)=>void;observeResume?:(receipt:Record<string,unknown>)=>void}
export interface PrivateCodexServerInput {
  run:OwnedCapabilityRun;version:string;storeId:string;executable:{path:string;sha256:string};
  /** Host-composed native server arguments; no prompt or tool arguments. */
  args:string[];environment:Record<string,string>;cwd:string;skills:readonly SkillRoot[];signal:AbortSignal;
  /** Host-only test/native envelope (production native Codex has no prefix). */
  executablePrefix?:string[];
  resume?:{threadId:string;permissionKeys:readonly CodexPermissionKey[]};
  start?:{permissionKeys:readonly CodexPermissionKey[]};
}
const failure=(code:'CANCELED'|'CAPABILITY_UNAVAILABLE'|'INVALID_RESPONSE'|'TIMEOUT'|'RESOURCE_RECOVERY_REQUIRED',text:string)=>new ApplicationError(code,text);

/** One direct native binary and Unix WebSocket per run. The control connection
 * only initializes and discovers frozen Skill roots; it never starts a model turn
 * or approves server requests. TUI has its own connection to this same server.
 */
export class CodexPrivateServer {
  readonly endpoint:PrivateAgentEndpoint;
  private child?:ChildProcess;
  private socket?:WebSocket;
  private ticket?:RunBackendReservation;
  private identity?:ProcessIdentity;
  private forkAttempted=false;
  private exited=false;
  private phase:'prepared'|'starting'|'ready'|'stopping'|'stopped'='prepared';
  private readonly requests=new Map<number,Request>();
  private serial=0;
  private outputBytes=0;
  private responseBytes=0;
  private finished?:Promise<void>;
  private finish!:()=>void;
  private finalization?:Promise<void>;
  private stopping?:Promise<void>;
  private abort?:()=>void;
  private relay?:CodexResumeRelay;
  private resumePermissions?:Record<string,unknown>;
  readonly recoveryWarnings:string[]=[];
  private constructor(private readonly input:PrivateCodexServerInput,private readonly authority:RunBackendAuthority,private readonly processes:ProcessIdentityReader,private readonly options:ServerOptions={}){
    if(input.version!=='0.167.1'||realpathSync(input.executable.path)!==input.executable.path)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','当前 Codex 私有服务版本或原生程序尚未验证');
    const image=lstatSync(input.executable.path);if(!image.isFile()||image.isSymbolicLink()||image.size>512*1024*1024||digest(readFileSync(input.executable.path))!==input.executable.sha256)throw new ApplicationError('EXECUTABLE_MISMATCH','私有 Codex 程序已变化');
    if(input.skills.length>128||new Set(input.skills.map(s=>s.name)).size!==input.skills.length||input.skills.some(s=>realpathSync(s.path)!==s.path||!lstatSync(join(s.path,'SKILL.md')).isFile()))throw new ApplicationError('HASH_MISMATCH','本次冻结 Skill 目录不完整');
    if(input.resume&&(!/^[a-f0-9-]{36}$/.test(input.resume.threadId)||!input.resume.permissionKeys.length))throw new ApplicationError('INVALID_INPUT','本次恢复身份或权限来源不完整');
    if(input.start&&(input.resume||!input.start.permissionKeys.includes('default_permissions')))throw new ApplicationError('INVALID_INPUT','本次新建命名权限来源不完整');
    this.endpoint=new PrivateAgentEndpoint({storeId:input.storeId,runId:input.run.runId});
    if(input.resume||input.start)this.relay=new CodexResumeRelay({storeId:input.storeId,runId:input.run.runId,method:input.resume?'thread/resume':'thread/start',threadId:input.resume?.threadId,upstream:this.endpoint.url,verifyUpstream:()=>this.endpoint.verifySocket(),allow:()=>this.phase==='ready'&&!input.run.signal.aborted&&!input.signal.aborted,permissions:()=>{if(!this.resumePermissions)throw failure('CAPABILITY_UNAVAILABLE','本次原生权限尚未准备');return this.resumePermissions;},observe:options.observeResume});
  }
  static async prepare(input:PrivateCodexServerInput,authority:RunBackendAuthority,processes:ProcessIdentityReader,options:ServerOptions={}):Promise<CodexPrivateServer>{
    const server=new CodexPrivateServer(input,authority,processes,options);
    try{
      server.checkCanceled();server.ticket=await authority.reserve(input.run,input.executable);server.checkCanceled();
      return server;
    }catch(error){await server.stop();throw error;}
  }
  get url():string{return this.relay?.url??this.endpoint.url;}
  get state(){return this.phase;}
  initializationProcess():import('./codex-initialization').CodexInitializerProcess {
    return {attempted:this.forkAttempted,root:this.identity?{...this.identity}:null,executable:this.input.executable.path};
  }
  private checkCanceled():void {if(this.input.signal.aborted||this.input.run.signal.aborted||this.phase==='stopping'||this.phase==='stopped')throw failure('CANCELED','本次 Codex 服务启动已取消');}
  async start():Promise<void> {
    if(this.phase!=='prepared'||!this.ticket)throw failure('CANCELED','私有 Codex 服务不能重复启动');
    this.phase='starting';this.finished=new Promise<void>(done=>this.finish=done);
    this.abort=()=>{void this.stop();};this.input.signal.addEventListener('abort',this.abort,{once:true});this.input.run.signal.addEventListener('abort',this.abort,{once:true});
    try{
      this.checkCanceled();this.endpoint.verify();
      await this.ticket.launcher.arm();await this.ticket.server.arm();this.checkCanceled();
      // Native version inspection happened earlier; never launch a substituted
      // image after asynchronous run/endpoint preparation.
      if(digest(readFileSync(this.input.executable.path))!==this.input.executable.sha256)throw new ApplicationError('EXECUTABLE_MISMATCH','私有 Codex 程序在启动前已变化');
      this.forkAttempted=true;
      let child:ChildProcess;
      try{child=spawn(this.input.executable.path,[...(this.input.executablePrefix??[]),...this.input.args,'app-server','--listen',this.endpoint.url],{cwd:this.input.cwd,env:{...this.input.environment},windowsHide:true,stdio:['ignore','pipe','pipe']});}
      catch(error){this.forkAttempted=false;throw error;}
      this.child=child;
      child.once('exit',()=>{this.exited=true;this.finalization=this.recordExit();void this.finalization.catch(()=>this.recoveryWarnings.push('backend-exit-finalization'));});
      const spawned=await new Promise<boolean>(resolve=>{
        child.once('spawn',()=>resolve(true));child.once('error',()=>resolve(false));
      });
      for(const stream of [child.stdout,child.stderr]){stream?.on('error',()=>void this.stop());stream?.on('data',bytes=>{this.outputBytes+=bytes.length;if(this.outputBytes>1024*1024)void this.stop();});}
      if(!spawned){
        if(child.pid===undefined){this.forkAttempted=false;await this.cancelWindows();this.exited=true;this.finish();}
        throw failure('CAPABILITY_UNAVAILABLE','私有 Codex 程序未能启动');
      }
      this.identity=this.processes.read(child.pid!)??undefined;
      await this.ticket.launcher.attach(child.pid!,this.identity?.startedAt);await this.ticket.server.attach(child.pid!,this.identity?.startedAt);
      if(!this.identity)throw failure('RESOURCE_RECOVERY_REQUIRED','私有 Codex 启动身份未知，保留原占用');
      const deadline=performance.now()+Math.max(100,Math.min(15000,this.options.startupMs??10000));
      const socket=await this.connect(deadline);this.socket=socket;
      const nativeSocket=(socket as WebSocket & {_socket?:Socket})._socket;
      if(!(nativeSocket instanceof Socket))throw failure('RESOURCE_RECOVERY_REQUIRED','无法核验 Codex 控制连接的原生句柄');
      await this.ticket.bindControl(nativeSocket);this.checkCanceled();this.endpoint.verifySocket();
      this.listen(socket);
      const initialized=await this.request('initialize',{clientInfo:{name:'willyou-private-control',version:'1.0.0'},capabilities:{experimentalApi:true}});this.options.observe?.('initialize',initialized);
      socket.send(JSON.stringify({method:'initialized',params:{}}));
      const roots=await this.request('skills/extraRoots/set',{extraRoots:this.input.skills.map(s=>s.path)});this.options.observe?.('skills/extraRoots/set',roots);
      const listed=await this.request('skills/list',{cwds:[this.input.cwd],forceReload:true});this.options.observe?.('skills/list',listed);this.verifySkills(listed);
      if(this.input.resume||this.input.start){const config=await this.request('config/read',{cwd:this.input.cwd});this.options.observe?.('config/read',config);this.resumePermissions=codexResumePermissions(config,(this.input.resume??this.input.start)!.permissionKeys);await this.relay!.start();}
      this.checkCanceled();this.phase='ready';
    }catch(error){await this.stop();throw error instanceof ApplicationError?error:failure('CAPABILITY_UNAVAILABLE','本次私有 Codex 服务未能完成准备');}
  }
  private async connect(deadline:number):Promise<WebSocket>{
    while(performance.now()<deadline){
      this.checkCanceled();if(this.exited)throw failure('CAPABILITY_UNAVAILABLE','私有 Codex 服务在连接前退出');
      try{this.endpoint.verifySocket();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await new Promise<void>(done=>setTimeout(done,20));continue;}
      const socket=new WebSocket('ws+unix://'+this.endpoint.path+':/',{handshakeTimeout:Math.max(1,Math.min(1000,deadline-performance.now())),maxPayload:4*1024*1024});
      socket.on('error',()=>{});
      const opened=await new Promise<boolean>(resolve=>{socket.once('open',()=>resolve(true));socket.once('error',()=>resolve(false));socket.once('close',()=>resolve(false));});
      if(opened){this.endpoint.verifySocket();return socket;}socket.terminate();
      await new Promise<void>(done=>setTimeout(done,20));
    }
    throw failure('TIMEOUT','私有 Codex 服务未在期限内接受连接');
  }
  private listen(socket:WebSocket):void {
    socket.on('close',()=>{this.rejectRequests(failure('CANCELED','私有 Codex 控制连接已关闭'));void this.stop();});
    socket.on('message',bytes=>{
      const raw=bytes.toString();this.responseBytes+=Buffer.byteLength(raw);
      try{
        if(this.responseBytes>8*1024*1024)throw Error('budget');
        const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('shape');
        if(typeof value.method==='string'){
          // This client does not own a TUI/model thread and cannot approve it.
          if(value.id!==undefined)socket.send(JSON.stringify({id:value.id,error:{code:-32601,message:'Host control does not handle interactive requests'}}));return;
        }
        if(!Number.isSafeInteger(value.id)||!Object.hasOwn(value,'result')&&!Object.hasOwn(value,'error'))throw Error('response');
        const pending=this.requests.get(value.id);if(!pending)throw Error('unknown-id');
        this.requests.delete(value.id);clearTimeout(pending.timer);
        if(Object.hasOwn(value,'error'))pending.reject(failure('CAPABILITY_UNAVAILABLE','Codex 拒绝本次私有服务准备请求'));else pending.resolve(value.result);
      }catch{this.rejectRequests(failure('INVALID_RESPONSE','Codex 控制响应无效或超过预算'));void this.stop();}
    });
  }
  private request(method:string,params:unknown):Promise<unknown>{
    this.checkCanceled();const socket=this.socket;if(!socket||socket.readyState!==WebSocket.OPEN||this.requests.size>=8)throw failure('CAPABILITY_UNAVAILABLE','私有 Codex 控制连接不可用');
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.requests.delete(id);reject(failure('TIMEOUT','私有 Codex 准备请求超时'));},Math.max(10,Math.min(10000,this.options.requestMs??5000)));
      this.requests.set(id,{resolve,reject,timer});
      socket.send(JSON.stringify({id,method,params}),error=>{if(error){clearTimeout(timer);this.requests.delete(id);reject(failure('CAPABILITY_UNAVAILABLE','私有 Codex 请求未能提交'));}});
    });
  }
  private verifySkills(value:unknown):void {
    const response=value as {data?:{skills?:{name?:unknown;path?:unknown;enabled?:unknown}[]}[]};
    if(!Array.isArray(response?.data))throw failure('INVALID_RESPONSE','Codex 未返回本次 Skill 目录结果');
    const all=response.data.flatMap(row=>Array.isArray(row.skills)?row.skills:[]);
    for(const expected of this.input.skills){
      const matches=all.filter(skill=>skill.name===expected.name);
      if(matches.length!==1||matches[0].enabled!==true||matches[0].path!==join(expected.path,'SKILL.md'))throw failure('INVALID_RESPONSE','本次冻结 Skill 未被 Codex 准确识别或名称有冲突');
    }
  }
  private rejectRequests(error:unknown):void{for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(error);}this.requests.clear();}
  private async cancelWindows():Promise<void>{
    if(!this.ticket)return;
    for(const handle of [this.ticket.launcher,this.ticket.server]){
      if(!handle.cancelUnforked)throw failure('RESOURCE_RECOVERY_REQUIRED','原运行缺少明确的未 fork 收尾接口');await handle.cancelUnforked();
    }
  }
  private async recordExit():Promise<void>{
    this.rejectRequests(failure('CANCELED','私有 Codex 服务已退出'));this.socket?.terminate();
    try{await this.ticket!.launcher.exited();await this.ticket!.server.exited();}finally{this.finish();if(this.phase==='stopping')queueMicrotask(()=>void this.stop());}
  }
  stop():Promise<void>{
    if(this.stopping)return this.stopping;
    const work=this.stopOnce();this.stopping=work;void work.finally(()=>{if(this.stopping===work)this.stopping=undefined;}).catch(()=>{});return work;
  }
  private async stopOnce():Promise<void>{
    if(this.phase==='stopped')return;
    this.phase='stopping';this.rejectRequests(failure('CANCELED','本次私有 Codex 服务已停止'));this.socket?.terminate();
    try{await this.relay?.stop();}catch{this.recoveryWarnings.push('resume-relay-endpoint-retained');}
    if(!this.forkAttempted){try{await this.cancelWindows();}catch{this.recoveryWarnings.push('backend-cancel-window');}}
    else if(!this.exited&&this.child&&this.identity&&this.processes.state(this.identity)==='running')this.child.kill('SIGTERM');
    if(this.finished&&!this.exited&&this.forkAttempted){
      let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([this.finished,new Promise<void>(done=>{timer=setTimeout(done,Math.max(10,Math.min(5000,this.options.stopMs??2000)));})]);}finally{if(timer)clearTimeout(timer);}
    }
    if(this.finalization)await this.finalization.catch(()=>this.recoveryWarnings.push('backend-exit-finalization'));
    if(this.abort){this.input.signal.removeEventListener('abort',this.abort);this.input.run.signal.removeEventListener('abort',this.abort);}
    if(!this.forkAttempted||this.exited){
      try{this.endpoint.release();}catch{this.recoveryWarnings.push('backend-endpoint-retained');}
      this.phase='stopped';
    }else this.recoveryWarnings.push('backend-exit-unknown');
  }
}

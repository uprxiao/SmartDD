import {randomBytes,randomUUID} from 'node:crypto';
import {chmodSync,lstatSync,mkdtempSync,readFileSync,realpathSync,rmdirSync,unlinkSync} from 'node:fs';
import {createServer,type Server,type Socket} from 'node:net';
import {isAbsolute,join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {boundedJson,BRIDGE_LIMITS,type BridgeResponse} from '@shared/application-bridge';
import {cliRequestSchema,type ApplicationCliRequest} from '@shared/application-cli';
import {digest} from './manifest';
import type {CapabilityRunRegistry,OwnedCapabilityRun,RunContext} from './run-registry';
import type {ApplicationToolService} from './tool-service';
import type {UnixPeerIdentityReader} from './unix-peer-identity';
import {requirePlanEntry} from './run-plan';

interface Binding {runId:string;planHash:string;authorizationStamp:string|null;expiresAt:number;timer:ReturnType<typeof setTimeout>;dispose():void}
interface Peer {socket:Socket;buffer:Buffer;controllers:Map<string,{runId:string;abort:AbortController}>;inFlight:number;authenticatedRun?:string}
const rejected=(id:string,error:unknown):BridgeResponse=>({schema:1,id,status:'error',error:{code:error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE',message:error instanceof ApplicationError?error.message:'本次应用调用未完成',layer:'auth',retryable:false,attemptCount:0,retryExhausted:false,effectState:'not-started',nextAction:'核对本次运行与应用状态；不要自动重发写操作'}});

/** Independent host endpoint. Tokens never enter disk, argv, Skill or diagnostics. */
export class ApplicationCliGateway {
  readonly generation=randomUUID();
  private server?:Server;
  private directory='';
  private socketIdentity?:{dev:number;ino:number};
  private closed=false;
  private readonly tokens=new Map<string,Binding>();
  private readonly peers=new Set<Peer>();
  private readonly pending=new Set<Promise<void>>();
  constructor(private readonly runs:CapabilityRunRegistry,private readonly tools:ApplicationToolService,private readonly identities:UnixPeerIdentityReader,private readonly options:{executable:{path:string;sha256:string};now?:()=>number;tokenTtlMs?:number;authorizationStamp?:(context:RunContext)=>string}){
    if(!isAbsolute(options.executable.path)||!/^[a-f0-9]{64}$/.test(options.executable.sha256))throw new ApplicationError('INVALID_INPUT','受管CLI资源身份无效');
    if(tools.invocationEntry!=='cli')throw new ApplicationError('HOST_INCOMPATIBLE','独立CLI端点只能连接CLI能力执行入口');
  }
  private clock(){return this.options.now?.()??Date.now();}
  get endpoint(){if(!this.server||this.closed)throw new ApplicationError('CAPABILITY_UNAVAILABLE','CLI通道尚未启动');return join(this.directory,'cli.sock');}
  private executable():string{
    try{const path=this.options.executable.path,stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024||realpathSync(path)!==path||digest(readFileSync(path))!==this.options.executable.sha256)throw Error();return path;}
    catch{throw new ApplicationError('EXECUTABLE_MISMATCH','受管CLI资源身份已变化');}
  }
  async start():Promise<void>{
    if(this.closed||this.server)throw new ApplicationError('RESOURCE_BUSY','CLI通道不能重复启动');
    if(process.platform!=='darwin')throw new ApplicationError('HOST_INCOMPATIBLE','当前平台尚未验证受管CLI身份');
    this.executable();this.directory=realpathSync(mkdtempSync('/tmp/wy-cli-'+process.getuid!()+'-'));chmodSync(this.directory,0o700);
    const path=join(this.directory,'cli.sock');if(Buffer.byteLength(path)>=100)throw new ApplicationError('INVALID_INPUT','CLI端点超过平台预算');
    const server=createServer(socket=>this.accept(socket));server.maxConnections=64;this.server=server;
    try{await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(path,()=>{server.off('error',fail);ok();});});chmodSync(path,0o600);const stat=lstatSync(path);this.socketIdentity={dev:stat.dev,ino:stat.ino};server.on('error',()=>{for(const peer of this.peers)peer.socket.destroy();});}
    catch{await this.close();throw new ApplicationError('CAPABILITY_UNAVAILABLE','无法建立独立CLI通道');}
  }
  issue(run:OwnedCapabilityRun):{environment:Readonly<{WILLYOU_RUN_TOKEN:string;WILLYOU_ENDPOINT:string}>;expiresAt:number;revoke():void}{
    const endpoint=this.endpoint,context=this.runs.bridgePreparation(run.runId);this.executable();
    if(context.snapshot.schema!==3||!context.plan?.grades.cli||!context.plan.allowed.some(c=>c.entry==='cli'))throw new ApplicationError('ENTRY_NOT_ACTIVE','本次运行没有生效的CLI能力');
    const authorizationStamp=this.options.authorizationStamp?.(context)??null;
    const token=randomBytes(32).toString('hex'),hash=digest(token),expiresAt=this.clock()+Math.min(12*60*60*1000,Math.max(1,this.options.tokenTtlMs??30*60*1000));
    const revoke=()=>{const binding=this.tokens.get(hash);if(!binding)return;this.tokens.delete(hash);clearTimeout(binding.timer);binding.dispose();for(const peer of this.peers)for(const work of peer.controllers.values())if(work.runId===run.runId)work.abort.abort();};
    const timer=setTimeout(revoke,Math.max(1,expiresAt-this.clock()));timer.unref();run.signal.addEventListener('abort',revoke,{once:true});
    this.tokens.set(hash,{runId:run.runId,planHash:context.plan.planHash,authorizationStamp,expiresAt,timer,dispose:()=>run.signal.removeEventListener('abort',revoke)});
    if(run.signal.aborted)revoke();
    return{environment:Object.freeze({WILLYOU_RUN_TOKEN:token,WILLYOU_ENDPOINT:endpoint}),expiresAt,revoke};
  }
  private current(binding:Binding):RunContext{
    if(this.closed||binding.expiresAt<=this.clock())throw new ApplicationError('TOKEN_EXPIRED','本次CLI身份已失效');
    const context=this.runs.assertActive(binding.runId);
    if(context.plan?.planHash!==binding.planHash)throw new ApplicationError('SCOPE_DENIED','CLI身份不能替换固定运行计划');
    return context;
  }
  private async authenticate(peer:Peer,request:ApplicationCliRequest):Promise<RunContext>{
    // Budget/schema, token, kernel identity, executable, exact ancestor birth, entry, then business scope.
    const binding=this.tokens.get(digest(request.token));if(!binding)throw new ApplicationError('AUTH_REQUIRED','本次CLI身份不存在或已撤销');
    if(binding.expiresAt<=this.clock())throw new ApplicationError('TOKEN_EXPIRED','本次CLI身份已过期');
    const identity=await this.identities.read(peer.socket);if(!identity||identity.uid!==process.getuid?.())throw new ApplicationError('PEER_UNVERIFIABLE','无法核验CLI内核对端身份');
    if(identity.peer.executable!==this.executable())throw new ApplicationError('EXECUTABLE_MISMATCH','对端不是本次受管CLI程序');
    if(this.tokens.get(digest(request.token))!==binding)throw new ApplicationError('AUTH_REQUIRED','本次CLI身份已撤销');
    const run=this.runs.get(binding.runId);
    if(!run.pid||!run.processStartedAt||!identity.ancestors.some(p=>p.pid===run.pid&&p.startedAt===run.processStartedAt))throw new ApplicationError('PEER_MISMATCH','CLI对端不属于本次受管进程树');
    const context=this.current(binding);
    if(!context.plan?.grades.cli||!context.plan.allowed.some(c=>c.entry==='cli'))throw new ApplicationError('ENTRY_NOT_ACTIVE','CLI不是本次生效入口');
    if(request.method==='capabilities/call')requirePlanEntry(context.plan,request.call.operation,request.call.contractMajor,'cli');
    if(this.options.authorizationStamp){let current:string|undefined;try{current=this.options.authorizationStamp(context);}catch{/* A removed/disabled binding is an authorization change. */}if(current!==binding.authorizationStamp){this.revokeRun(binding.runId);throw new ApplicationError('SCOPE_DENIED','本次CLI绑定授权已变化，请启动合法的新运行');}}
    peer.authenticatedRun=binding.runId;return context;
  }
  private accept(socket:Socket):void{
    const peer:Peer={socket,buffer:Buffer.alloc(0),controllers:new Map(),inFlight:0};this.peers.add(peer);socket.on('error',()=>{});socket.setTimeout(120000,()=>socket.destroy());
    socket.on('close',()=>{this.peers.delete(peer);for(const work of peer.controllers.values())work.abort.abort();});
    socket.on('data',chunk=>{
      peer.buffer=Buffer.concat([peer.buffer,chunk]);
      while(peer.buffer.length){const end=peer.buffer.indexOf(10);if(end<0){if(peer.buffer.length>BRIDGE_LIMITS.requestBytes)socket.destroy();return;}if(end>BRIDGE_LIMITS.requestBytes||peer.inFlight>=16){socket.destroy();return;}
        const bytes=peer.buffer.subarray(0,end);peer.buffer=peer.buffer.subarray(end+1);peer.inFlight++;
        const work=this.receive(peer,bytes).then(response=>{if(!socket.destroyed){const output=JSON.stringify(response);if(Buffer.byteLength(output)>BRIDGE_LIMITS.responseBytes){socket.destroy();return;}socket.write(output+'\n');}},()=>{socket.destroy();}).finally(()=>{peer.inFlight--;});
        this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});
      }
    });
  }
  private denial(peer:Peer,id:string,method:string,error:unknown):BridgeResponse{
    const response=rejected(id,error);if(response.status!=='error')return response;
    try{const auditId=randomUUID();this.runs.store.sqlite.prepare('INSERT INTO capability_broker_denials(audit_id,host_generation,run_id,bridge_id,method,error_code,observed_at) VALUES(?,?,?,?,?,?,?)').run(auditId,this.generation,peer.authenticatedRun??null,null,method,response.error.code,new Date(this.clock()).toISOString());response.auditId=auditId;}
    catch{response.auditUnavailable=true;}
    return response;
  }
  private async receive(peer:Peer,bytes:Buffer):Promise<BridgeResponse>{
    let id=randomUUID() as string,method='cli-parse';
    try{
      if(!Buffer.from(bytes.toString('utf8')).equals(bytes))throw new ApplicationError('INVALID_INPUT','CLI请求必须是完整UTF-8');
      const value:unknown=JSON.parse(bytes.toString('utf8'));if(!boundedJson(value))throw new ApplicationError('INVALID_INPUT','CLI请求超过结构预算');
      const parsed=cliRequestSchema.safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','CLI协议或请求字段无效');
      const request=parsed.data;id=request.id;method=request.method==='capabilities/list'?'cli-list':request.method==='capabilities/call'?'cli-call':'cli-cancel';
      const context=await this.authenticate(peer,request);
      if(request.method==='capabilities/list'){const result=await this.tools.list(context.run.runId);return{schema:1,id,status:'ok',value:{capabilities:result.tools.map(({name,...tool})=>({id:name,...tool,command:context.plan!.allowed.find(c=>c.capabilityId===name&&c.entry==='cli')!.cliCommand})),unavailable:result.unavailable}};}
      if(request.method==='cancel'){const work=peer.controllers.get(request.targetId);if(work?.runId===context.run.runId)work.abort.abort();return{schema:1,id,status:'ok',value:{cancelled:!!work}};}
      if(peer.controllers.has(id))throw new ApplicationError('REQUEST_CONFLICT','本连接正在执行同编号调用');
      const abort=new AbortController();peer.controllers.set(id,{runId:context.run.runId,abort});
      try{return await this.tools.call(context.run.runId,id,request.call,abort.signal);}finally{peer.controllers.delete(id);}
    }catch(error){return this.denial(peer,id,method,error instanceof SyntaxError?new ApplicationError('INVALID_INPUT','CLI请求JSON无效'):error);}
  }
  revokeRun(runId:string):void{
    for(const[hash,binding]of this.tokens)if(binding.runId===runId){this.tokens.delete(hash);clearTimeout(binding.timer);binding.dispose();}
    for(const peer of this.peers)for(const work of peer.controllers.values())if(work.runId===runId)work.abort.abort();this.tools.clearMemory(runId);
  }
  async close():Promise<void>{
    if(this.closed)return;this.closed=true;for(const binding of this.tokens.values()){clearTimeout(binding.timer);binding.dispose();}this.tokens.clear();for(const peer of this.peers)peer.socket.destroy();
    if(this.server)await new Promise<void>(ok=>this.server!.close(()=>ok()));await Promise.allSettled([...this.pending]);
    try{const path=join(this.directory,'cli.sock'),stat=lstatSync(path);if(stat.isSocket()&&!stat.isSymbolicLink()&&stat.dev===this.socketIdentity?.dev&&stat.ino===this.socketIdentity.ino)unlinkSync(path);}catch{/* Retain unknown replacements. */}
    try{if(this.directory)rmdirSync(this.directory);}catch{/* Never recursively delete unknown entries. */}
  }
}

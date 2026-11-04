import {spawn,type ChildProcess} from 'node:child_process';
import {lstatSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import type {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {boundedJson} from '@shared/application-bridge';
import {canonicalJson,digest} from '../manifest';

export interface UpstreamMapping {
  semantics:'read'|'write'; input:z.ZodType;output:z.ZodType;
  /** Compiled scope predicate; a JSON schema is not an authorization boundary. */
  inScope(args:Record<string,unknown>,scope:Readonly<Record<string,string>>):boolean;
  tool?:string;command?:readonly string[];
  arguments(args:Record<string,unknown>,protection:string|null):Record<string,unknown>;
}
/** Host-compiled declarations only. No path, command, mapping or scope is accepted from an Agent. */
export interface UpstreamDefinition {
  id:string;kind:'mcp'|'cli';command:string;args:readonly string[];
  resources:readonly {path:string;sha256:string}[];versions:readonly string[];
  isolation:'private-home-xdg';environment?:Readonly<Record<string,string>>;
  capabilities:Readonly<Record<string,UpstreamMapping>>;
}
export interface UpstreamConnection {id:string;revision:number;scope:Readonly<Record<string,string>>;credential:string|null}
interface Session {key:string;connectionId:string;revision:number;definition:UpstreamDefinition;scope:Readonly<Record<string,string>>;directory:string;directoryIdentity:{dev:number;ino:number};environment:Record<string,string>;owners:Set<object>;retired:boolean;abort:AbortController;client?:Client;transport?:StdioClientTransport;opening:Promise<void>;pending:Set<Promise<unknown>>;closing?:Promise<void>}
export class UpstreamSessionPool {
  private readonly sessions=new Map<string,Session>();private closed=false;
  constructor(private readonly root:string){}
  private verify(definition:UpstreamDefinition){
    if(definition.isolation!=='private-home-xdg'||!isAbsolute(definition.command)||!definition.versions.length||!definition.resources.some(r=>r.path===definition.command))throw new ApplicationError('HOST_INCOMPATIBLE','上游工具不支持私有配置或缺少固定版本资源');
    for(const resource of definition.resources){const stat=lstatSync(resource.path);if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(resource.path)!==resource.path||stat.size>128*1024*1024||digest(readFileSync(resource.path))!==resource.sha256)throw new ApplicationError('EXECUTABLE_MISMATCH','上游工具资源身份变化');}
    if(definition.args.some(arg=>arg.includes('\0'))||Object.keys(definition.environment??{}).some(name=>!/^[A-Z][A-Z0-9_]{0,63}$/.test(name)||['HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','TMPDIR','WILLYOU_RUN_TOKEN','WILLYOU_ENDPOINT','NODE_OPTIONS','NODE_PATH','DYLD_INSERT_LIBRARIES'].includes(name)))throw new ApplicationError('INVALID_INPUT','上游环境声明无效');
  }
  async acquire(definition:UpstreamDefinition,connection:UpstreamConnection){
    if(this.closed)throw new ApplicationError('CANCELED','上游会话池已停止');this.verify(definition);
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(connection.id)||!Number.isSafeInteger(connection.revision)||connection.revision<1||!boundedJson(connection.scope)||Object.values(connection.scope).some(v=>typeof v!=='string'))throw new ApplicationError('INVALID_INPUT','上游连接身份或范围无效');
    const key=digest(canonicalJson({adapter:definition.id,kind:definition.kind,resources:definition.resources,args:definition.args,versions:definition.versions,connection:connection.id,revision:connection.revision,scope:connection.scope}));
    for(const prior of this.sessions.values())if(prior.connectionId===connection.id&&prior.revision!==connection.revision){prior.retired=true;void this.collect(prior);}
    let session=this.sessions.get(key);
    if(session?.retired)throw new ApplicationError('REVISION_CONFLICT','原上游会话已撤销');
    if(!session){
      mkdirSync(this.root,{recursive:true,mode:0o700});const directory=realpathSync(mkdtempSync(join(this.root,'connection-'))),stat=lstatSync(directory);
      writeFileSync(join(directory,'credential.json'),JSON.stringify({credential:connection.credential}),{mode:0o600,flag:'wx'});
      const environment={...definition.environment,HOME:directory,XDG_CONFIG_HOME:directory,XDG_CACHE_HOME:directory,TMPDIR:directory,PATH:dirname(definition.command)+':/usr/bin:/bin',LANG:'en_US.UTF-8',WILLYOU_UPSTREAM_CREDENTIAL_FILE:join(directory,'credential.json')};
      session={key,connectionId:connection.id,revision:connection.revision,definition,scope:Object.freeze({...connection.scope}),directory,directoryIdentity:{dev:stat.dev,ino:stat.ino},environment,owners:new Set(),retired:false,abort:new AbortController(),opening:Promise.resolve(),pending:new Set()};this.sessions.set(key,session);session.opening=this.open(session);void session.opening.catch(()=>{session!.retired=true;void this.collect(session!);});
    }
    const selected=session,owner={};selected.owners.add(owner);let released=false;const calls=new Set<AbortController>();
    const release=async()=>{if(released)return;released=true;for(const call of calls)call.abort();selected.owners.delete(owner);await this.collect(selected);};
    try{await selected.opening;}catch(error){
      await release();
      // These errors are created by this host with fixed, credential-free messages.
      // Keep a known incompatibility/cancellation distinct from transport failure;
      // never forward raw SDK, process or upstream diagnostics.
      if(error instanceof ApplicationError)throw error;
      throw new ApplicationError('CONNECTION_UNAVAILABLE','上游连接未就绪');
    }
    return{key: selected.key,directory:selected.directory,invoke:async(capabilityId:string,args:unknown,options:{signal:AbortSignal;deadline:number;operationId:string;protection?:string|null})=>{
      if(released||selected.retired||selected.abort.signal.aborted)throw new ApplicationError('CANCELED','上游会话授权已结束');
      const mapping=selected.definition.capabilities[capabilityId];if(!mapping)throw new ApplicationError('SCOPE_DENIED','上游能力未在受信映射中声明');
      const parsed=mapping.input.safeParse(args);if(!parsed.success||!boundedJson(parsed.data)||!parsed.data||typeof parsed.data!=='object'||Array.isArray(parsed.data))throw new ApplicationError('INVALID_INPUT','上游参数不符合固定契约');
      const input=parsed.data as Record<string,unknown>;if(!mapping.inScope(input,selected.scope))throw new ApplicationError('SCOPE_DENIED','请求超出上游资源范围');
      if(mapping.semantics==='write'&&!options.protection)throw new ApplicationError('AUTHORIZATION_REQUIRED','上游写入缺少业务防重标识');
      const abort=new AbortController();calls.add(abort);const timeout=AbortSignal.timeout(Math.max(1,Math.min(120000,options.deadline-Date.now()))),signal=AbortSignal.any([abort.signal,options.signal,selected.abort.signal,timeout]);
      const work=this.invoke(selected,mapping,input,options.protection??null,signal,timeout);selected.pending.add(work);
      try{return await work;}finally{calls.delete(abort);selected.pending.delete(work);await this.collect(selected);}
    },release};
  }
  private async open(session:Session){
    const definition=session.definition;
    if(definition.kind==='mcp'){
      const transport=new StdioClientTransport({command:definition.command,args:[...definition.args],env:session.environment,cwd:session.directory,stderr:'pipe',maxBufferSize:1024*1024});session.transport=transport;transport.stderr?.on('data',()=>{});
      const client=new Client({name:'WillYou 受管上游',version:'1.0.0'},{capabilities:{},listMaxPages:4,enforceStrictCapabilities:true});session.client=client;
      await client.connect(transport,{signal:session.abort.signal,timeout:5000});if(!definition.versions.includes(client.getServerVersion()?.version??''))throw new ApplicationError('HOST_INCOMPATIBLE','上游MCP版本未声明');
    }else{
      const result=await this.process(session,[...definition.args,'--version'],session.abort.signal,5000);if(result.code!==0||!definition.versions.includes(result.stdout.trim()))throw new ApplicationError('HOST_INCOMPATIBLE','上游CLI版本未声明');
    }
  }
  private async invoke(session:Session,mapping:UpstreamMapping,input:Record<string,unknown>,protection:string|null,signal:AbortSignal,timeout:AbortSignal){
    let submitted=false;
    try{
      signal.throwIfAborted();this.verify(session.definition);const args=mapping.arguments(input,protection);if(!boundedJson(args))throw new ApplicationError('INVALID_INPUT','上游参数映射超过预算');let data:unknown;
      if(session.definition.kind==='mcp'){
        if(!mapping.tool||mapping.command)throw new ApplicationError('HOST_INCOMPATIBLE','上游MCP映射无效');submitted=true;
        const result=await session.client!.callTool({name:mapping.tool,arguments:args},{signal,timeout:120000});
        if(!boundedJson(result)||result.isError)throw new ApplicationError('INVALID_RESPONSE','上游MCP返回受控失败');
        data=result.structuredContent??JSON.parse((result.content.find(item=>item.type==='text') as {text?:string}|undefined)?.text??'null');
      }else{
        if(!mapping.command||mapping.tool)throw new ApplicationError('HOST_INCOMPATIBLE','上游CLI映射无效');submitted=true;
        const result=await this.process(session,[...session.definition.args,...mapping.command,'--json',JSON.stringify(args)],signal,120000);if(result.code!==0)throw new ApplicationError('INVALID_RESPONSE','上游CLI返回受控失败');data=JSON.parse(result.stdout);
      }
      if(!boundedJson(data)||Buffer.byteLength(JSON.stringify(data))>1024*1024)throw new ApplicationError('INVALID_RESPONSE','上游结果超过预算');const parsed=mapping.output.safeParse(data);if(!parsed.success)throw new ApplicationError('INVALID_RESPONSE','上游结果不符合固定契约');return parsed.data;
    }catch(error){
      if(mapping.semantics==='write'&&submitted)throw new ApplicationError('UPSTREAM_RESULT_UNKNOWN','上游写入可能生效，请按原业务防重标识查询，不要重发');
      if(signal.aborted)throw new ApplicationError(timeout.aborted&&signal.reason===timeout.reason?'TIMEOUT':'CANCELED','上游读取已中断');
      if(error instanceof ApplicationError)throw error;throw new ApplicationError('INVALID_RESPONSE','上游结果无法按固定契约读取');
    }
  }
  private process(session:Session,args:string[],signal:AbortSignal,timeoutMs:number):Promise<{code:number;stdout:string}>{
    return new Promise((ok,fail)=>{
      let child:ChildProcess|undefined,bytes=0,finished=false,reason:unknown;const chunks:Buffer[]=[];const abort=()=>{reason=new ApplicationError('CANCELED','本次上游子进程已取消');terminate();};let force:ReturnType<typeof setTimeout>|undefined;
      const terminate=()=>{if(!child?.pid||finished)return;try{process.kill(-child.pid,'SIGTERM');}catch{}if(!force){force=setTimeout(()=>{if(!finished&&child?.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}},300);force.unref();}};
      const timer=setTimeout(()=>{reason=new ApplicationError('TIMEOUT','上游子进程超时');terminate();},timeoutMs);timer.unref();
      const cleanup=()=>{finished=true;clearTimeout(timer);if(force)clearTimeout(force);signal.removeEventListener('abort',abort);};
      try{signal.throwIfAborted();child=spawn(session.definition.command,args,{cwd:session.directory,env:session.environment,stdio:['ignore','pipe','pipe'],shell:false,detached:true,windowsHide:true});child.stderr?.on('data',()=>{});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        child.stdout?.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024){reason=new ApplicationError('TOO_LARGE','上游输出超过预算');terminate();}else chunks.push(Buffer.from(chunk));});
        child.once('error',error=>{cleanup();fail(error);});child.once('close',code=>{cleanup();const data=Buffer.concat(chunks),text=data.toString('utf8');if(!reason&&!data.equals(Buffer.from(text)))reason=new ApplicationError('INVALID_RESPONSE','上游输出不是完整UTF-8');reason?fail(reason):ok({code:code??-1,stdout:text});});
      }catch(error){cleanup();fail(error);}
    });
  }
  async rotateConnection(id:string,revision:number){for(const session of this.sessions.values())if(session.connectionId===id&&session.revision!==revision){session.retired=true;await this.collect(session);}}
  async retireConnection(id:string){for(const session of this.sessions.values())if(session.connectionId===id){session.retired=true;session.abort.abort();}await Promise.all([...this.sessions.values()].filter(s=>s.connectionId===id).map(s=>this.collect(s)));}
  private async collect(session:Session){
    if(!session.retired||session.owners.size||session.pending.size)return;
    if(!session.closing)session.closing=(async()=>{try{await session.opening;}catch{}await session.client?.close();await session.transport?.close();const stat=lstatSync(session.directory,{throwIfNoEntry:false});if(stat&&!stat.isSymbolicLink()&&stat.dev===session.directoryIdentity.dev&&stat.ino===session.directoryIdentity.ino)rmSync(session.directory,{recursive:true});this.sessions.delete(session.key);})();return session.closing;
  }
  async close(){if(this.closed)return;this.closed=true;const sessions=[...this.sessions.values()];for(const session of sessions){session.retired=true;session.abort.abort();session.owners.clear();}await Promise.all(sessions.flatMap(s=>[...s.pending].map(p=>p.catch(()=>{}))));await Promise.all(sessions.map(s=>this.collect(s)));}
  status(){return[...this.sessions.values()].map(s=>({key:s.key,connectionId:s.connectionId,revision:s.revision,references:s.owners.size,pending:s.pending.size,retired:s.retired,pid:s.transport?.pid??null}));}
}

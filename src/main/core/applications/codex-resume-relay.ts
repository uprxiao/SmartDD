import {createServer,type Server} from 'node:http';
import {Socket} from 'node:net';
import WebSocket,{WebSocketServer} from 'ws';
import {ApplicationError} from '@shared/applications';
import {PrivateAgentEndpoint} from './private-agent-endpoint';
import type {CodexPermissionKey} from './codex-client-args';

type JsonObject=Record<string,unknown>;
const object=(v:unknown):v is JsonObject=>!!v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>new ApplicationError('INVALID_RESPONSE','Codex 恢复权限未能准确交付');

/** Exact 0.167.1 config/read -> thread/resume projection. Defaults absent from
 * the original invocation are not converted into explicit permission choices.
 * Config values come from the isolated native server after its own validation.
 */
export function codexResumePermissions(response:unknown,keys:readonly CodexPermissionKey[]):JsonObject{
  if(!object(response)||!object(response.config))throw invalid();
  const config=response.config,result:JsonObject={},overrides:JsonObject={};
  for(const key of keys){
    if(!Object.hasOwn(config,key)||config[key]===undefined)throw invalid();
    overrides[key]=config[key];
  }
  if(keys.includes('approval_policy'))result.approvalPolicy=config.approval_policy;
  if(keys.includes('approvals_reviewer'))result.approvalsReviewer=config.approvals_reviewer;
  if(keys.includes('sandbox_mode')){
    if(!['read-only','workspace-write','danger-full-access'].includes(config.sandbox_mode as string))throw invalid();
    result.sandbox=config.sandbox_mode;
  }else if(keys.includes('default_permissions')){
    if(typeof config.default_permissions!=='string'||!config.default_permissions)throw invalid();
    result.permissions=config.default_permissions;
  }
  if(Object.keys(overrides).length)result.config=overrides;
  // Clone native JSON; never retain a mutable reference to an observed response.
  return JSON.parse(JSON.stringify(result));
}

/** A per-run local transport shim for one initial, host-selected resume. All
 * approval requests and their replies travel unchanged between native TUI and
 * native server. This component never starts a turn or answers an approval.
 */
export class CodexResumeRelay {
  readonly endpoint:PrivateAgentEndpoint;
  private readonly http:Server=createServer((_req,res)=>{res.writeHead(404);res.end();});
  private readonly ws=new WebSocketServer({noServer:true,maxPayload:16*1024*1024});
  private readonly peers=new Set<WebSocket>();
  private listening=false;
  private closed=false;
  private claimed=false;
  private stopWork?:Promise<void>;
  constructor(private readonly input:{storeId:string;runId:string;threadId:string;upstream:string;verifyUpstream:()=>void;permissions:()=>JsonObject;allow:()=>boolean;observe?:(receipt:JsonObject)=>void}){
    if(!/^[a-f0-9-]{36}$/.test(input.threadId))throw invalid();
    this.endpoint=new PrivateAgentEndpoint({storeId:input.storeId,runId:input.runId});
    this.http.on('error',()=>{if(this.listening)void this.stop().catch(()=>{});});
    this.http.on('upgrade',(request,socket,head)=>{
      try{this.endpoint.verifySocket();if(this.closed||!this.input.allow()||request.url!=='/rpc'||this.peers.size>=8)throw invalid();this.ws.handleUpgrade(request,socket,head,peer=>{void this.connect(peer);});}
      catch{socket.destroy();}
    });
  }
  get url():string{return this.endpoint.url;}
  async start():Promise<void>{
    if(this.listening||this.closed)throw invalid();this.endpoint.verify();
    await new Promise<void>((resolve,reject)=>{const failed=(error:Error)=>{this.http.off('listening',ready);reject(error);},ready=()=>{this.http.off('error',failed);resolve();};this.http.once('error',failed);this.http.once('listening',ready);this.http.listen(this.endpoint.path);});
    this.listening=true;this.endpoint.verifySocket();
  }
  private async connect(client:WebSocket):Promise<void>{
    this.peers.add(client);let upstream:WebSocket|undefined;
    const close=()=>{client.terminate();upstream?.terminate();this.peers.delete(client);if(upstream)this.peers.delete(upstream);};
    client.on('error',close);client.on('close',close);
    // Pause before asynchronous peer setup; no first initialize frame is lost.
    const nativeSocket=(client as WebSocket&{_socket?:Socket})._socket;nativeSocket?.pause();
    try{
      if(this.closed||!this.input.allow())throw invalid();this.input.verifyUpstream();
      upstream=new WebSocket('ws+unix://'+this.input.upstream.replace(/^unix:\/\//,'')+':/',{maxPayload:16*1024*1024,handshakeTimeout:2000});this.peers.add(upstream);
      upstream.on('error',close);upstream.on('close',close);
      let resumeId:string|number|undefined;
      upstream.on('message',(bytes,binary)=>{
        if(!this.input.allow()){close();return;}
        try{
          // Inspect only the response to the single request changed below.
          // Native requests (including approvals) remain byte-for-byte opaque.
          if(resumeId!==undefined&&!binary){
            const message=JSON.parse(bytes.toString());
            // JSON-RPC IDs are independent in each direction. A server request
            // can have the same ID as our pending client resume request.
            if(object(message)&&message.id===resumeId&&!Object.hasOwn(message,'method')){
              const result=Object.hasOwn(message,'result'),error=Object.hasOwn(message,'error');
              if(result===error)throw invalid();
              if(result){if(!object(message.result)||!object(message.result.thread)||message.result.thread.id!==this.input.threadId)throw invalid();this.claimed=true;}
              this.input.observe?.({threadId:this.input.threadId,result:message.result,error:message.error});resumeId=undefined;
            }
          }
          if(client.readyState===WebSocket.OPEN)client.send(bytes,{binary});
        }catch{close();}
      });
      await new Promise<void>((resolve,reject)=>{upstream!.once('open',()=>resolve());upstream!.once('error',reject);upstream!.once('close',()=>reject(invalid()));});
      if(this.closed||!this.input.allow())throw invalid();this.input.verifyUpstream();
      client.on('message',(bytes,binary)=>{
        if(!this.input.allow()){close();return;}
        try{
          let payload:WebSocket.RawData|string=bytes;
          if(!binary){
            const message=JSON.parse(bytes.toString());
            if(object(message)&&message.method==='thread/resume'&&!this.claimed){
              const params=message.params;
              if(!object(params)||params.threadId!==this.input.threadId||params.history!=null||params.path!=null&&params.path!==''||!['string','number'].includes(typeof message.id))throw invalid();
              // A failed/lost preparation is still the initial resume. Keep
              // delivering its selected permissions until native success.
              resumeId=message.id as string|number;
              // Host-frozen permission choices take precedence; preserve all
              // unrelated model/cwd/history fields sent by the native TUI.
              const permissions=this.input.permissions();
              message.params={...params,...permissions,config:{...(object(params.config)?params.config:{}),...(permissions.config as JsonObject??{})}};
              payload=JSON.stringify(message);this.input.observe?.({threadId:this.input.threadId,request:message.params});
            }
          }
          if(upstream!.readyState!==WebSocket.OPEN)throw invalid();upstream!.send(payload,{binary});
        }catch{close();}
      });
      nativeSocket?.resume();
    }catch{close();}
  }
  stop():Promise<void>{
    if(this.stopWork)return this.stopWork;this.closed=true;for(const peer of this.peers)peer.terminate();this.peers.clear();
    this.stopWork=(async()=>{if(this.listening)await new Promise<void>(resolve=>this.http.close(()=>resolve()));this.ws.close();this.endpoint.release();})();return this.stopWork;
  }
}

import {spawn} from 'node:child_process';
import type {Socket} from 'node:net';
import {z} from 'zod';
const pid=z.number().int().positive().max(2147483647),birth=z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/);
const identity=z.object({pid,startedAt:birth});
const schema=z.discriminatedUnion('state',[
 z.object({schema:z.literal(2),state:z.literal('unknown')}).strict(),
 z.object({schema:z.literal(2),state:z.literal('running'),uid:z.number().int().nonnegative(),peer:identity.extend({executable:z.string().min(1).max(4096).refine(path=>path.startsWith('/')&&!/[\x00\r\n]/.test(path))}).strict(),ancestors:z.array(identity.extend({ppid:z.number().int().nonnegative().max(2147483647)}).strict()).min(1).max(64)}).strict(),
]);
export type UnixPeerIdentity=Extract<z.infer<typeof schema>,{state:'running'}>;
export interface UnixPeerIdentityReader {read(socket:Socket):Promise<UnixPeerIdentity|null>}
/** The inherited socket belongs to this accept handler; no client-provided PID is inspected. */
export class MacUnixPeerIdentityReader implements UnixPeerIdentityReader {
 constructor(private readonly helper:string){}
 async read(socket:Socket):Promise<UnixPeerIdentity|null>{
  if(process.platform!=='darwin'||socket.destroyed)return null;
  // Narrow, guarded Node adapter: passing Socket itself as stdio transfers/pauses
  // its readable side. A numeric inherited descriptor leaves the host stream alone.
  const fd=(socket as Socket & {_handle?:{fd?:number}})._handle?.fd;if(!Number.isInteger(fd)||fd!<0)return null;
  try{
   // Only this accepted socket's descriptor is inherited; no PID/fd comes from RPC.
   const raw=await new Promise<Buffer|null>(resolve=>{let child:ReturnType<typeof spawn>;try{child=spawn(this.helper,['--peer-fd','3'],{windowsHide:true,stdio:['ignore','pipe','ignore',fd!]});}catch{resolve(null);return;}let bytes=Buffer.alloc(0),failed=false;const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');},2000);timer.unref();child.once('error',()=>{failed=true;});child.stdout?.on('error',()=>{failed=true;});child.stdout?.on('data',chunk=>{if(bytes.length+chunk.length>16384){failed=true;child.kill('SIGKILL');}else bytes=Buffer.concat([bytes,chunk]);});child.once('close',code=>{clearTimeout(timer);resolve(!failed&&code===0?bytes:null);});});
   if(!raw)return null;const value=schema.parse(JSON.parse(raw.toString('utf8')));
   if(value.state!=='running'||value.uid!==process.getuid?.()||value.peer.pid!==value.ancestors[0].pid||value.peer.startedAt!==value.ancestors[0].startedAt||new Set(value.ancestors.map(item=>item.pid)).size!==value.ancestors.length||value.ancestors.some((item,index)=>index+1<value.ancestors.length&&item.ppid!==value.ancestors[index+1].pid))return null;
   return value;
  }catch{return null;}
 }
}

import {mkdtempSync,realpathSync,readFileSync,readdirSync,lstatSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Client} from '@modelcontextprotocol/client';
import {UpstreamSessionPool,type UpstreamDefinition} from '../upstream/session-pool';
import {digest} from '../manifest';
let root:string,pool:UpstreamSessionPool,leases:Awaited<ReturnType<UpstreamSessionPool['acquire']>>[];
const input=z.object({key:z.string(),value:z.string().optional(),expectedRevision:z.number().int().nonnegative().optional(),delayMs:z.number().int().min(0).max(2000).optional()}).strict(),output=z.object({key:z.string(),value:z.string().nullable(),revision:z.number().int(),operationId:z.string().nullable()}).strict();
function definition(kind:'mcp'|'cli'):UpstreamDefinition{
 const command=realpathSync(process.execPath),script=realpathSync(resolve('resources/application-upstreams/sample-kv.cjs'));
 return{id:'reference-'+kind,kind,command,args:[script,kind],resources:[command,script].map(path=>({path,sha256:digest(readFileSync(path))})),versions:['1.0.0'],isolation:'private-home-xdg',environment:{ELECTRON_RUN_AS_NODE:'1',WILLYOU_SAMPLE_DATA:join(root,'service'),WILLYOU_SAMPLE_AUDIT:join(root,'audit.jsonl')},capabilities:Object.fromEntries(['read','write'].map(semantics=>['sample-kv.entry.'+semantics,{semantics:semantics as 'read'|'write',input,output,inScope:(args,scope)=>String(args.key).startsWith(scope.prefix),...(kind==='mcp'?{tool:semantics==='read'?'kv_get':'kv_put'}:{command:[semantics==='read'?'kv_get':'kv_put']}),arguments:(args,protection)=>({...args,...(semantics==='write'?{operationId:protection}:{})})}]))};
}
async function acquire(kind:'mcp'|'cli'='mcp',revision=1){const lease=await pool.acquire(definition(kind),{id:'connection-1',revision,scope:{prefix:'allowed:'},credential:'SYNTHETIC_'+revision});leases.push(lease);return lease;}
const options=(signal=new AbortController().signal,ms=2000)=>({signal,deadline:Date.now()+ms,operationId:randomUUID()});
const audit=()=>existsSync(join(root,'audit.jsonl'))?readFileSync(join(root,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(text=>JSON.parse(text) as Record<string,unknown>):[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m11-upstream-')));mkdirSync(join(root,'global-home'));pool=new UpstreamSessionPool(join(root,'sessions'));leases=[];});
afterEach(async()=>{for(const lease of leases)await lease.release();await pool.close();expect(pool.status()).toEqual([]);rmSync(root,{recursive:true,force:true});});

describe('M11 reference upstream contracts with actual stdio MCP and CLI processes',()=>{
 it.each(['mcp','cli'] as const)('isolates %s credentials/config and maps only trusted capabilities',async kind=>{
  const lease=await acquire(kind);expect(lstatSync(lease.directory).mode&0o777).toBe(0o700);expect(lstatSync(join(lease.directory,'credential.json')).mode&0o777).toBe(0o600);
  const before=audit().length;await expect(lease.invoke('not.discovered.tool',{key:'allowed:one'},options())).rejects.toMatchObject({code:'SCOPE_DENIED'});await expect(lease.invoke('sample-kv.entry.read',{key:'outside:one'},options())).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(audit()).toHaveLength(before);
  expect(await lease.invoke('sample-kv.entry.read',{key:'allowed:one'},options())).toEqual({key:'allowed:one',value:null,revision:0,operationId:null});expect(audit().every(row=>row.home===lease.directory)).toBe(true);expect(JSON.stringify(pool.status())).not.toContain('SYNTHETIC_');
 });
 it('shares one connection/revision/scope session and canceling A leaves B running',async()=>{
  const a=await acquire(),b=await acquire();expect(a.key).toBe(b.key);expect(pool.status()[0].references).toBe(2);
  const one=a.invoke('sample-kv.entry.read',{key:'allowed:a',delayMs:600},options()).catch(e=>e),two=b.invoke('sample-kv.entry.read',{key:'allowed:b',delayMs:150},options());await new Promise<void>(ok=>setTimeout(ok,35));await a.release();expect(await one).toMatchObject({code:'CANCELED'});expect(await two).toMatchObject({key:'allowed:b'});expect(pool.status()[0].references).toBe(1);
 });
 it('opens a new revision while old in-flight work finishes and then closes its old process',async()=>{
  const old=await acquire(),first=old.invoke('sample-kv.entry.read',{key:'allowed:old',delayMs:150},options());const fresh=await acquire('mcp',2);expect(fresh.key).not.toBe(old.key);expect(fresh.directory).not.toBe(old.directory);expect(pool.status()).toHaveLength(2);expect(await first).toMatchObject({key:'allowed:old'});await old.release();expect(pool.status()).toHaveLength(1);expect(existsSync(old.directory)).toBe(false);expect(await fresh.invoke('sample-kv.entry.read',{key:'allowed:new'},options())).toMatchObject({key:'allowed:new'});
 });
 it('returns unknown for a submitted write timeout and queries its business key without resending',async()=>{
  const lease=await acquire(),protection=randomUUID();await expect(lease.invoke('sample-kv.entry.write',{key:'allowed:write',value:'once',expectedRevision:0,delayMs:400},{...options(undefined,40),protection})).rejects.toMatchObject({code:'UPSTREAM_RESULT_UNKNOWN'});
  expect(await lease.invoke('sample-kv.entry.read',{key:'allowed:write'},options())).toEqual({key:'allowed:write',value:'once',revision:1,operationId:protection});expect(audit().filter(row=>row.event==='invoke'&&row.name==='kv_put')).toHaveLength(1);
 });
 it('cancels the actual owned CLI process and waits for exit before releasing the invocation',async()=>{
  const lease=await acquire('cli'),abort=new AbortController(),work=lease.invoke('sample-kv.entry.read',{key:'allowed:cancel',delayMs:1000},options(abort.signal)).catch(e=>e);await new Promise<void>(ok=>setTimeout(ok,100));abort.abort();expect(await work).toMatchObject({code:'CANCELED'});expect(pool.status()[0].pending).toBe(0);
  for(const row of audit().filter(row=>row.event==='invoke'))expect(()=>process.kill(row.pid as number,0)).toThrow();
 });
 it('refuses unisolatable tools, inherited run tokens and unsupported tool versions',async()=>{
  const base=definition('cli');await expect(pool.acquire({...base,isolation:'global' as 'private-home-xdg'},{id:'c',revision:1,scope:{prefix:'allowed:'},credential:null})).rejects.toMatchObject({code:'HOST_INCOMPATIBLE'});
  await expect(pool.acquire({...base,environment:{WILLYOU_RUN_TOKEN:'must-not-inherit'}},{id:'c',revision:1,scope:{prefix:'allowed:'},credential:null})).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(pool.acquire({...base,versions:['9.9.9']},{id:'c',revision:1,scope:{prefix:'allowed:'},credential:'SYNTHETIC_VERSION'})).rejects.toMatchObject({code:'HOST_INCOMPATIBLE',message:'上游CLI版本未声明'});
 });
 it.each(['mcp','cli'] as const)('keeps the controlled %s incompatibility reason and removes its private credential',async kind=>{
  const unsupported={...definition(kind),versions:['9.9.9']};
  await expect(pool.acquire(unsupported,{id:'version-negative',revision:1,scope:{prefix:'allowed:'},credential:'SYNTHETIC_VERSION_PRIVATE'})).rejects.toMatchObject({code:'HOST_INCOMPATIBLE',message:kind==='mcp'?'上游MCP版本未声明':'上游CLI版本未声明'});
  expect(pool.status()).toEqual([]);
  expect(readdirSync(join(root,'sessions'))).toEqual([]);
 });
 it('does not forward an untrusted SDK startup diagnostic containing credentials',async()=>{
  const diagnostic='SYNTHETIC_PRIVATE_SDK_DIAGNOSTIC',connect=vi.spyOn(Client.prototype,'connect').mockRejectedValueOnce(new Error(diagnostic));
  try{
   const error=await pool.acquire(definition('mcp'),{id:'sdk-error',revision:1,scope:{prefix:'allowed:'},credential:diagnostic}).catch(error=>error);
   expect(error).toMatchObject({code:'CONNECTION_UNAVAILABLE',message:'上游连接未就绪'});
   expect(String(error)).not.toContain(diagnostic);expect(JSON.stringify(error)).not.toContain(diagnostic);
   expect(pool.status()).toEqual([]);expect(readdirSync(join(root,'sessions'))).toEqual([]);
  }finally{connect.mockRestore();}
 });
 it('closes all active sessions and removes private credentials on host disposal',async()=>{
  const mcp=await acquire(),cli=await acquire('cli'),a=mcp.invoke('sample-kv.entry.read',{key:'allowed:m',delayMs:1000},options()).catch(e=>e),b=cli.invoke('sample-kv.entry.read',{key:'allowed:c',delayMs:1000},options()).catch(e=>e);await new Promise<void>(ok=>setTimeout(ok,100));await pool.close();expect(await a).toMatchObject({code:'CANCELED'});expect(await b).toMatchObject({code:'CANCELED'});expect(existsSync(mcp.directory)).toBe(false);expect(existsSync(cli.directory)).toBe(false);
 });
});

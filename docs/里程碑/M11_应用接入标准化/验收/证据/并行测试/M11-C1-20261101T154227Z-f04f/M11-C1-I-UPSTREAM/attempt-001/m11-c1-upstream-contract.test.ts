import {mkdtempSync,realpathSync,readFileSync,existsSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {UpstreamSessionPool,type UpstreamDefinition} from '../upstream/session-pool';
import {digest} from '../manifest';
let root:string,pool:UpstreamSessionPool,leases:Awaited<ReturnType<UpstreamSessionPool['acquire']>>[],hashes:{path:string;sha256:string}[];
const input=z.object({cursor:z.string().nullable().optional(),literal:z.string().optional(),fault:z.string().optional()}).strict();
const output=z.object({records:z.array(z.object({id:z.string(),raw:z.string()}).strict()),nextCursor:z.string().nullable()}).strict();
const options=()=>({signal:new AbortController().signal,deadline:Date.now()+3000,operationId:randomUUID()});
const audit=()=>existsSync(join(root,'audit.jsonl'))?readFileSync(join(root,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(t=>JSON.parse(t) as Record<string,unknown>):[];
function definition(kind:'cli'|'mcp',out:z.ZodType=output):UpstreamDefinition{
 const command=realpathSync(process.execPath),script=realpathSync(resolve('scripts/applications/fixtures/m11-c1/controlled-upstream.cjs'));
 const resources=[command,script].map(path=>({path,sha256:digest(readFileSync(path))}));hashes=resources;
 return{id:'m11-c1-'+kind,kind,command,args:[script,kind],resources,versions:['1.0.0'],isolation:'private-home-xdg',environment:{ELECTRON_RUN_AS_NODE:'1',WILLYOU_FIXTURE_AUDIT:join(root,'audit.jsonl')},capabilities:{'fixture.records.list':{semantics:'read',input,output:out,inScope:()=>true,...(kind==='mcp'?{tool:'mapped_read'}:{command:['records','list']}),arguments:a=>({pageIndex:a.cursor==='page:2'?2:1,...(a.literal===undefined?{}:{literal:a.literal}),...(a.fault===undefined?{}:{fault:a.fault})})}}};
}
async function acquire(kind:'cli'|'mcp',args:{output?:z.ZodType;credential?:string|null;definition?:(d:UpstreamDefinition)=>UpstreamDefinition}={}){
 const base=definition(kind,args.output);const lease=await pool.acquire(args.definition?.(base)??base,{id:'fixture-connection',revision:1,scope:{prefix:'allowed:'},credential:args.credential===undefined?'SYNTHETIC_M11_C1_SECRET':args.credential});leases.push(lease);return lease;
}
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m11-c1-upstream-')));mkdirSync(join(root,'marker'));pool=new UpstreamSessionPool(join(root,'sessions'));leases=[];hashes=[];});
afterEach(async()=>{for(const lease of leases)await lease.release();await pool.close();expect(pool.status()).toEqual([]);for(const r of hashes)expect(digest(readFileSync(r.path))).toBe(r.sha256);for(const pid of new Set(audit().map(r=>r.pid as number)))expect(()=>process.kill(pid,0)).toThrow();rmSync(root,{recursive:true,force:true});});

describe('M11-T03 upstream MCP mapping and schema boundaries',()=>{
 it('permits the declared tool and rejects unknown or invalid requests before upstream execution',async()=>{
  const lease=await acquire('mcp'),first=await lease.invoke('fixture.records.list',{},options());expect(first).toEqual({records:[{id:'first',raw:'raw-first'}],nextCursor:'page:2'});
  const before=audit().filter(r=>r.event==='invoke').length;
  await expect(lease.invoke('extra_secret_tool',{},options())).rejects.toMatchObject({code:'SCOPE_DENIED'});
  await expect(lease.invoke('fixture.records.list',{cursor:17},options())).rejects.toMatchObject({code:'INVALID_INPUT'});
  expect(audit().filter(r=>r.event==='invoke')).toHaveLength(before);
 });
 it('rejects malformed MCP result schemas and hides credentials from upstream error content',async()=>{
  const lease=await acquire('mcp');
  for(const fault of ['wrong-shape','stderr-error']){const error=await lease.invoke('fixture.records.list',{fault},options()).catch(e=>e);expect(error).toMatchObject({code:'INVALID_RESPONSE'});expect(JSON.stringify(error)+String(error)).not.toContain('SYNTHETIC_M11_C1_SECRET');}
  expect(pool.status()[0].pending).toBe(0);
 });
});

describe('M11-T04 original CLI remains unchanged while fixed mappings handle pages, literal argv and errors',()=>{
 it('reads every page with explicit continuation, preserving raw values and the original executable/resource hashes',async()=>{
  const lease=await acquire('cli'),before=hashes.map(r=>({...r})),rows:unknown[]=[];let cursor:string|null=null;
  do{const page=await lease.invoke('fixture.records.list',{cursor},options()) as z.infer<typeof output>;rows.push(...page.records);cursor=page.nextCursor;}while(cursor);
  expect(rows).toEqual([{id:'first',raw:'raw-first'},{id:'second',raw:'raw-second'}]);
  expect(audit().filter(r=>r.event==='invoke').map(r=>r.args)).toEqual([{pageIndex:1},{pageIndex:2}]);
  for(const r of before)expect(digest(readFileSync(r.path))).toBe(r.sha256);
 });
 it('passes hostile literal text in a single JSON argv without shell expansion and returns a parseable controlled failure',async()=>{
  const lease=await acquire('cli'),sentinel=join(root,'marker','injected'),literal='quote\" ; $(touch '+sentinel+')\n--other';
  expect(await lease.invoke('fixture.records.list',{literal},options())).toMatchObject({records:[{raw:literal}]});expect(existsSync(sentinel)).toBe(false);
  const row=audit().find(r=>r.event==='invoke')!,argv=row.argv as string[];expect(argv.slice(0,3)).toEqual(['records','list','--json']);expect(argv).toHaveLength(4);expect(JSON.parse(argv[3])).toEqual({pageIndex:1,literal});
  const error=await lease.invoke('fixture.records.list',{fault:'stderr-error'},options()).catch(e=>e);expect(error).toMatchObject({code:'INVALID_RESPONSE'});const serialized=JSON.stringify({code:(error as {code:string}).code,message:(error as {message:string}).message});expect(JSON.parse(serialized)).toEqual({code:'INVALID_RESPONSE',message:'上游CLI返回受控失败'});expect(serialized).not.toContain('SYNTHETIC_M11_C1_SECRET');
 });
});

describe('M11-T05 original, explicit thin adaptation and unsupported upstreams',()=>{
 it('accepts native structured output and explicit host-only thin conversion without modifying the upstream',async()=>{
  const original=await acquire('cli');expect(await original.invoke('fixture.records.list',{},options())).toMatchObject({records:[{id:'first'}]});
  await original.release();await pool.close();pool=new UpstreamSessionPool(join(root,'thin-sessions'));leases=[];
  const nativeSchema=z.object({rows:z.array(z.tuple([z.string(),z.string()])),next:z.string().nullable()}).strict().transform(v=>({records:v.rows.map(([id,raw])=>({id,raw})),nextCursor:v.next}));
  const thin=await acquire('cli',{output:nativeSchema});expect(await thin.invoke('fixture.records.list',{fault:'thin'},options())).toEqual({records:[{id:'first',raw:'raw-first'}],nextCursor:'page:2'});
 });
 it('refuses private-config incompatibility and undeclared versions with explicit bounded errors',async()=>{
  await expect(acquire('cli',{definition:d=>({...d,isolation:'global' as 'private-home-xdg'})})).rejects.toMatchObject({code:'HOST_INCOMPATIBLE'});
  const unsupported=await acquire('cli',{definition:d=>({...d,versions:['9.9.9']})}).catch(e=>e);writeFileSync(resolve('delivery-version-error-observed.json'),JSON.stringify({code:(unsupported as {code:string}).code,message:(unsupported as {message:string}).message},null,2)+'\n');expect(unsupported).toMatchObject({code:'HOST_INCOMPATIBLE',message:expect.stringContaining('版本')});
  expect(audit().filter(r=>r.event==='invoke')).toHaveLength(0);
 });
 it('does not treat zero exit text, JSON success strings or wrong schemas as business success',async()=>{
  const lease=await acquire('cli');for(const fault of ['plain-text','json-string','wrong-shape'])await expect(lease.invoke('fixture.records.list',{fault},options())).rejects.toMatchObject({code:'INVALID_RESPONSE'});
 });
 it('refuses unusable authentication without exposing synthetic secret or claiming success',async()=>{
  const lease=await acquire('cli',{credential:'UNSUPPORTED_AUTH_CANARY'}),error=await lease.invoke('fixture.records.list',{},options()).catch(e=>e);expect(error).toMatchObject({code:'INVALID_RESPONSE'});expect(JSON.stringify(error)+String(error)).not.toContain('UNSUPPORTED_AUTH_CANARY');
 });
});

import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {runBundledMigrations} from '../../../../db/migrations';
import {ResourceStore} from '../../resource-store';
import {MacProcessIdentityReader} from '../../process-identity';
import {canonicalJson,digest} from '../../manifest';
import {PluginLifecycle} from '../lifecycle';
import {PluginProcess} from '../process';
import {inspectPluginDirectory} from '../package';
import {pluginLegacyResult} from '../legacy-result';
import {prepareLegacyZentaoData} from '../legacy-zentao-data';
import type {PluginExecutionScope} from '@shared/plugin-session';

let root:string,db:Database.Database,life:PluginLifecycle,server:Server,baseUrl:string,project:string,connectionId:string,oldRef:unknown,oldBody:unknown;
let owner:string,total:number,requests:string[],attachment:Buffer,closed:boolean;
const bundle=()=>inspectPluginDirectory(resolve('out/plugins/zentao'));
const fields=(id:string,account='qa')=>({id,title:'Bug '+id,status:'active',assignedTo:account,steps:'复现正文 中文🙂'.repeat(7000)});
const source=(account='qa')=>({zentao:{id:connectionId,provider:'zentao',config:{baseUrl,username:account},identityRevision:1,configRevision:1,policyRevision:1,identity:{providerId:'zentao',serviceId:baseUrl,accountId:account==='qa'?'uid:1':'uid:2',contractMajor:1},authMode:'token',secret:'SYNTHETIC_'+account}});
const scope=(id=project):PluginExecutionScope=>({projectId:id,operationId:randomUUID(),callerKind:'ui'});
const call=(capability:string,input:unknown,context=scope(),connection=source())=>life.withInvocation('zentao',(_stored,invocation)=>invocation.execute(capability,input,connection,new AbortController().signal,undefined,context)) as Promise<any>;
beforeEach(async()=>{
  owner='qa';total=3;closed=false;requests=[];attachment=Buffer.from('附件\u0000🙂'.repeat(30000));
  server=createServer(async(req,res)=>{const url=new URL(req.url!,'http://127.0.0.1');requests.push(url.pathname+'?'+url.searchParams.toString());const token=req.headers.token,account=token==='SYNTHETIC_qa2'?'qa2':'qa';res.setHeader('Content-Type','application/json');
    if(url.pathname==='/api.php/v1/tokens'){let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);res.end(JSON.stringify({token:'SYNTHETIC_'+input.account}));return;}
    if(token!=='SYNTHETIC_qa'&&token!=='SYNTHETIC_qa2'){res.statusCode=401;res.end('{}');return;}
    if(url.pathname==='/api.php/v1/user'){res.end(JSON.stringify({profile:{account,id:account==='qa'?1:2}}));return;}
    if(url.pathname==='/api.php/v2/my/work'){const page=Number(url.searchParams.get('pageID')),size=Number(url.searchParams.get('recPerPage')),kind=url.searchParams.get('mode'),records=Array.from({length:total},(_,i)=>({...fields(String(79291-i),account),steps:undefined})).slice((page-1)*size,page*size);res.end(JSON.stringify({mode:kind,type:'assignedTo',pager:{recTotal:total,pageID:page,recPerPage:size,pageTotal:Math.ceil(total/size)},[kind==='bug'?'bugs':'stories']:records}));return;}
    if(url.pathname==='/api.php/v1/langs'){res.end('{}');return;}
    if(url.pathname.startsWith('/api.php/v1/bugs/')||url.pathname.startsWith('/api.php/v2/stories/')){const id=url.pathname.split('/').at(-1)!;res.end(JSON.stringify({...fields(id,owner),...(closed?{status:'closed'}:{}),actions:[{action:'opened',actor:owner}],files:{'9':{id:'9',title:'原始附件',extension:'txt',size:attachment.length}}}));return;}
    if(url.pathname==='/api.php/v1/files/9'){res.setHeader('Content-Type','text/plain');res.end(attachment);return;}res.statusCode=404;res.end('{}');
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));baseUrl='http://127.0.0.1:'+(server.address() as {port:number}).port+'/';
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-zentao-runtime-')));db=new Database(join(root,'host.sqlite'));db.pragma('foreign_keys=ON');runBundledMigrations(db);project=randomUUID();connectionId=randomUUID();const keychain=join(root,'synthetic-keychain');mkdirSync(keychain);
  // A real old object/resource identity, prepared before the new plugin is activated.
  const actions=[{action:'opened',actor:'qa'}],files={'9':{id:'9',title:'原始附件',extension:'txt',size:attachment.length}},payload={kind:'bug',id:'79291',fields:{...fields('79291'),actions,files},actions,files},revision=digest(canonicalJson(payload)),key=digest(canonicalJson({project,connection:connectionId,identity:1,kind:'bug',id:'79291',revision,representation:'detail'}));
  db.prepare('INSERT INTO application_zentao_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(key,project,connectionId,1,'bug','79291',revision,'detail',canonicalJson(payload),'old-time');oldRef={connectionId,identityRevision:1,nativeId:'79291',contentRevision:revision};const bytes=Buffer.from(canonicalJson({steps:payload.fields.steps}));oldBody={id:randomUUID(),revision:digest(bytes),mediaType:'application/json',size:bytes.length};
  db.prepare('INSERT INTO application_data_resources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run((oldBody as any).id,project,'zentao','zentao-object-v1',key,revision,'body',1,'zentao.read',digest(bytes),bytes.length,'application/json','a'.repeat(64),randomUUID(),'old-time');
  life=new PluginLifecycle(new ResourceStore(db,root),{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),prepareData:(stored,candidate)=>prepareLegacyZentaoData(db,candidate,stored.plugin.hash),createProcess:(stored,data,events)=>new PluginProcess(stored.plugin,{packageRoot:stored.directory,dataRoot:data,protectedRoots:[root],readOnlyRoots:[process.execPath],keychainRoots:[keychain],executable:process.execPath,...events}),deleteMetadata:()=>{}});
  const candidate=bundle();await life.install(candidate,life.inspect(candidate));
});
afterEach(async()=>{await life?.close();await new Promise<void>(resolve=>server?.close(()=>resolve()));db?.close();if(root)rmSync(root,{recursive:true,force:true});});
async function readAll(resource:any,context=scope(),trace?:(value:Record<string,unknown>)=>void){
  const chunks:Buffer[]=[];let offset=0;for(let i=0;i<1024;i++){const result=await call('zentao.resource.read',{resource,offset,length:131072},{...context,operationId:randomUUID()});expect(result.offset).toBe(offset);expect(result.resourceId).toBe(resource.id);expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(256*1024);chunks.push(result.encoding==='utf8'?Buffer.from(result.data):Buffer.from(result.data,'base64'));offset+=result.length;trace?.({chunk:i,offset,eof:result.eof});if(result.eof){expect(result.nextOffset).toBeNull();const bytes=Buffer.concat(chunks);expect(bytes.length).toBe(resource.size);expect(digest(bytes)).toBe(resource.revision);return bytes;}expect(result.nextOffset).toBe(offset);}throw new Error('resource did not end');
}
describe('standalone Zentao payload in mandatory sandbox with a synthetic HTTP service',()=>{
  it('is a complete validated external package with legacy aliases, professional icon, two Skills and no runtime dependency on host source',()=>{const pkg=bundle();expect(pkg.manifest.id).toBe('zentao');expect(pkg.skills.map(s=>s.id).sort()).toEqual(['bug-analysis','story-review']);expect(pkg.manifest.legacyToolNames.smartdd_zentao_work_list_v1).toBe('zentao.object.list');const runtime=readFileSync(resolve('out/plugins/zentao/runtime/main.mjs'),'utf8');expect(runtime).not.toMatch(/from\s*["'][.]{1,2}\//);});
  it('verifies both Token and password authentication and preserves the verified account identity',async()=>{for(const authMode of ['token','password']){await expect(life.withInvocation('zentao',(_stored,inv)=>inv.verify('zentao',{baseUrl,username:'qa'},authMode==='token'?'SYNTHETIC_qa':'SYNTHETIC_PASSWORD',new AbortController().signal,authMode))).resolves.toEqual({identity:{serviceId:baseUrl,accountId:'uid:1'}});}await expect(life.withInvocation('zentao',(_stored,inv)=>inv.verify('zentao',{baseUrl,username:'qa'},'bad',new AbortController().signal,'token'))).rejects.toMatchObject({code:'AUTH_FAILED'});});
  it('paginates Bug and story lists, reads details and complete multi-frame body/history/attachment bytes',async()=>{for(const kind of ['bug','story']){const first=await call('zentao.object.list',{kind,limit:2});expect(first).toMatchObject({kind,total:3,complete:false});expect(first.items).toHaveLength(2);const second=await call('zentao.object.list',{kind,limit:2,cursor:first.nextCursor});expect(second).toMatchObject({complete:true,nextCursor:null});expect(second.items).toHaveLength(1);const detail=await call('zentao.object.get',{kind,reference:first.items[0].reference});expect(detail).toMatchObject({kind,id:'79291',complete:true,missing:[]});expect(JSON.parse((await readAll(detail.body)).toString())).toEqual({steps:fields('79291').steps});expect(JSON.parse((await readAll(detail.history)).toString())).toEqual([{action:'opened',actor:'qa'}]);expect(await readAll(detail.attachments[0].resource)).toEqual(attachment);}});
  it('consumes original migrated object and shared-resource IDs through the new private runtime',async()=>{const result=await call('zentao.object.get',{kind:'bug',reference:oldRef});expect(result.reference).toEqual(oldRef);expect(result.body).toEqual(oldBody);expect(JSON.parse((await readAll(oldBody)).toString())).toEqual({steps:fields('79291').steps});expect(db.prepare("SELECT tables_json FROM plugin_builtin_migrations").get()).toMatchObject({tables_json:expect.stringContaining('plugin_resources')});});
  it('declares the actual pre-P1 v2 tool names and their original closed result schemas',()=>{
    const plugin=bundle();
    for(const [name,id] of Object.entries({smartdd_zentao_work_list_v2:'zentao.object.list',smartdd_zentao_object_get_v2:'zentao.object.get',smartdd_zentao_resource_v2:'zentao.resource.read'})){
      expect(plugin.manifest.legacyToolNames[name]).toBe(id);
      expect((plugin.manifest as any).legacyToolContracts[name].result).toBe('application-v2');
    }
  });
  it('returns original v2 schemas and original object/resource identities from the real sandbox runtime',async()=>{
    const plugin=bundle(),operationId=randomUUID(),requestId=randomUUID();
    const wrap=(name:string,id:string,raw:unknown)=>pluginLegacyResult(plugin,name,{capabilityId:id,semantics:'read',appId:'zentao',packageHash:plugin.hash,connections:[{slot:'zentao',connectionId,identityRevision:1,configRevision:1,policyRevision:1,bindingRevision:7}],operationId,requestId,origin:'mcp'},raw);
    const listed=await call('smartdd_zentao_work_list_v2',{kind:'bug',limit:2});
    const list=wrap('smartdd_zentao_work_list_v2','zentao.object.list',listed);
    expect(list.pagination).toEqual({nextCursor:listed.nextCursor,total:3});expect(list.completeness.complete).toBe(false);
    const detail=wrap('smartdd_zentao_object_get_v2','zentao.object.get',await call('smartdd_zentao_object_get_v2',{kind:'bug',reference:oldRef}));
    expect((detail.data as any).reference).toEqual(oldRef);expect(detail.resources).toContainEqual(oldBody);
    const raw=await call('smartdd_zentao_resource_v2',{resource:oldBody,offset:0,length:4096});
    const chunk=wrap('smartdd_zentao_resource_v2','zentao.resource.read',raw);
    expect(chunk.data).toMatchObject({resourceId:(oldBody as any).id,revision:(oldBody as any).revision,offset:0});
    expect(chunk.data).not.toHaveProperty('mediaType');expect(chunk.data).not.toHaveProperty('truncated');
    // The unchanged old schema rejects simply wrapping the modern resource chunk.
    expect(plugin.legacyContracts.get('smartdd_zentao_resource_v2')!.output({...chunk,data:raw}).valid).toBe(false);
    for(const result of [list,detail,chunk]){
      expect(result.source).toMatchObject({appId:'zentao',packageHash:plugin.hash,connections:[{connectionId,bindingRevision:7}]});
      expect(result.operation).toEqual({id:operationId,requestId,origin:'mcp',effectState:'read-only'});
    }
    expect(()=>wrap('smartdd_zentao_object_get_v2','zentao.object.list',listed)).toThrow('实际执行能力');
    expect(plugin.legacyContracts.get('smartdd_zentao_resource_v2')!.input({resource:oldBody}).valid).toBe(false);
  });
  it('resolves legacy tool aliases to the real new runtime without changing original object or resource identity',async()=>{const listed=await call('smartdd_zentao_work_list_v1',{kind:'bug',limit:2});expect(listed.items[0].id).toBe('79291');const detail=await call('smartdd_zentao_object_get_v1',{kind:'bug',reference:oldRef});expect(detail.body).toEqual(oldBody);const chunk=await call('smartdd_zentao_resource_v1',{resource:oldBody,offset:0,length:4096});expect(chunk).toMatchObject({resourceId:(oldBody as any).id,revision:(oldBody as any).revision,offset:0,eof:false});});
  it('isolates original references and cursors by project and selected connection',async()=>{const first=await call('zentao.object.list',{kind:'bug',limit:2}),detail=await call('zentao.object.get',{kind:'bug',reference:first.items[0].reference}),other=scope(randomUUID());await expect(call('zentao.object.get',{kind:'bug',reference:first.items[0].reference},other)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(call('zentao.object.list',{kind:'bug',limit:2,cursor:first.nextCursor},other)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(call('zentao.resource.read',{resource:detail.body},other)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(call('zentao.object.get',{kind:'bug',reference:{...first.items[0].reference,connectionId:randomUUID()}})).rejects.toMatchObject({code:'SCOPE_DENIED'});});
  it('rejects remote account changes, moved/closed Bugs and tampered resource hashes without following body URLs',async()=>{const first=await call('zentao.object.list',{kind:'bug',limit:2}),detail=await call('zentao.object.get',{kind:'bug',reference:first.items[0].reference});await expect(call('zentao.resource.read',{resource:{...detail.body,revision:'b'.repeat(64)}})).rejects.toMatchObject({code:'HASH_MISMATCH'});owner='other';await expect(call('zentao.resource.read',{resource:detail.body})).rejects.toMatchObject({code:'SCOPE_DENIED'});owner='qa';closed=true;await expect(call('zentao.object.get',{kind:'bug',reference:first.items[0].reference})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(requests.some(r=>!r.startsWith('/api.php/'))).toBe(false);});
  it('marks pagination inconsistency explicitly and never labels a partial list complete',async()=>{const first=await call('zentao.object.list',{kind:'bug',limit:2});total=4;expect(await call('zentao.object.list',{kind:'bug',limit:2,cursor:first.nextCursor})).toMatchObject({complete:false,items:[],problems:[{code:'INCOMPLETE_RESULT'}]});});
  it.each([5,25])('reads a %i MiB attachment beyond one process output budget completely without weakening the per-process quota',async size=>{
    const started=Date.now(),path=root+'-budget-'+size+'.ndjson';writeFileSync(path,'',{flag:'wx',mode:0o600});const trace=(value:Record<string,unknown>)=>appendFileSync(path,JSON.stringify({elapsedMs:Date.now()-started,...value})+'\n');console.info('Synthetic budget trace:',path);
    try{attachment=Buffer.alloc(size*1024*1024,0x61);const detail=await call('zentao.object.get',{kind:'bug',reference:oldRef});trace({event:'detail',size:attachment.length});const actual=await readAll(detail.attachments[0].resource,scope(),trace);expect(actual.equals(attachment)).toBe(true);const generations=db.prepare("SELECT state FROM plugin_runtime_leases WHERE kind='invocation'").all() as {state:string}[];expect(generations.length).toBeGreaterThan(1);expect(generations.filter(g=>g.state!=='closed').length).toBeLessThanOrEqual(1);expect(life.state('zentao').paused).toBe(false);trace({event:'complete',generations:generations.length});}finally{trace({event:'test-ended'});}
  },60000);
});

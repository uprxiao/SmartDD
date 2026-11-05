import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {agentFixture} from './agent-fixture';
import {fixtureBundle} from './fixtures';
import {resourceGcPlan} from '../resource-gc-plan';
import {ownedBundle,verifyOwnedBundle,writeOwnedBundle} from '../owned-bundle';
import {digest} from '../manifest';
import {retirePreLibraryResources} from '../retire-pre-library-resources';

/** R1.0 S3d-c2: pre-R1.0 projections no longer back any launch; retiring them frees old versions for cleanup. */
let f:Awaited<ReturnType<typeof agentFixture>>;
beforeEach(async()=>{f=await agentFixture();});
afterEach(()=>f.cleanup());
const oldPackage=()=>f.application.resourceId;
async function upgrade(){const source=fixtureBundle('2.0.0');source.manifest.runtime.hash=f.source.manifest.runtime.hash;const next=await f.packages.install(source);await f.packages.activate(next.packageHash,1);}
async function claudePlugin(taskId:string){
 const bundle=ownedBundle({kind:'retire-fixture',taskId,sources:[{resourceId:oldPackage()}]},{'entry.txt':Buffer.from(taskId)});
 return f.store.publish({resourceId:'session-projection:'+taskId+':'+bundle.hash,kind:'session-projection',contentHash:bundle.hash,relativePath:`sessions/${taskId}/claude/plugin`,dependencies:[oldPackage()],materialize:dir=>writeOwnedBundle(dir,bundle,f.store.storeId),verify:dir=>{verifyOwnedBundle(dir,bundle.hash,f.store.storeId);}});
}
function sharedCopy(name:string,present:boolean){
 const homeId=digest(f.home),id='agent-projection:'+name;
 f.sqlite.prepare('INSERT OR IGNORE INTO capability_discovery_roots(home_id,canonical_home) VALUES(?,?)').run(homeId,f.home);
 f.sqlite.prepare("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,scope_identity,relative_path,state,generation,integrity,operation_id) VALUES(?,'agent-projection',?,?,'H',?,?,'ready',1,'valid',NULL)").run(id,digest(name),f.store.storeId,homeId,'.agents/skills/'+name);
 if(present){mkdirSync(join(f.home,'.agents/skills',name),{recursive:true});writeFileSync(join(f.home,'.agents/skills',name,'SKILL.md'),'kept');}
 return id;
}

describe('retiring pre-R1.0 projection records',()=>{
 it('removes our old per-task plugin, releases its references and lets the old version be cleaned',async()=>{
  await upgrade();const taskId='t-'+randomUUID().slice(0,8),plugin=await claudePlugin(taskId),dir=join(f.store.root,`sessions/${taskId}/claude/plugin`);
  mkdirSync(join(f.store.root,`sessions/${taskId}`),{recursive:true});writeFileSync(join(f.store.root,`sessions/${taskId}/mirror.json`),'session record');
  const leaseId=randomUUID();f.sqlite.prepare("INSERT INTO capability_resource_leases VALUES(?,?,'ui','fixture',?,NULL,NULL,'active',?,NULL)").run(leaseId,plugin.resourceId,f.store.instanceId,'2020-01-01T00:00:00Z');
  expect(resourceGcPlan(f.store,oldPackage()).canCollect).toBe(false);
  expect(await retirePreLibraryResources(f.store)).toEqual({retired:[plugin.resourceId],kept:[]});
  expect(existsSync(dir)).toBe(false);expect(existsSync(join(f.store.root,`sessions/${taskId}/mirror.json`))).toBe(true);
  expect(f.store.get(plugin.resourceId)).toMatchObject({state:'removed'});expect(f.sqlite.prepare('SELECT state FROM capability_resource_leases WHERE lease_id=?').get(leaseId)).toEqual({state:'released'});
  expect(resourceGcPlan(f.store,oldPackage()).canCollect).toBe(true);
  expect(await retirePreLibraryResources(f.store)).toEqual({retired:[],kept:[]});
 });
 it('retires a shared-catalog record only once its copy under HOME is gone and never touches a present copy',async()=>{
  const gone=sharedCopy('smartdd-gone-0123456789abcdef',false),present=sharedCopy('smartdd-kept-0123456789abcdef',true);
  expect(await retirePreLibraryResources(f.store)).toEqual({retired:[gone],kept:[present]});
  expect(f.store.get(gone).state).toBe('removed');expect(f.store.get(present).state).toBe('ready');expect(existsSync(join(f.home,'.agents/skills/smartdd-kept-0123456789abcdef/SKILL.md'))).toBe(true);
 });
});

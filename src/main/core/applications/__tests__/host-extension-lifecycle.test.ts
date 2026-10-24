import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {z} from 'zod';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import * as schema from '../../../db/schema';
import {runBundledMigrations} from '../../../db/migrations';
import {SecretsStore} from '../../../secrets';
import {ApplicationConnectionService} from '../connection-service';
import {ApplicationSelectionService} from '../selection-service';
import {ResourceStore} from '../resource-store';
import type {HostApplicationDefinitions,HostProvider,HostedSave,HostedIdentity} from '../host-application-registry';
type ExtensionId='extalpha'|'extbeta';
type ExtensionConfig={kind:ExtensionId;endpoint:string;username:string;authMode:'token'};
const ids=['extalpha','extbeta'] as const;
const definition=(id:ExtensionId):HostProvider<ExtensionConfig,ExtensionId>=>({id,appId:id,configApiMajor:1,authentication:{kind:'secret',modes:['token']},permissions:{read:id+'.read',write:id+'.write'},configSchema:z.object({kind:z.literal(id),endpoint:z.url(),username:z.string().min(1),authMode:z.literal('token')}).strict()});
const hosts=():HostApplicationDefinitions<ExtensionConfig,ExtensionId>=>({api:1,applications:ids.map(id=>({id,slots:[id],stopBeforeSwitch:false})),providers:ids.map(definition)});
let root:string,sqlite:Database.Database,store:ResourceStore,secrets:SecretsStore;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'willyou-host-extension-'));sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);store=new ResourceStore(sqlite,root);secrets=new SecretsStore(drizzle(sqlite,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from([...s].reverse().join('')),decrypt:b=>[...b.toString()].reverse().join('')});});
afterEach(()=>{vi.restoreAllMocks();sqlite.close();rmSync(root,{recursive:true,force:true});});
function connections(definitions=hosts()){
 return new ApplicationConnectionService<ExtensionConfig,ExtensionId>(store,secrets,{verify:vi.fn(async(config:ExtensionConfig):Promise<HostedIdentity<ExtensionConfig>>=>({providerId:config.kind,serviceId:'isolated-service',accountId:config.username,contractMajor:1}))},1000,definitions);
}
const request=(id:ExtensionId):HostedSave<ExtensionConfig>=>({expectedRevision:0,name:'Isolated '+id,config:{kind:id,endpoint:'https://'+id+'.example.test/',username:id+'-user',authMode:'token'},secret:'private-'+id+'-secret'});
describe('trusted host extension uses the actual shared connection lifecycle',()=>{
 it.each(ids)('verifies,commits,authenticates,revokes and recovers the registered %s provider',async id=>{
  const service=connections(),input=request(id),candidate=await service.testCandidate(input);expect(service.list()).toEqual([]);const saved=await service.commitCandidate(candidate.operationId,candidate.candidateHash);expect(saved).toMatchObject({appId:id,providerId:id,config:input.config,revision:1,identityRevision:1,authorization:'connected'});expect(service.authentication(saved.id,saved)).toEqual({config:input.config,secret:input.secret});expect(JSON.stringify(candidate)+JSON.stringify(saved)+JSON.stringify(sqlite.prepare('SELECT * FROM app_secrets').all())).not.toContain(input.secret);await expect(service.commitCandidate(candidate.operationId,candidate.candidateHash)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});const disabled=await service.setEnabled(saved.id,false,saved.revision);expect(()=>service.authentication(saved.id,disabled)).toThrow();const enabled=await service.setEnabled(saved.id,true,disabled.revision);const disconnected=await service.disconnect(saved.id,enabled.revision);expect(disconnected).toMatchObject({authorization:'disconnected',hasSecret:false});const reopened=connections();await reopened.recoverSecretChanges();expect(reopened.get(saved.id)).toEqual(disconnected);
 });
 it('keeps two provider identities,secret references and failed rotations independent in the same actual SQLite store',async()=>{
  const service=connections(),a=await service.testCandidate(request('extalpha')),b=await service.testCandidate(request('extbeta')),first=await service.commitCandidate(a.operationId,a.candidateHash),second=await service.commitCandidate(b.operationId,b.candidateHash);expect(first.id).not.toBe(second.id);expect(service.list()).toHaveLength(2);const candidate=await service.testCandidate({...request('extalpha'),id:first.id,expectedRevision:first.revision,secret:'discarded-rotation'});await service.discardCandidate(candidate.operationId);expect(service.authentication(first.id,first).secret).toBe(request('extalpha').secret);expect(service.authentication(second.id,second).secret).toBe(request('extbeta').secret);expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 });
 it.each(['duplicate-app','duplicate-provider','unregistered-slot','unknown-api'] as const)('rejects an invalid static registration before creating connection state: %s',fault=>{
  const original=hosts(),defs={...original,applications:[...original.applications],providers:[...original.providers]};if(fault==='duplicate-app')defs.applications.push(defs.applications[0]);if(fault==='duplicate-provider')defs.providers.push(defs.providers[0]);if(fault==='unregistered-slot')Reflect.set(defs.applications[0],'slots',['missing-provider']);if(fault==='unknown-api')Reflect.set(defs,'api',2);expect(()=>connections(defs)).toThrow();expect(sqlite.prepare('SELECT count(*) n FROM application_connections').get()).toEqual({n:0});expect(sqlite.prepare('SELECT count(*) n FROM app_secrets').get()).toEqual({n:0});
 });
 it('keeps default product configuration strict and refuses the fake provider without the static host definition',async()=>{
  const service=new ApplicationConnectionService(store,secrets,{verify:async()=>{throw new Error('must not verify');}});await expect(Reflect.apply(service.testCandidate,service,[request('extalpha')])).rejects.toMatchObject({code:'INVALID_INPUT'});expect(sqlite.prepare('SELECT count(*) n FROM application_connections').get()).toEqual({n:0});
 });
 it.each(['root','application','provider','authentication','permissions'] as const)('rejects undeclared static %s fields rather than silently accepting a misspelled contract',location=>{
  const defs=hosts();const target=location==='root'?defs:location==='application'?defs.applications[0]:location==='provider'?defs.providers[0]:location==='authentication'?defs.providers[0].authentication:defs.providers[0].permissions;Reflect.set(target,'unexpectedContractFlag',true);expect(()=>connections(defs)).toThrow();expect(sqlite.prepare("SELECT app_id FROM application_host_applications WHERE app_id='extalpha'").get()).toBeUndefined();
 });
 it.each(['config-provider','identity-provider','config-api'] as const)('refuses both display and credential resolution for a mismatched persisted %s contract',async fault=>{
  const service=connections(),candidate=await service.testCandidate(request('extalpha')),saved=await service.commitCandidate(candidate.operationId,candidate.candidateHash);if(fault==='config-provider')sqlite.prepare('UPDATE application_connections SET config_json=? WHERE id=?').run(JSON.stringify(request('extbeta').config),saved.id);if(fault==='identity-provider')sqlite.prepare('UPDATE application_connections SET verified_identity_json=? WHERE id=?').run(JSON.stringify({...saved.identity,providerId:'extbeta'}),saved.id);if(fault==='config-api')sqlite.prepare('UPDATE application_connections SET config_schema_version=2 WHERE id=?').run(saved.id);expect(()=>service.get(saved.id)).toThrow();expect(()=>service.authentication(saved.id,saved)).toThrow();
 });
});
describe('registered hosts reuse actual project selection and revocation',()=>{
 async function fixture(){
  const service=connections(),saved=[];for(const id of ids){const candidate=await service.testCandidate(request(id));saved.push(await service.commitCandidate(candidate.operationId,candidate.candidateHash));}
  sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p-a','First project',1,1),('p-b','Second project',1,1)");
  const stopProjectRuns=vi.fn(async()=>true),selection=new ApplicationSelectionService(store,service,{requireProject:projectId=>{if(!sqlite.prepare('SELECT id FROM projects WHERE id=?').get(projectId))throw new Error('missing project');},stopProjectRuns,runningInProject:()=>0});
  return{service,saved,selection,stopProjectRuns};
 }
 it('keeps both projects unselected until explicit selection,and persists two apps through the shared service',async()=>{
  const{service,saved,selection,stopProjectRuns}=await fixture();for(const appId of ids){await selection.setAdded(appId,true,0);for(const projectId of ['p-a','p-b'])expect(selection.projectSettings(projectId,appId)).toMatchObject({enabled:false,revision:0,connections:{[appId]:null}});}
  for(const c of saved)await selection.select({projectId:'p-a',appId:c.appId,expectedRevision:0,enabled:true,connections:{[c.providerId]:c.id}});
  const recovered=new ApplicationSelectionService(store,service,{requireProject:()=>true,stopProjectRuns:async()=>true,runningInProject:()=>0});for(const c of saved){expect(recovered.requireEnabled('p-a',c.appId).connections).toEqual({[c.providerId]:c.id});expect(recovered.projectSettings('p-b',c.appId).connections).toEqual({[c.providerId]:null});expect(recovered.connectionSlot('p-a',c.appId,c.providerId)).toEqual({connectionId:c.id,identityRevision:1,revision:1});}expect(stopProjectRuns).not.toHaveBeenCalled();
 });
 it('rejects a different application connection or slot before changing either project',async()=>{
  const{saved,selection}=await fixture();await selection.setAdded('extalpha',true,0);const before=selection.projectSettings('p-a','extalpha');await expect(selection.select({projectId:'p-a',appId:'extalpha',expectedRevision:0,enabled:true,connections:{extalpha:saved[1].id}})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(selection.projectSettings('p-a','extalpha')).toEqual(before);await expect(selection.select({projectId:'p-a',appId:'extalpha',expectedRevision:0,enabled:true,connections:{extbeta:saved[1].id}})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(selection.projectSettings('p-a','extalpha')).toEqual(before);
 });
 it('revokes only the selected project policy and keeps a second project and application usable',async()=>{
  const{saved,selection}=await fixture();for(const appId of ids)await selection.setAdded(appId,true,0);for(const c of saved)for(const projectId of ['p-a','p-b'])await selection.select({projectId,appId:c.appId,expectedRevision:0,enabled:true,connections:{[c.providerId]:c.id}});
  const stamp=selection.policyStamp('p-a','extalpha');await selection.select({projectId:'p-a',appId:'extalpha',expectedRevision:1,enabled:false,connections:{extalpha:saved[0].id}});expect(()=>selection.requireEnabled('p-a','extalpha')).toThrow();expect(selection.requireEnabled('p-b','extalpha').enabled).toBe(true);expect(selection.requireEnabled('p-a','extbeta').enabled).toBe(true);await selection.select({projectId:'p-a',appId:'extalpha',expectedRevision:2,enabled:true,connections:{extalpha:saved[0].id}});expect(selection.policyStamp('p-a','extalpha').projectPolicyRevision).toBeGreaterThan(stamp.projectPolicyRevision);await selection.setGlobalEnabled('extalpha',false,1);expect(()=>selection.requireEnabled('p-a','extalpha')).toThrow();expect(()=>selection.requireEnabled('p-b','extalpha')).toThrow();expect(selection.requireEnabled('p-a','extbeta').enabled).toBe(true);
 });
});

it('persists physical schema2 independently of stable API1 and refuses a mismatched host on reopen',async()=>{
 const config=hosts();config.providers=config.providers.map(provider=>({...provider,configSchemaVersion:2}));
 const service=connections(config),saved=await service.save(request('extalpha'));
 expect(saved.configSchemaVersion).toBe(2);expect(sqlite.prepare('SELECT config_schema_version FROM application_connections WHERE id=?').get(saved.id)).toEqual({config_schema_version:2});
 expect(sqlite.prepare("SELECT config_api_major FROM application_host_providers WHERE provider_id='extalpha'").get()).toEqual({config_api_major:1});
 expect(connections(config).get(saved.id)).toEqual(saved);expect(()=>connections().get(saved.id)).toThrow(/契约不符/);
 const revised=await service.save({...request('extalpha'),id:saved.id,expectedRevision:saved.revision,name:'rechecked',secret:undefined});expect(revised.configSchemaVersion).toBe(2);expect(revised.identityRevision).toBe(saved.identityRevision);
});
it('rejects a tested candidate if the current host physical schema changes before commit',async()=>{
 const original=connections(),tested=await original.testCandidate(request('extalpha')),config=hosts();config.providers=config.providers.map(provider=>({...provider,configSchemaVersion:2}));
 await expect(connections(config).commitCandidate(tested.operationId,tested.candidateHash)).rejects.toMatchObject({code:'CONFIG_PLAN_STALE'});expect(original.list()).toEqual([]);
});

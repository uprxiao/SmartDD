import {afterEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {BrowserProfiles} from '../profiles';
import {BrowserImportJournals,type BrowserImportCookie} from '../cookie-import/journal';
import {BrowserImportCoordinator} from '../cookie-import/coordinator';
import type {BrowserCookieSources} from '../cookie-import/sources';
const roots:string[]=[],databases:Database.Database[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const db of databases.splice(0))db.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const cookie=(value:string):BrowserImportCookie=>({name:'session',value,domain:'qa.example.test',path:'/',hostOnly:true,secure:true,httpOnly:true,sameSite:'lax',expirationDate:null,partitionKey:null});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'willyou-import-coordinator-'));roots.push(root);const sqlite=new Database(':memory:');databases.push(sqlite);sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  const profiles=new BrowserProfiles({sqlite,taskProject:()=> 'p1'}),profile=profiles.ensureProject('p1'),key=randomBytes(32);let available=true;
  const journals=new BrowserImportJournals(root,{isAvailable:()=>available,encrypt:text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);},decrypt:bytes=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString();}});
  const events:string[]=[],values=[cookie('before')],source={cookies:[cookie('after')],preserveDomains:[],sourceCount:1,googleSkipped:0,partitionSkipped:0,source:{id:'a'.repeat(64),family:'chrome' as const,browserLabel:'Chrome',profileName:'Default',profileDirectory:'Default',hasCookies:true}},prepare=vi.fn(async()=>source);
  const store={snapshot:async()=>{events.push('snapshot');return values.map(c=>({kind:'readable' as const,cookie:c}));},set:async(c:BrowserImportCookie)=>{events.push('set');values.push(c);},remove:async(c:BrowserImportCookie)=>{events.push('remove');const index=values.findIndex(v=>v.name===c.name);if(index!==-1)values.splice(index,1);},flush:async()=>{events.push('flush');},close:async()=>{events.push('close');}};
  const options={profiles,journals,sources:{prepare} as unknown as BrowserCookieSources,open:vi.fn(async()=>{events.push('open');return store;}),hold:vi.fn(async()=>{events.push('hold');expect(()=>profiles.assertAvailable(profile.id)).toThrow();}),resume:vi.fn(async()=>{events.push('resume');expect(profiles.importState(profile.id)).toBe('ready');expect(()=>profiles.lock(profile.id,'删除')).toThrow('导入');return 2;}),gate:vi.fn(()=>{events.push('gate');return()=>events.push('ungate');}),clear:vi.fn(async()=>{events.push('clear');values.length=0;}),changed:vi.fn()};
  return{root,profile,profiles,journals,options,store,values,prepare,events,setAvailable:(v:boolean)=>{available=v;},coordinator:()=>new BrowserImportCoordinator(options)};
}
describe('UI Cookie import coordinator (software, native/session lifecycle substituted)',()=>{
  it('validates source before pause and gates/unloads before snapshot/write, then closes/unlocks before reload',async()=>{
    const f=fixture(),coordinator=f.coordinator();f.prepare.mockImplementation(async()=>{f.events.push('prepare');expect(()=>f.profiles.lock(f.profile.id,'删除')).toThrow('正在准备导入');return{cookies:[cookie('after')],preserveDomains:[],sourceCount:1,googleSkipped:0,partitionSkipped:0,source:{id:'a'.repeat(64),family:'chrome',browserLabel:'Chrome',profileName:'Default',profileDirectory:'Default',hasCookies:true}};});
    const result=await coordinator.import(f.profile,'a'.repeat(64));expect(result).toMatchObject({importedCookies:1,reloadedPages:2,domains:['qa.example.test']});expect(JSON.stringify(result)).not.toContain('after');expect(f.events).toEqual(['prepare','gate','hold','open','snapshot','snapshot','remove','set','flush','close','ungate','resume']);expect(f.profiles.importState(f.profile.id)).toBe('ready');expect(f.profiles.known(f.profile.id)?.source).toMatchObject({family:'chrome',profile:'Default'});
  });
  it('does not pause or write after source/Keychain failure and refuses overlapping preparation',async()=>{
    const f=fixture(),c=f.coordinator();let reject!:(e:Error)=>void;f.prepare.mockImplementation(()=>new Promise((_r,j)=>{reject=j;}));const first=c.import(f.profile,'a'.repeat(64));await expect(c.import(f.profile,'a'.repeat(64))).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(()=>f.profiles.lock(f.profile.id,'删除')).toThrow('准备导入');reject(Error('Keychain denied'));await expect(first).rejects.toThrow('Keychain denied');expect(f.options.hold).not.toHaveBeenCalled();expect(f.options.open).not.toHaveBeenCalled();expect(f.profiles.importState(f.profile.id)).toBe('ready');
  });
  it('blocks pending profiles synchronously before startup and attempts recovery only once until explicit retry',async()=>{
    const f=fixture();f.journals.write({schemaVersion:1,profileId:f.profile.id,transactionId:randomUUID(),createdAt:1,changes:[{before:cookie('before'),after:cookie('after')}]});f.setAvailable(false);const c=f.coordinator();expect(()=>f.profiles.assertAvailable(f.profile.id)).toThrow('需要处理');await c.initialize();expect(f.profiles.importState(f.profile.id)).toBe('needs-attention');const opened=f.options.open.mock.calls.length;await c.initialize();expect(f.options.open).toHaveBeenCalledTimes(opened);expect(f.options.resume).not.toHaveBeenCalled();expect(f.journals.pending()).toEqual([f.profile.id]);f.setAvailable(true);await c.recover(f.profile);expect(f.values).toEqual([cookie('before')]);expect(f.profiles.importState(f.profile.id)).toBe('ready');expect(f.journals.pending()).toEqual([]);
  });
  it('does not open the native mutation store when page unload fails and keeps all access blocked',async()=>{
    const f=fixture(),c=f.coordinator();f.options.hold.mockRejectedValueOnce(Error('unload failed'));await expect(c.import(f.profile,'a'.repeat(64))).rejects.toThrow('unload failed');expect(f.options.open).not.toHaveBeenCalled();expect(f.values).toEqual([cookie('before')]);expect(f.profiles.importState(f.profile.id)).toBe('needs-attention');await c.recover(f.profile);expect(f.profiles.importState(f.profile.id)).toBe('ready');
  });
  it('still exposes needs-attention and preserves the original failure when the recovery directory cannot be inspected',async()=>{
    const f=fixture(),c=f.coordinator();vi.spyOn(f.journals,'remove').mockImplementation(()=>{throw Error('cleanup unavailable');});vi.spyOn(f.journals,'pending').mockImplementation(()=>{throw Error('directory inspection unavailable');});const set=f.store.set;f.store.set=async value=>{await set(value);if(value.value==='after')throw Error('write acknowledgement lost');};
    await expect(c.import(f.profile,'a'.repeat(64))).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE',stage:'cleanup'});expect(f.profiles.importState(f.profile.id)).toBe('needs-attention');expect(f.options.resume).not.toHaveBeenCalled();
  });
  it('resumes original pages only after successful immediate restoration of a failed write',async()=>{
    const f=fixture(),c=f.coordinator(),set=f.store.set;f.store.set=async value=>{await set(value);if(value.value==='after')throw Error('lost acknowledgement');};await expect(c.import(f.profile,'a'.repeat(64))).rejects.toMatchObject({code:'BROWSER_ERROR'});expect(f.values).toEqual([cookie('before')]);expect(f.options.resume).toHaveBeenCalledOnce();expect(f.profiles.importState(f.profile.id)).toBe('ready');
  });
  it('clears even an unreadable encrypted log only after durable user-clear intent; never resurrects it at next startup',async()=>{
    const f=fixture();f.journals.pending();writeFileSync(f.journals.path(f.profile.id),Buffer.from('corrupt encrypted data'),{mode:0o600});f.setAvailable(false);const c=f.coordinator();f.options.clear.mockImplementationOnce(async()=>{expect(f.journals.clearing()).toEqual([f.profile.id]);throw Error('clear interrupted');});await expect(c.clear(f.profile)).rejects.toThrow('clear interrupted');expect(f.journals.clearing()).toEqual([f.profile.id]);expect(f.journals.pending()).toEqual([f.profile.id]);expect(f.profiles.importState(f.profile.id)).toBe('needs-attention');const restarted=f.coordinator();await restarted.initialize();expect(f.values).toEqual([]);expect(f.journals.pending()).toEqual([]);expect(f.journals.clearing()).toEqual([]);expect(f.profiles.importState(f.profile.id)).toBe('ready');
  });
});

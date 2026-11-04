import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomBytes,createCipheriv,createDecipheriv,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BrowserImportJournals,browserImportCookieIdentity,type BrowserImportCookie} from '../cookie-import/journal';
import {BrowserCookieTransactions} from '../cookie-import/transactions';
import {planBrowserCookieImport} from '../cookie-import/plan';
import type {BrowserCookieMutationStore} from '../cookie-import/native-store';
const roots:string[]=[];afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const cookie=(name:string,value:string,domain='qa.example.test'):BrowserImportCookie=>({name,value,domain,path:'/',secure:true,httpOnly:true,hostOnly:true,sameSite:'lax',expirationDate:null,partitionKey:null});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'willyou-m12-cookie-transaction-')),key=randomBytes(32);roots.push(root);let available=true;
  const journals=new BrowserImportJournals(root,{isAvailable:()=>available,encrypt:text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text,'utf8'),c.final(),c.getAuthTag()]);},decrypt:bytes=>{const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12),{authTagLength:16});d.setAuthTag(bytes.subarray(-16));return Buffer.concat([d.update(bytes.subarray(12,-16)),d.final()]).toString('utf8');}}),profileId='11111111-1111-4111-8111-111111111111';
  const before=[cookie('X','old X'),cookie('Y','old Y'),cookie('Z','keep Z','other.example.test')],map=new Map(before.map(c=>[browserImportCookieIdentity(c),structuredClone(c)]));let writes=0;
  const store:BrowserCookieMutationStore={snapshot:async()=>[...map.values()].map(c=>({kind:'readable',cookie:structuredClone(c)})),set:async c=>{writes++;map.set(browserImportCookieIdentity(c),structuredClone(c));},remove:async c=>{writes++;map.delete(browserImportCookieIdentity(c));},flush:async()=>{}};
  const plan=planBrowserCookieImport({cookies:[cookie('X','new X'),cookie('W','new W')],preserveDomains:[],sourceCount:2,googleSkipped:0,partitionSkipped:0},before.map(c=>({kind:'readable',cookie:c})));
  return{journals,store,profileId,plan,before,engine:new BrowserCookieTransactions(journals),state:()=>[...map.values()].sort((a,b)=>a.name.localeCompare(b.name)),writes:()=>writes,setAvailable:(value:boolean)=>{available=value;}};
}
describe('Cookie import atomic mutation/recovery engine (software)',()=>{
  it('writes a complete durable journal before any native mutation and removes it after commit',async()=>{
    const f=fixture(),set=f.store.set.bind(f.store);f.store.set=async c=>{expect(f.journals.read(f.profileId)).toMatchObject({phase:'prepared',changes:f.plan.changes});await set(c);};await f.engine.apply(f.profileId,f.plan,f.store);expect(f.state().map(c=>[c.name,c.value])).toEqual([['W','new W'],['X','new X'],['Z','keep Z']]);expect(f.journals.pending()).toEqual([]);
  });
  it('rolls back every before value and removes absent-before W after a write applied but its acknowledgement failed',async()=>{
    const f=fixture(),set=f.store.set.bind(f.store);f.store.set=async c=>{await set(c);if(c.name==='W'&&c.value==='new W')throw Error('write happened but acknowledgement lost');};await expect(f.engine.apply(f.profileId,f.plan,f.store)).rejects.toMatchObject({code:'BROWSER_ERROR'});expect(f.state()).toEqual(f.before);expect(f.journals.pending()).toEqual([]);
  });
  it('keeps the encrypted full journal after restoration fails and lets a newly created engine finish recovery',async()=>{
    const f=fixture(),set=f.store.set.bind(f.store);f.store.set=async c=>{if(c.name==='W'&&c.value==='new W'||c.name==='Y'&&c.value==='old Y')throw Error('injected source/restoration failure');await set(c);};await expect(f.engine.apply(f.profileId,f.plan,f.store)).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE',stage:'restore'});expect(f.journals.read(f.profileId)).toMatchObject({phase:'prepared',changes:f.plan.changes});f.store.set=set;
    expect(await new BrowserCookieTransactions(f.journals).recover(f.profileId,f.store)).toBe('restored');expect(f.state()).toEqual(f.before);expect(f.journals.pending()).toEqual([]);
  });
  it('restores a pre-commit interrupted import, including an old journal without a phase field',async()=>{
    const f=fixture();f.journals.write({schemaVersion:1,transactionId:randomUUID(),profileId:f.profileId,createdAt:1,changes:f.plan.changes});for(const change of f.plan.changes){const c=change.after??change.before;if(c)await f.store.remove(c);}await f.store.set(cookie('X','new X'));await f.store.set(cookie('W','new W'));
    expect(await f.engine.recover(f.profileId,f.store)).toBe('restored');expect(f.state()).toEqual(f.before);
  });
  it('does not replay or roll back native writes when the durable commit completed but its acknowledgement failed',async()=>{
    const f=fixture(),commit=f.journals.commit.bind(f.journals);vi.spyOn(f.journals,'commit').mockImplementation((id,tx)=>{commit(id,tx);throw Error('lost final commit acknowledgement');});await expect(f.engine.apply(f.profileId,f.plan,f.store)).rejects.toMatchObject({stage:'commit'});expect(f.journals.read(f.profileId)?.phase).toBe('committed');const before=f.state(),writes=f.writes();expect(await f.engine.recover(f.profileId,f.store)).toBe('committed');expect(f.writes()).toBe(writes);expect(f.state()).toEqual(before);expect(f.journals.pending()).toEqual([]);
  });
  it('keeps a committed journal when cleanup fails and retries only its cleanup',async()=>{
    const f=fixture(),remove=vi.spyOn(f.journals,'remove').mockImplementation(()=>{throw Error('cleanup failed');});await expect(f.engine.apply(f.profileId,f.plan,f.store)).rejects.toMatchObject({stage:'cleanup'});expect(f.journals.read(f.profileId)?.phase).toBe('committed');const writes=f.writes();remove.mockRestore();expect(await f.engine.recover(f.profileId,f.store)).toBe('committed');expect(f.writes()).toBe(writes);
  });
  it('rejects concurrent imports and existing recovery records before any second write',async()=>{
    const f=fixture(),set=f.store.set.bind(f.store);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});let first=true;f.store.set=async c=>{if(first){first=false;entered();await gate;}await set(c);};const active=f.engine.apply(f.profileId,f.plan,f.store);await started;const writes=f.writes();await expect(f.engine.apply(f.profileId,f.plan,f.store)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(f.writes()).toBe(writes);release();await active;
    f.journals.write({schemaVersion:1,transactionId:randomUUID(),profileId:f.profileId,createdAt:1,changes:f.plan.changes});await expect(f.engine.apply(f.profileId,f.plan,f.store)).rejects.toMatchObject({code:'RESOURCE_BUSY'});
  });
  it('does not write target cookies when encryption is unavailable or the snapshotted target changed',async()=>{
    const f=fixture();f.setAvailable(false);await expect(f.engine.apply(f.profileId,f.plan,f.store)).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(f.writes()).toBe(0);expect(f.state()).toEqual(f.before);f.setAvailable(true);await f.store.set(cookie('X','changed externally'));const writes=f.writes();await expect(f.engine.apply(f.profileId,f.plan,f.store)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});expect(f.writes()).toBe(writes);expect(f.journals.pending()).toEqual([]);
  });
});

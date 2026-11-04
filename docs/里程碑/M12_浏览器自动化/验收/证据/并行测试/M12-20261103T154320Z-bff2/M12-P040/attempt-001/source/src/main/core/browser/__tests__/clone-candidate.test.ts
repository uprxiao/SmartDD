import {afterEach,describe,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {BrowserProfiles} from '../profiles';
import {BrowserSiteStates} from '../site-state';
const databases:Database.Database[]=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
function fixture(){const sqlite=new Database(':memory:');databases.push(sqlite);sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');const grants=new Set<string>(),options={sqlite,taskProject:(id:string)=>id==='T1'||id==='T2'?'P1':null,authorized:(_caller:unknown,id:string)=>grants.has(id)},profiles=new BrowserProfiles(options),sites=new BrowserSiteStates(sqlite,id=>!!profiles.known(id)),caller={taskId:'T1',projectId:'P1'};return{sqlite,options,profiles,sites,caller,grants};}
describe('unpublished clone metadata and source read lock (actual SQLite)',()=>{
  it('keeps the candidate private until publish, then copies trusted site state independently in the same commit',()=>{
    const f=fixture(),source=f.profiles.ensureProject('P1');f.sites.trust(source.id,'qa.example.test');f.sites.decide(source.id,'https://qa.example.test',['geolocation'],'allow');const prepared=f.profiles.prepareClone(f.caller,source.id),policy=f.sites.snapshot(source.id);expect(f.profiles.list(f.caller).map(p=>p.id)).not.toContain(prepared.profile.id);expect(new BrowserProfiles(f.options).known(prepared.profile.id)).toBeUndefined();prepared.publish(()=>{},()=>f.sites.inherit(prepared.profile.id,policy),()=>f.sites.invalidate(prepared.profile.id));
    expect(prepared.profile).toMatchObject({scope:'isolated',owner:{kind:'task',id:'T1'},label:'项目登录态（副本）'});expect(f.sites.snapshot(prepared.profile.id)).toEqual(policy);f.sites.revokeCertificate(prepared.profile.id,'qa.example.test');expect(f.sites.trusted(source.id,'qa.example.test')).toBe(true);expect(new BrowserProfiles(f.options).known(prepared.profile.id)).toEqual(prepared.profile);
  });
  it('rolls back both metadata and policy cache when publication fails, without changing the source',()=>{
    const f=fixture(),source=f.profiles.ensureProject('P1');f.sites.trust(source.id,'qa.example.test');const prepared=f.profiles.prepareClone(f.caller,source.id);expect(()=>prepared.publish(()=>{},()=>{f.sites.inherit(prepared.profile.id,f.sites.snapshot(source.id));throw Error('publication interrupted');},()=>f.sites.invalidate(prepared.profile.id))).toThrow('publication interrupted');expect(f.profiles.known(prepared.profile.id)).toBeUndefined();expect(new BrowserProfiles(f.options).known(prepared.profile.id)).toBeUndefined();prepared.publish();expect(f.sites.snapshot(prepared.profile.id).certificates).toEqual([]);expect(f.sites.trusted(source.id,'qa.example.test')).toBe(true);
  });
  it('excludes lifecycle writes during copy while leaving source availability unchanged, then rechecks scope at publish',()=>{
    const f=fixture(),source=f.profiles.create({taskId:'T2',projectId:'P1'},'共享');f.grants.add('T2');const candidate=f.profiles.prepareClone(f.caller,source.id),release=f.profiles.lockForCopy(source.id);expect(()=>f.profiles.assertAvailable(source.id)).not.toThrow();expect(()=>f.profiles.lock(source.id,'导入')).toThrow('复制');f.grants.delete('T2');expect(()=>candidate.publish()).toThrow('无权');release();const next=f.profiles.lock(source.id,'删除');release();expect(()=>f.profiles.assertAvailable(source.id)).toThrow('正在删除');next();expect(f.profiles.known(candidate.profile.id)).toBeUndefined();
  });
});

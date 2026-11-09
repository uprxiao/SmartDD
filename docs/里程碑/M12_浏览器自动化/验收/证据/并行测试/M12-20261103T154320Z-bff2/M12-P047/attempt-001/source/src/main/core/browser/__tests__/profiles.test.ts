import {describe,it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {BrowserProfiles,browserProjectProfile} from '../profiles';
const caller={taskId:'T1',projectId:'P1'};
function fixture(){
  const sqlite=new Database(':memory:');sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  const projects=new Map([['T1','P1'],['T2','P1'],['T3','P2']]),grants=new Set<string>();
  const options={sqlite,taskProject:(id:string)=>projects.get(id)??null,authorized:(_caller:typeof caller,task:string,mode:string)=>grants.has(task+':'+mode)||mode==='observe'&&grants.has(task+':control')};
  return{sqlite,options,grants,projects,profiles:new BrowserProfiles(options)};
}
describe('browser profile ownership and durable metadata',()=>{
  it('restores same-project native bindings without granting CLI visibility or crossing deleted/foreign owners',()=>{
    const f=fixture();try{const other=f.profiles.create({taskId:'T2',projectId:'P1'},'Other'),foreign=f.profiles.ensureProject('P2');expect(f.profiles.binding('T1','P1',other.id)).toEqual(other);expect(()=>f.profiles.require(caller,other.id)).toThrow('无权');expect(()=>f.profiles.binding('T1','P1',foreign.id)).toThrow();expect(()=>f.profiles.binding('T1','P2',other.id)).toThrow();f.projects.delete('T2');expect(()=>f.profiles.binding('T1','P1',other.id)).toThrow();}finally{f.sqlite.close();}
  });
  it('excludes concurrent partition mutations and releases availability only once',()=>{
    const f=fixture();try{const p=f.profiles.create(caller,'work'),release=f.profiles.lock(p.id,'导入');expect(()=>f.profiles.assertAvailable(p.id)).toThrow('正在导入');expect(()=>f.profiles.lock(p.id,'删除')).toThrow('正在导入');expect(f.profiles.require(caller,p.id)).toEqual(p);release();const next=f.profiles.lock(p.id,'删除');release();expect(()=>f.profiles.assertAvailable(p.id)).toThrow('正在删除');next();expect(()=>f.profiles.assertAvailable(p.id)).not.toThrow();}finally{f.sqlite.close();}
  });
  it('preserves the legacy default partition and only creates one per project',()=>{
    const f=fixture();try{const a=f.profiles.ensureProject('P1'),b=f.profiles.ensureProject('P1');expect(a).toEqual(b);expect(a.id).toBe(browserProjectProfile('P1'));expect(a.partition).toBe('persist:wy-browser-'+a.id);expect(new BrowserProfiles(f.options).list(caller)).toEqual([a]);}finally{f.sqlite.close();}
  });
  it('hides other tasks/projects and gives nonexistent IDs the same refusal',()=>{
    const f=fixture();try{const own=f.profiles.create(caller,'Own'),other=f.profiles.create({taskId:'T2',projectId:'P1'},'Other'),foreign=f.profiles.ensureProject('P2');expect(f.profiles.list(caller).map(p=>p.id)).toContain(own.id);expect(f.profiles.list(caller).map(p=>p.id)).not.toContain(other.id);for(const id of [other.id,foreign.id,'not-existing'])expect(()=>f.profiles.require(caller,id)).toThrow('当前运行无权访问该登录态');f.grants.add('T2:observe');expect(f.profiles.require(caller,other.id)).toEqual(other);expect(()=>f.profiles.deletable(caller,other.id)).toThrow('无权');f.grants.add('T2:control');expect(f.profiles.deletable(caller,other.id)).toEqual(other);expect(()=>f.profiles.require(caller,foreign.id)).toThrow('无权');}finally{f.sqlite.close();}
  });
  it('never treats imported scope as permission to import or changes project ownership',()=>{
    const f=fixture();try{const p=f.profiles.create(caller,' Imported ','imported');expect(p).toMatchObject({scope:'imported',label:'Imported',owner:{kind:'task',id:'T1'},source:null});expect(()=>f.profiles.deletable(caller,f.profiles.ensureProject('P1').id)).toThrow('不可单独删除');expect(()=>f.profiles.create(caller,' ')).toThrow('1到120');const before=f.profiles.all();expect(()=>f.profiles.list({taskId:'T1',projectId:'SPOOF'})).toThrow('不属于');expect(f.profiles.all()).toEqual(before);}finally{f.sqlite.close();}
  });
  it('fails closed on a persisted foreign partition and preserves the original record',()=>{
    const f=fixture();try{const value=JSON.stringify({schemaVersion:1,profiles:[{id:'11111111-1111-4111-8111-111111111111',scope:'isolated',label:'x',owner:{kind:'task',id:'T1'},source:null,partition:'persist:daily-profile'}]});f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('browserProfiles.v1',value,1);expect(()=>new BrowserProfiles(f.options)).toThrow('原数据已保留');expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserProfiles.v1')).toEqual({value});}finally{f.sqlite.close();}
  });
  it('refuses growth past 4MiB before dispatch and preserves the existing profiles',()=>{
    const f=fixture();try{
      const template={id:'00000000-1111-4111-8111-111111111111',scope:'isolated',partition:'persist:wy-browser-00000000-1111-4111-8111-111111111111',label:'x'.repeat(120),owner:{kind:'task',id:'T1'},source:null};
      const overhead=Buffer.byteLength(JSON.stringify({schemaVersion:1,profiles:[]})),unit=Buffer.byteLength(JSON.stringify(template)),count=Math.floor((4*1024*1024-overhead+1)/(unit+1));
      const profiles=Array.from({length:count},(_,index)=>{const id=index.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111';return{...template,id,partition:'persist:wy-browser-'+id};}),value=JSON.stringify({schemaVersion:1,profiles});
      f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,?)').run('browserProfiles.v1',value,1);const loaded=new BrowserProfiles(f.options);let dispatched=false;
      expect(()=>loaded.create(caller,'x'.repeat(120),'isolated',()=>{dispatched=true;})).toThrow('4MiB');expect(dispatched).toBe(false);expect(loaded.all()).toHaveLength(count);expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserProfiles.v1')).toEqual({value});
    }finally{f.sqlite.close();}
  });
});

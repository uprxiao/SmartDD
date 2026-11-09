import {afterEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {BrowserWorkspace} from '../workspace';
import {BrowserPageRegistry,browserProjectProfile} from '../page-registry';
describe('browser workspace persistence and startup pages (software only)',()=>{
  const stores:Database.Database[]=[];
  afterEach(()=>{for(const db of stores.splice(0))db.close();});
  function fixture(){const sqlite=new Database(':memory:');stores.push(sqlite);sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');const pages=new BrowserPageRegistry({userData:'/private/tmp/m12-unit-unused',helper:{executable:'/must-not-run',sha256:'0'.repeat(64)}}),create=vi.spyOn(pages,'create'),removed=new Set<string>();const options={sqlite,pages,taskProject:(id:string)=>id==='no-project'||removed.has(id)?null:id==='t3'?'p2':'p1'};return{sqlite,pages,create,removed,options,workspace:new BrowserWorkspace(options)};}
  it('does not allocate a native view for startup tabs; restores isolated task records without touching M9 bytes',()=>{
    const f=fixture(),file=JSON.stringify({legacy:'exact bytes remain',scroll:42});f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('fileWorkspace.v1:task:t1',file);
    f.workspace.create('t1');f.workspace.create('t1');f.workspace.create('t2');const original=f.workspace.snapshot('t1');f.workspace.select('t1',original.tabs[0].id);f.workspace.dispose();
    const restored=new BrowserWorkspace(f.options);expect(restored.snapshot('t1').tabs.map(t=>t.id)).toEqual(original.tabs.map(t=>t.id));expect(restored.snapshot('t1').activeId).toBe(original.tabs[0].id);expect(restored.snapshot('t2').tabs).toHaveLength(1);expect(f.create).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('fileWorkspace.v1:task:t1')).toEqual({value:file});restored.dispose();
  });
  it('retains exactly the last ten closed tabs and refuses tasks without projects',async()=>{
    const f=fixture();for(let i=0;i<12;i++)f.workspace.create('t1');const ids=f.workspace.snapshot('t1').tabs.map(t=>t.id);for(const id of ids)await f.workspace.close('t1',id);for(let i=0;i<11;i++)f.workspace.reopen('t1');expect(f.workspace.snapshot('t1').tabs).toHaveLength(10);expect(f.create).not.toHaveBeenCalled();expect(()=>f.workspace.create('no-project')).toThrow('项目');f.workspace.dispose();
  });
  it('changes unloaded bindings without allocating an engine and removes deleted profiles from reopen/restart records',async()=>{
    const f=fixture();try{
      f.workspace.create('t1');f.workspace.create('t1');const ids=f.workspace.snapshot('t1').tabs.map(tab=>tab.id),profile='11111111-1111-4111-8111-111111111111';let writes=0;
      await f.workspace.setProfile('t1',ids[0],profile,()=>{},()=>{writes++;});await f.workspace.setProfile('t1',ids[1],profile,()=>{},()=>{writes++;});await f.workspace.close('t1',ids[1]);
      f.workspace.create('t2');const replacement=f.workspace.snapshot('t2').tabs[0].profileId;
      await f.workspace.removeProfileBindings(profile,()=>replacement,()=>{},()=>{writes++;});
      expect(writes).toBe(3);expect(f.workspace.snapshot('t1').tabs[0]).toMatchObject({id:ids[0],profileId:replacement});f.workspace.reopen('t1');expect(f.workspace.snapshot('t1').tabs.every(tab=>tab.profileId===replacement)).toBe(true);expect(f.create).not.toHaveBeenCalled();
      const restored=new BrowserWorkspace(f.options);expect(restored.snapshot('t1').tabs.every(tab=>tab.profileId===replacement)).toBe(true);await restored.dispose();
    }finally{await f.workspace.dispose();}
  });
  it('does not change an unloaded profile binding when admission is revoked',async()=>{
    const f=fixture();try{f.workspace.create('t1');const before=f.workspace.snapshot('t1');await expect(f.workspace.setProfile('t1',before.tabs[0].id,'11111111-1111-4111-8111-111111111111',()=>{throw new Error('revoked');},()=>{throw new Error('must not dispatch');})).rejects.toThrow('revoked');expect(f.workspace.snapshot('t1')).toEqual(before);expect(f.create).not.toHaveBeenCalled();}finally{await f.workspace.dispose();}
  });
  it('cleans persisted orphan task tabs on startup without first loading their workspace',async()=>{
    const f=fixture();f.workspace.create('t1');await f.workspace.dispose();f.removed.add('t1');const restored=new BrowserWorkspace(f.options);
    try{await restored.reconcile();expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1')).toBeUndefined();expect(f.create).not.toHaveBeenCalled();}finally{await restored.dispose();}
  });
  function savedPage(f:ReturnType<typeof fixture>){
    const id='11111111-1111-4111-8111-111111111111';
    f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('browserWorkspace.v1:t1',JSON.stringify({version:1,tabs:[{id,url:'https://fixture.example/',title:'Fixture',favicon:null,profileId:browserProjectProfile('p1')}],activeId:id,closed:[]}));
    return id;
  }
  it('ignores a late viewport placement after shutdown without restoring a native page',async()=>{
    const f=fixture(),id=savedPage(f);f.create.mockRejectedValue(new Error('Native allocation must not be reached'));
    await f.workspace.dispose();await expect(f.workspace.placement('t1',id,{x:0,y:0,width:500,height:400})).resolves.toBeUndefined();expect(f.create).not.toHaveBeenCalled();
  });
  it('rejects a late target restoration after shutdown and preserves the saved tab',async()=>{
    const f=fixture(),id=savedPage(f),before=f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1');f.create.mockRejectedValue(new Error('Native allocation must not be reached'));
    await f.workspace.dispose();await expect(f.workspace.target('t1',id)).rejects.toMatchObject({code:'BROWSER_UNAVAILABLE'});expect(f.create).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1')).toEqual(before);
  });
});

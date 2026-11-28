import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import Database from 'better-sqlite3';
import {BrowserWorkspace} from '../workspace';
import {BrowserPageRegistry,browserProjectProfile,type BrowserPage} from '../page-registry';
describe('browser workspace persistence and startup pages (software only)',()=>{
  const stores:Database.Database[]=[];
  afterEach(()=>{for(const db of stores.splice(0))db.close();});
  function fixture(){const sqlite=new Database(':memory:');stores.push(sqlite);sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');const pages=new BrowserPageRegistry({userData:'/private/tmp/m12-unit-unused',helper:{executable:'/must-not-run',sha256:'0'.repeat(64)}}),create=vi.spyOn(pages,'create'),removed=new Set<string>();const options={sqlite,pages,taskProject:(id:string)=>id==='no-project'||removed.has(id)?null:id==='t3'?'p2':'p1'};return{sqlite,pages,create,removed,options,workspace:new BrowserWorkspace(options)};}
  it('does not allocate a native view for startup tabs; restores isolated task records without touching M9 bytes',()=>{
    const f=fixture(),file=JSON.stringify({legacy:'exact bytes remain',scroll:42});f.sqlite.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('fileWorkspace.v1:task:t1',file);
    f.workspace.create('t1');f.workspace.create('t1');f.workspace.create('t2');const original=f.workspace.snapshot('t1');f.workspace.select('t1',original.tabs[0].id);f.workspace.dispose();
    const restored=new BrowserWorkspace(f.options);expect(restored.snapshot('t1').tabs.map(t=>t.id)).toEqual(original.tabs.map(t=>t.id));expect(restored.snapshot('t1').activeId).toBe(original.tabs[0].id);expect(restored.snapshot('t2').tabs).toHaveLength(1);expect(f.create).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('fileWorkspace.v1:task:t1')).toEqual({value:file});restored.dispose();
  });
  it('returns the new tab and its pending address before the browser engine finishes opening', async () => {
    const f = fixture(), url = 'https://example.test/slow';
    let finish!: (page: BrowserPage) => void;
    f.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const navigate = vi.spyOn(f.pages, 'navigate').mockResolvedValue();
    const state = f.workspace.create('t1', url);
    const id = state.activeId!;
    try {
      expect(state.tabs).toMatchObject([{ id, url: 'about:blank', pendingUrl: url, loading: true }]);
      const { value } = f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1') as {value: string};
      expect(JSON.parse(value).tabs[0]).not.toHaveProperty('pendingUrl');
      expect(JSON.parse(value).tabs[0].url).toBe('about:blank');
      await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
      expect(navigate).not.toHaveBeenCalled();
      const page = { id, taskId: 't1', closed: false } as BrowserPage;
      finish(page);
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(page, url));
      await vi.waitFor(() => expect(f.workspace.snapshot('t1').tabs[0].loading).toBe(false));
    } finally { await f.workspace.dispose(); }
  });
  it('keeps an initial engine failure on its own tab and retries the requested address', async () => {
    const f = fixture(), url = 'https://example.test/retry';
    f.create.mockRejectedValueOnce(new Error('synthetic engine failure'));
    const navigate = vi.spyOn(f.pages, 'navigate').mockResolvedValue();
    const id = f.workspace.create('t1', url).activeId!;
    try {
      await vi.waitFor(() => expect(f.workspace.snapshot('t1').tabs[0]).toMatchObject({ id, loading: false, failure: { url } }));
      const page = { id, taskId: 't1', closed: false, contents: { reload: vi.fn() } } as unknown as BrowserPage;
      f.create.mockResolvedValueOnce(page);
      const retry = f.workspace.action('t1', id, 'reload');
      expect(f.workspace.snapshot('t1').tabs[0]).toMatchObject({ id, pendingUrl: url, loading: true, failure: null });
      await retry;
      expect(navigate).toHaveBeenCalledExactlyOnceWith(page, url);
      expect(page.contents.reload).not.toHaveBeenCalled();
    } finally { await f.workspace.dispose(); }
  });
  it('stops a pending tab without loading the address after the engine becomes ready', async () => {
    const f = fixture(), url = 'https://example.test/cancel';
    let finish!: (page: BrowserPage) => void;
    f.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const navigate = vi.spyOn(f.pages, 'navigate').mockResolvedValue();
    const id = f.workspace.create('t1', url).activeId!;
    try {
      await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
      await f.workspace.action('t1', id, 'stop');
      expect(f.workspace.snapshot('t1').tabs[0]).toMatchObject({ id, url: 'about:blank', loading: false });
      expect(f.workspace.snapshot('t1').tabs[0]).not.toHaveProperty('pendingUrl');
      finish({ id, taskId: 't1', closed: false } as BrowserPage);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(navigate).not.toHaveBeenCalled();
    } finally { await f.workspace.dispose(); }
  });
  it('closes a pending tab even if native startup fails while it is closing', async () => {
    const f = fixture();
    let fail!: (reason: Error) => void;
    f.create.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const id = f.workspace.create('t1', 'https://example.test/close').activeId!;
    try {
      await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
      const close = f.workspace.close('t1', id);
      fail(new Error('synthetic engine failure'));
      expect(await close).toMatchObject({ tabs: [], activeId: null });
      expect(f.workspace.snapshot('t1').tabs).toEqual([]);
    } finally { await f.workspace.dispose(); }
  });
  it('M16 B04 commits close history before physical teardown and rolls back a failed durable admission',async()=>{
    const f=fixture(),id=f.workspace.create('t1').activeId!;
    const page={id,taskId:'t1',closed:false} as BrowserPage;
    const list=vi.spyOn(f.pages,'list').mockImplementation(task=>task==='t1'?[page]:[]);
    vi.spyOn(f.pages,'isMounted').mockReturnValue(false);
    let release!:()=>void;const closeNative=vi.spyOn(f.pages,'close').mockImplementation(async()=>{await new Promise<void>(resolve=>{release=resolve;});list.mockReturnValue([]);});
    const persisted=()=>JSON.parse((f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1') as {value:string}).value);
    try{
      const original=persisted();
      f.sqlite.exec("CREATE TRIGGER fail_fixture_close BEFORE UPDATE ON app_settings WHEN OLD.key='browserWorkspace.v1:t1' BEGIN SELECT RAISE(ABORT,'synthetic save failure'); END");
      await expect(f.workspace.close('t1',id)).rejects.toThrow('synthetic save failure');
      expect(persisted()).toEqual(original);expect(f.workspace.snapshot('t1')).toMatchObject({activeId:id,tabs:[{id}]});expect(closeNative).not.toHaveBeenCalled();
      f.sqlite.exec('DROP TRIGGER fail_fixture_close');
      const closing=f.workspace.close('t1',id);
      await vi.waitFor(()=>expect(closeNative).toHaveBeenCalledOnce());
      expect(persisted()).toMatchObject({activeId:null,tabs:[],closed:[{id}]});
      expect(f.workspace.savedTab('t1',id)).toBeUndefined();
      expect(()=>f.workspace.reserveAgentOpen('t1',{pageId:id,profileId:browserProjectProfile('p1'),forceNew:false})).toThrow();
      const repeat=f.workspace.close('t1',id);
      const next=f.workspace.reserveAgentOpen('t1',{url:'https://fixture.example/new',profileId:browserProjectProfile('p1'),forceNew:false});
      expect(next.pageId).not.toBe(id);expect(persisted().closed).toHaveLength(1);
      release();expect(await closing).toEqual(await repeat);expect(closeNative).toHaveBeenCalledOnce();
      expect(persisted()).toMatchObject({tabs:[{id:next.pageId}],closed:[{id}]});
    }finally{release?.();await f.workspace.dispose();}
  });
  it('retains exactly the last ten closed tabs and refuses tasks without projects',async()=>{
    const f=fixture();for(let i=0;i<12;i++)f.workspace.create('t1');const ids=f.workspace.snapshot('t1').tabs.map(t=>t.id);for(const id of ids)await f.workspace.close('t1',id);for(let i=0;i<11;i++)f.workspace.reopen('t1');expect(f.workspace.snapshot('t1').tabs).toHaveLength(10);expect(f.create).not.toHaveBeenCalled();expect(()=>f.workspace.create('no-project')).toThrow('项目');f.workspace.dispose();
  });
  it('publishes each live activity deadline once per snapshot and never restores it from persisted tabs',async()=>{
    const f=fixture(),activity=vi.fn(()=>({active:true,running:false,holdUntil:42000})),live=new BrowserWorkspace({...f.options,activity});
    try{
      live.create('t1');activity.mockClear();
      expect(live.snapshot('t1').tabs[0]).toMatchObject({agentActive:true,agentRunning:false,agentHoldUntil:42000});
      expect(activity).toHaveBeenCalledTimes(1);
      const saved=f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1') as {value:string};
      expect(JSON.parse(saved.value).tabs[0]).not.toHaveProperty('agentHoldUntil');
      expect(JSON.parse(saved.value).tabs[0]).not.toHaveProperty('agentActive');
      await live.dispose();const restored=new BrowserWorkspace(f.options);
      try{expect(restored.snapshot('t1').tabs[0].agentHoldUntil).toBeUndefined();expect(f.create).not.toHaveBeenCalled();}finally{await restored.dispose();}
    }finally{await live.dispose();await f.workspace.dispose();}
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
  it('ignores a real page late navigation/title event after the task owner has already been deleted',async()=>{
    const f=fixture();await f.workspace.dispose();let event!:Parameters<BrowserPageRegistry['observe']>[0];
    vi.spyOn(f.pages,'observe').mockImplementation(listener=>{event=listener;return()=>{};});
    const changed=vi.fn(),workspace=new BrowserWorkspace({...f.options,changed}),id=workspace.create('t1').activeId!;
    let url='about:blank',title='Original';const wc=Object.assign(new EventEmitter(),{getURL:()=>url,getTitle:()=>title,isDestroyed:()=>false,isLoading:()=>false,navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},setWindowOpenHandler:vi.fn()});
    const page={id,taskId:'t1',kind:'tab',profileId:browserProjectProfile('p1'),contents:wc,closed:false} as unknown as BrowserPage;
    try{
      event({type:'created',page});const before=f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1');
      f.removed.add('t1');changed.mockClear();url='https://fixture.example/late';title='Late';
      expect(()=>wc.emit('did-navigate')).not.toThrow();expect(()=>wc.emit('page-title-updated',{},'Late title')).not.toThrow();
      expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1')).toEqual(before);
      expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserRecent.v1:p1')).toBeUndefined();expect(changed).not.toHaveBeenCalled();
    }finally{await workspace.dispose();}
  });
  it('retires a late native initialization for a removed owner before any navigation can start',async()=>{
    const f=fixture();let finish!:(page:BrowserPage)=>void;f.create.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    const navigate=vi.spyOn(f.pages,'navigate').mockResolvedValue(),close=vi.spyOn(f.pages,'close').mockResolvedValue();
    const id=f.workspace.create('t1','https://fixture.example/late-start').activeId!;
    try{await vi.waitFor(()=>expect(f.create).toHaveBeenCalledOnce());f.removed.add('t1');
      finish({id,taskId:'t1',closed:false} as BrowserPage);await vi.waitFor(()=>expect(close).toHaveBeenCalledWith('t1',id));expect(navigate).not.toHaveBeenCalled();
      await f.workspace.reconcile();expect(f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:t1')).toBeUndefined();
    }finally{await f.workspace.dispose();}
  });
  it('distinguishes archived inactive scope from a permanently removed browser owner',async()=>{
    const f=fixture();await f.workspace.dispose();const durable=new Set(['t1','t2']),workspace=new BrowserWorkspace({...f.options,taskOwnerExists:id=>durable.has(id)});
    try{workspace.create('t1');workspace.create('t2');const read=(id:string)=>f.sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get('browserWorkspace.v1:'+id),archived=read('t1'),neighbor=read('t2');
      f.removed.add('t1');await workspace.reconcile();expect(read('t1')).toEqual(archived);expect(read('t2')).toEqual(neighbor);
      durable.delete('t1');await workspace.reconcile();expect(read('t1')).toBeUndefined();expect(read('t2')).toEqual(neighbor);
    }finally{await workspace.dispose();}
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
  it('keeps a dialog parked when an independent tab tooltip closes',async()=>{
    const f=fixture(),id=savedPage(f),image={getSize:()=>({width:800,height:600}),toJPEG:()=>Buffer.from('page')};
    const page={id,contents:{capturePage:vi.fn().mockResolvedValue(image)}} as unknown as BrowserPage;
    vi.spyOn(f.pages,'list').mockReturnValue([page]);const place=vi.spyOn(f.pages,'placement').mockResolvedValue();
    try{
      await f.workspace.overlay('t1',id,true,true,'tab-tooltip:1');await f.workspace.overlay('t1',id,true);
      await f.workspace.overlay('t1',id,false,true,'tab-tooltip:1');place.mockClear();
      await f.workspace.placement('t1',id,{x:1,y:1,width:800,height:600});expect(place).not.toHaveBeenCalled();
      await f.workspace.overlay('t1',id,false);await f.workspace.placement('t1',id,{x:1,y:1,width:800,height:600});
      expect(place).toHaveBeenCalledWith('t1',id,{x:1,y:1,width:800,height:600},expect.any(Function));
    }finally{await f.workspace.dispose();}
  });
  it('does not park after an obsolete tooltip capture resolves, or release a dialog when capture fails',async()=>{
    const f=fixture(),id=savedPage(f);let resolve!:(image:unknown)=>void,reject!:(error:Error)=>void;
    const capturePage=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));
    const page={id,contents:{capturePage}} as unknown as BrowserPage;
    vi.spyOn(f.pages,'list').mockReturnValue([page]);const place=vi.spyOn(f.pages,'placement').mockResolvedValue();
    try{
      const cancelled=f.workspace.overlay('t1',id,true,true,'tab-tooltip:1');await f.workspace.overlay('t1',id,false,true,'tab-tooltip:1');
      resolve({getSize:()=>({width:800,height:600}),toJPEG:()=>Buffer.from('page')});expect(await cancelled).toBeNull();expect(place).not.toHaveBeenCalled();
      await f.workspace.overlay('t1',id,true,false);place.mockClear();
      const failed=f.workspace.overlay('t1',id,true,true,'tab-tooltip:2');reject(new Error('capture failed'));await expect(failed).rejects.toThrow('capture failed');
      await f.workspace.placement('t1',id,{x:1,y:1,width:800,height:600});expect(place).not.toHaveBeenCalled();
    }finally{await f.workspace.dispose();}
  });

});

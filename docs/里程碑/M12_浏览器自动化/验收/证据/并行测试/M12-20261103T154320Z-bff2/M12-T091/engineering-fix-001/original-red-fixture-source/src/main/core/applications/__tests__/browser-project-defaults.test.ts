import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {ApplicationConnectionService} from '../connection-service';
import {ApplicationSelectionService} from '../selection-service';
import {ResourceStore} from '../resource-store';
import {installBrowserProjectDefaults} from '../browser-project-defaults';

let sqlite:Database.Database,root:string,projects:ProjectService,selections:ApplicationSelectionService;
const create=(name:string)=>projects.createProject({name,aliases:[],description:'',rulesPath:null});
beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'willyou-browser-defaults-'));
  sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);
  const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});
  projects=new ProjectService(db,secrets);
  const store=new ResourceStore(sqlite,root),connections=new ApplicationConnectionService(store,secrets,{verify:async()=>{throw Error('Default browser must never verify a connection');}});
  selections=new ApplicationSelectionService(store,connections,{requireProject:id=>projects.getProject(id),stopProjectRuns:async()=>true,runningInProject:()=>0});
});
afterEach(()=>{sqlite.close();rmSync(root,{recursive:true,force:true});});

describe('M12 new project browser default without upgrading old project selections',()=>{
  it('selects only browser for projects created after host registration and persists its normal selection receipt',()=>{
    const old=create('Before M12');installBrowserProjectDefaults(projects,selections);const fresh=create('New project');
    expect(selections.projectSettings(old.id,'browser')).toMatchObject({enabled:false,revision:0});
    expect(selections.projectSettings(fresh.id,'browser')).toMatchObject({added:true,enabled:true,revision:1,connections:{},policyRevision:1});
    expect(selections.catalogState('browser')).toMatchObject({added:true,enabled:true});
    for(const appId of ['mail','zentao'] as const)expect(selections.projectSettings(fresh.id,appId)).toMatchObject({enabled:false,revision:0});
    expect(sqlite.prepare('SELECT state,to_revision FROM application_binding_changes WHERE project_id=? AND app_id=?').all(fresh.id,'browser')).toEqual([{state:'committed',to_revision:1}]);
  });
  it('preserves a cancelled project while later new projects get their own default',async()=>{
    installBrowserProjectDefaults(projects,selections);const first=create('Cancelled');
    await selections.select({projectId:first.id,appId:'browser',enabled:false,expectedRevision:1,connections:{}});
    const second=create('Later new project');
    expect(selections.projectSettings(first.id,'browser')).toMatchObject({enabled:false,revision:2});
    expect(selections.projectSettings(second.id,'browser')).toMatchObject({enabled:true,revision:1});
  });
  it.each(['disabled','removed'] as const)('does not undo a prior global browser %s decision',async mode=>{
    await selections.setAdded('browser',true,0);
    if(mode==='disabled')await selections.setGlobalEnabled('browser',false,1);else await selections.setAdded('browser',false,1);
    const before=selections.catalogState('browser');installBrowserProjectDefaults(projects,selections);const fresh=create('Global choice retained');
    expect(selections.catalogState('browser')).toEqual(before);
    expect(()=>selections.requireEnabled(fresh.id,'browser')).toThrow();
  });
  it('rolls project, default catalogue and selection receipt back together when creation fails',()=>{
    installBrowserProjectDefaults(projects,selections);const cancel=projects.onCreated(()=>{throw Error('Creation did not commit');});
    expect(()=>create('Must roll back')).toThrow('Creation did not commit');cancel();
    expect(projects.listProjects()).toEqual([]);
    for(const table of ['application_catalog_state','application_project_settings','application_binding_changes'])expect(sqlite.prepare('SELECT count(*) n FROM '+table).get()).toEqual({n:0});
    expect(selections.projectSettings(create('Retry as a new project').id,'browser').enabled).toBe(true);
  });
  it('does not backfill an old project outside the creation transaction',()=>{
    const old=create('Existing');expect(()=>selections.initializeProjectDefault(old.id,'browser')).toThrow('同时保存');
    expect(selections.projectSettings(old.id,'browser')).toMatchObject({enabled:false,revision:0});
  });
});

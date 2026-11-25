import {it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {BrowserProfiles} from '../profiles';
import {BrowserAccess} from '../access';
import {BrowserWorkspace} from '../workspace';
import {BrowserPageRegistry} from '../page-registry';

it('F16 E06 E09 empty project baseline and distinct standalone scope candidate metadata',async()=>{
  const sqlite=new Database(':memory:');
  sqlite.exec("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL); CREATE TABLE synthetic_projects(id TEXT PRIMARY KEY); INSERT INTO synthetic_projects VALUES('real-project')");
  const realProject=(taskId:string)=>taskId === 'project-task' ? 'real-project' : null;
  const pages=new BrowserPageRegistry({userData:process.env.TMPDIR!,helper:{executable:'/not-started',sha256:'0'.repeat(64)}});
  const unscoped=new BrowserWorkspace({sqlite,pages,taskProject:realProject});
  try{
    expect(()=>unscoped.create('standalone-plan-a')).toThrow('项目');
    // A pre-development registry experiment. Scoped runtime keys are distinct from
    // project memberships and are never returned by the existing project business
    // selector. Probe the existing profile/storage/access primitives via that
    // mapping only; a product typed scope contract must replace these string APIs.
    const workspaceScope=new Map([
      ['standalone-plan-a','standalone-only-plan-a'],
      ['standalone-plan-b','standalone-only-plan-b'],
      ['project-task','real-project'],
    ]);
    const scopeFor=(taskId:string)=>workspaceScope.get(taskId)??null;
    const profiles=new BrowserProfiles({sqlite,taskProject:scopeFor});
    const a={taskId:'standalone-plan-a',projectId:scopeFor('standalone-plan-a')!};
    const b={taskId:'standalone-plan-b',projectId:scopeFor('standalone-plan-b')!};
    const project=profiles.ensureProject('real-project');
    const standaloneA=profiles.create(a,'通用独立登录态 A'),standaloneB=profiles.create(b,'通用独立登录态 B');
    expect(standaloneA.owner).toEqual({kind:'task',id:a.taskId});
    expect(standaloneB.owner).toEqual({kind:'task',id:b.taskId});
    expect(standaloneA.partition).not.toBe(standaloneB.partition);
    expect(standaloneA.partition).not.toBe(project.partition);
    const restored=new BrowserProfiles({sqlite,taskProject:scopeFor});
    expect(restored.require(a,standaloneA.id)).toEqual(standaloneA);
    expect(restored.require(b,standaloneB.id)).toEqual(standaloneB);
    expect(()=>restored.require(a,standaloneB.id)).toThrow('无权');
    expect(()=>restored.require(a,project.id)).toThrow('无权');
    expect(realProject(a.taskId)).toBeNull();
    expect(sqlite.prepare('SELECT count(*) AS n FROM synthetic_projects').get()).toEqual({n:1});
    const decisions:unknown[]=[];
    const access=new BrowserAccess({taskProject:scopeFor,audit:event=>decisions.push(event)});
    const signal=new AbortController();
    access.track({runId:'fixture-scheduled-run',...a,signal:signal.signal});
    expect(access.can('fixture-scheduled-run',a.taskId,'read')).toBe(true);
    expect(access.can('fixture-scheduled-run',a.taskId,'write')).toBe(true);
    expect(access.can('fixture-scheduled-run',b.taskId,'read')).toBe(false);
    expect(access.can('fixture-scheduled-run','project-task','read')).toBe(false);
    expect(access.snapshot()).toEqual({requests:[],grants:[]});
    access.dispose();
    console.log(JSON.stringify({case:'E06-E09-standalone-metadata',baselineNullProjectBrowserAvailable:false,
      candidatePartitionsDistinct:true,independentTaskOwnedProfilesRestored:true,projectRows:1,
      registeredProjectBusinessScopeForStandalone:realProject(a.taskId),sameTaskAuthorization:true,unapprovedOtherTaskAuthorization:false,
      layer:'real BrowserProfiles/BrowserAccess metadata plus private separate scope resolver; no browser network/native views or application launch integration'}));
  }finally{await unscoped.dispose();await pages.dispose();sqlite.close();}
});

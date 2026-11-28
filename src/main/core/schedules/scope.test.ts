import {afterEach,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {runBundledMigrations} from '@main/db/migrations';
import {AgentStore} from '../agent/agent-store';
import {taskApplicationScope,standaloneKey,verifyStandaloneScope} from '../agent/task-application-scope';
import {BrowserProfiles,browserProjectProfile} from '../browser/profiles';
const instances:Database.Database[]=[];afterEach(()=>{for(const d of instances.splice(0))d.close();});
it('keeps standalone task profiles independent of project and sibling task identity without adding projects',()=>{
  const db=new Database(':memory:');instances.push(db);runBundledMigrations(db);const store=new AgentStore(db);const make=()=>store.createTask({taskId:randomUUID(),projectId:null,dirId:null,cwd:'/fixture',title:'通用任务',selection:{driverId:'codex-app-server',profileId:'profile',tier:'ask'}});const a=make(),b=make(),sa=taskApplicationScope(db,a)!,sb=taskApplicationScope(db,b)!;
  expect(sa).toBe(standaloneKey(a));expect(sb).not.toBe(sa);expect(verifyStandaloneScope(db,sa,b)).toBeNull();expect(db.prepare('SELECT COUNT(*) n FROM projects').get()).toEqual({n:0});
  const profiles=new BrowserProfiles({sqlite:db,taskProject:taskId=>taskApplicationScope(db,taskId)}),pa=profiles.ensureProject(sa),pb=profiles.ensureProject(sb);
  expect(pa.owner).toEqual({kind:'task',id:a});expect(pb.owner).toEqual({kind:'task',id:b});expect(pa.scope).toBe('isolated');expect(pa.id).toBe(browserProjectProfile(sa));expect(pa.partition).not.toBe(pb.partition);expect(profiles.list({taskId:a,projectId:sa}).map(p=>p.id)).toEqual([pa.id]);expect(()=>profiles.binding(b,sb,pa.id)).toThrow();expect(()=>profiles.deletable({taskId:a,projectId:sa},pa.id)).toThrow();
  const restored=new BrowserProfiles({sqlite:db,taskProject:taskId=>taskApplicationScope(db,taskId)});expect(restored.ensureProject(sa)).toEqual(pa);
});

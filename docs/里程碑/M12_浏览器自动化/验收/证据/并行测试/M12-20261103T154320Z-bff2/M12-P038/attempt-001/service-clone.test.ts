import {afterEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BrowserService,type BrowserScope} from '../service';
import type {BrowserProfileClones} from '../profile-clones';
import {ApplicationError} from '@shared/applications';
import {isApplicationPreflightFailure} from '../../applications/capability-preflight';
vi.mock('electron',()=>({app:{userAgentFallback:'WillYou/0.1 Electron/42 Chrome/148'},session:{},nativeImage:{},shell:{}}));
const fixtures:{service:BrowserService;sqlite:Database.Database;root:string}[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0)){await f.service.dispose();f.sqlite.close();rmSync(f.root,{recursive:true,force:true});}});
function fixture(){
  const sqlite=new Database(':memory:');sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');sqlite.exec(readFileSync('drizzle/0030_browser_operations.sql','utf8'));const root=mkdtempSync(join(tmpdir(),'willyou-clone-service-')),projects=new Map([['T1','P1'],['T2','P1'],['T3','P2']]),service=new BrowserService({sqlite,userData:root,helper:{executable:'/must-not-run',sha256:'0'.repeat(64)},taskProject:id=>projects.get(id)??null});fixtures.push({service,sqlite,root});
  const scope:BrowserScope={taskId:'T1',projectId:'P1',runId:'run1',requestId:'req1',operationId:'operation1',signal:new AbortController().signal,assertActive:()=>{}},source=service.profiles.ensureProject('P1'),clone=vi.spyOn((service as unknown as {clones:BrowserProfileClones}).clones,'clone');
  return{service,scope,source,clone};
}
describe('profile clone command routing (actual service/receipt/ownership; native cloner substituted)',()=>{
  it('returns a new caller-owned profile and records completion without creating or switching a page',async()=>{
    const f=fixture();f.clone.mockImplementation(async(caller,_source,admit,send)=>{admit();send();return f.service.profiles.create(caller,'克隆');});const value=await f.service.execute(f.scope,'tab profile clone',{profile:f.source.id});expect(value).toMatchObject({result:{sourceProfileId:f.source.id,profile:{owner:{kind:'task',id:'T1'}}}});expect(f.service.operations.receipt('run1','req1')).toMatchObject({state:'succeeded',effectState:'completed',summary:{sourceProfileId:f.source.id}});expect(f.service.workspace.list('T1')).toEqual([]);
  });
  it('rejects foreign/ungranted profiles and invalid optional page context before native work',async()=>{
    const f=fixture(),foreign=f.service.profiles.ensureProject('P2'),other=f.service.profiles.create({taskId:'T2',projectId:'P1'},'其他任务');for(const profile of[foreign.id,other.id])await expect(f.service.execute(f.scope,'tab profile clone',{profile})).rejects.toMatchObject({code:'SCOPE_DENIED'});await expect(f.service.execute(f.scope,'tab profile clone',{profile:f.source.id,page:'not-in-task'})).rejects.toMatchObject({code:'BROWSER_TAB_NOT_FOUND'});expect(f.clone).not.toHaveBeenCalled();expect(f.service.operations.receipt('run1','req1')).toEqual({state:'not-found'});
  });
  it('distinguishes pre-dispatch preparation failure from an ambiguous started clone and never retries it',async()=>{
    const f=fixture();f.clone.mockRejectedValueOnce(new ApplicationError('BROWSER_UNAVAILABLE','journal cannot be prepared'));const before=await f.service.execute(f.scope,'tab profile clone',{profile:f.source.id}).catch(e=>e);expect(isApplicationPreflightFailure(before,'operation1')).toBe(true);expect(f.service.operations.receipt('run1','req1')).toMatchObject({state:'failed',effectState:'not-started'});
    f.clone.mockImplementationOnce(async(_caller,_source,_admit,send)=>{send();throw new ApplicationError('BROWSER_UNAVAILABLE','native acknowledgement unknown');});const after=await f.service.execute({...f.scope,requestId:'req2',operationId:'operation2'},'tab profile clone',{profile:f.source.id}).catch(e=>e);expect(isApplicationPreflightFailure(after,'operation2')).toBe(false);expect(f.service.operations.receipt('run1','req2')).toMatchObject({state:'unknown',effectState:'unknown'});expect(f.clone).toHaveBeenCalledTimes(2);
  });
});

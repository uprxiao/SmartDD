import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {BrowserService,type BrowserScope} from '../service';
import {ApplicationError} from '@shared/applications';
import {isApplicationPreflightFailure} from '../../applications/capability-preflight';

// Only the unavailable native app surface is substituted. These checks use the
// actual service admission, operation store, workspace boundary and deadlines.
vi.mock('electron',()=>({app:{userAgentFallback:'WillYou/0.1 Electron/42 Chrome/148'},session:{},nativeImage:{},shell:{}}));
describe('browser command budgets and honest dispatch receipts (software)',()=>{
  const fixtures:{service:BrowserService;sqlite:Database.Database}[]=[];
  beforeEach(()=>vi.useFakeTimers());
  afterEach(async()=>{for(const f of fixtures.splice(0)){await f.service.dispose();f.sqlite.close();}vi.useRealTimers();vi.restoreAllMocks();});
  function fixture(){
    const sqlite=new Database(':memory:');sqlite.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');sqlite.exec(readFileSync('drizzle/0030_browser_operations.sql','utf8'));
    const service=new BrowserService({sqlite,userData:'/private/tmp/m12-budget-no-native-output',helper:{executable:'/must-not-run',sha256:'0'.repeat(64)},taskProject:()=> 'p1'}),controller=new AbortController();
    const scope:BrowserScope={projectId:'p1',taskId:'t1',runId:'run1',requestId:'request1',operationId:'operation1',signal:controller.signal,assertActive:()=>{}};
    fixtures.push({service,sqlite});return{service,sqlite,scope,controller};
  }
  it('times out restoration before dispatch without starting or changing any previous request receipt',async()=>{
    const f=fixture();f.service.operations.begin('run1','request1','different-task',null,'identity set');const before=f.service.operations.receipt('run1','request1');
    vi.spyOn(f.service.workspace,'target').mockImplementation(()=>new Promise(()=>{}));
    const result=f.service.execute(f.scope,'goto',{url:'https://fixture.example'}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(89999);expect(f.service.operations.receipt('run1','request1')).toEqual(before);await vi.advanceTimersByTimeAsync(1);
    const error:unknown=await result;expect(error).toMatchObject({code:'BROWSER_TIMEOUT'});expect(isApplicationPreflightFailure(error,f.scope.operationId)).toBe(true);expect(f.service.operations.receipt('run1','request1')).toEqual(before);
  });
  it('keeps a dispatched native creation unknown when native completion never arrives',async()=>{
    const f=fixture(),create=vi.spyOn(f.service.pages,'create').mockImplementation(()=>new Promise(()=>{}));
    const result=f.service.execute(f.scope,'tab create',{}).catch(error=>error);await vi.advanceTimersByTimeAsync(90000);
    const error:unknown=await result;expect(error).toMatchObject({code:'BROWSER_TIMEOUT'});expect(isApplicationPreflightFailure(error,f.scope.operationId)).toBe(false);expect(create).toHaveBeenCalledOnce();
    expect(f.service.operations.receipt('run1','request1')).toMatchObject({state:'unknown',effectState:'unknown',errorCode:'BROWSER_TIMEOUT'});
  });
  it('uses wait timeout plus transport allowance for reads and preserves caller cancellation',async()=>{
    const f=fixture();vi.spyOn(f.service.workspace,'target').mockImplementation(()=>new Promise(()=>{}));
    let settled=false;const result=f.service.execute(f.scope,'wait',{timeout:20}).catch(error=>{settled=true;return error;});await vi.advanceTimersByTimeAsync(5019);expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(1);
    const error:unknown=await result;expect(error).toMatchObject({code:'BROWSER_TIMEOUT'});expect(isApplicationPreflightFailure(error,f.scope.operationId)).toBe(false);expect(f.service.operations.receipt('run1','request1')).toEqual({state:'not-found'});
    const cancelled=f.service.execute({...f.scope,requestId:'request2',operationId:'operation2'},'goto',{url:'https://fixture.example'}).catch(error=>error);f.controller.abort(new ApplicationError('CANCELED','caller cancelled'));const cancellation:unknown=await cancelled;
    expect(cancellation).toMatchObject({code:'CANCELED'});expect(isApplicationPreflightFailure(cancellation,'operation2')).toBe(true);
  });
  it('rejects a conflicting request without overwriting its original receipt',async()=>{
    const f=fixture();f.service.operations.begin('run1','request1','different-task',null,'identity set');f.service.operations.update('run1','request1','succeeded','completed',{summary:{original:true}});const before=f.service.operations.receipt('run1','request1');
    await expect(f.service.execute(f.scope,'identity set',{mode:'native'})).rejects.toMatchObject({code:'REQUEST_CONFLICT'});expect(f.service.operations.receipt('run1','request1')).toEqual(before);
  });
});

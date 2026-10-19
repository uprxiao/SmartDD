// @vitest-environment jsdom
import{act,cleanup,renderHook}from'@testing-library/react';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import type{FileRoot}from'@shared/files';
import{useGitStatus}from'./git-metadata';
const api=vi.hoisted(()=>({gitStatus:vi.fn(),cancelGit:vi.fn(async()=>undefined)}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
const root={lease:'11111111-1111-4111-8111-111111111111',generation:1}as FileRoot;
const ready={state:'ready',repository:{id:'own',head:'a'.repeat(40),webBase:null,prefix:''},entries:[],truncated:false,attributesAvailable:true};
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();api.gitStatus.mockResolvedValue(ready);});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('S03 actual metadata hook capability and unavailable states (unit transport)',()=>{
 it.each([null,undefined])('does not query or spin without an authorized root: %s',async value=>{const f=renderHook(()=>useGitStatus(value,0));await act(()=>vi.advanceTimersByTimeAsync(500));expect(api.gitStatus).not.toHaveBeenCalled();expect(f.result.current).toMatchObject({data:null,error:'',loading:false});});
 it('queries the exact authorized root, exposes ready and cancels on unmount',async()=>{const f=renderHook(()=>useGitStatus(root,0));expect(f.result.current.loading).toBe(true);await act(()=>vi.advanceTimersByTimeAsync(151));expect(api.gitStatus).toHaveBeenCalledWith({id:expect.any(String),root:{lease:root.lease,generation:1}});expect(f.result.current).toMatchObject({data:ready,error:'',loading:false});const id=api.gitStatus.mock.calls[0][0].id;f.unmount();expect(api.cancelGit).toHaveBeenCalledWith(id);});
 it('preserves the real unavailable reason and ends loading',async()=>{const data={state:'unavailable',reason:'当前目录不在 Git 工作树中'};api.gitStatus.mockResolvedValueOnce(data);const f=renderHook(()=>useGitStatus(root,0));await act(()=>vi.advanceTimersByTimeAsync(151));expect(f.result.current).toMatchObject({data,error:'',loading:false});});
 it('reports denied capability, ends loading and retries only on explicit refresh',async()=>{api.gitStatus.mockRejectedValueOnce(Error('UNTRUSTED: Repository marker is not trusted'));const f=renderHook(()=>useGitStatus(root,0));await act(()=>vi.advanceTimersByTimeAsync(151));expect(f.result.current).toMatchObject({data:null,error:'UNTRUSTED: Repository marker is not trusted',loading:false});await act(()=>vi.advanceTimersByTimeAsync(1000));expect(api.gitStatus).toHaveBeenCalledTimes(1);act(()=>f.result.current.refresh());await act(()=>vi.advanceTimersByTimeAsync(151));expect(f.result.current.data).toEqual(ready);});
 it('removes a lost root immediately and discards its pending success',async()=>{let release!:(v:typeof ready)=>void;api.gitStatus.mockReturnValueOnce(new Promise(r=>{release=r;}));const f=renderHook(({value}:{value:FileRoot|null})=>useGitStatus(value,0),{initialProps:{value:root as FileRoot|null}});await act(()=>vi.advanceTimersByTimeAsync(151));const id=api.gitStatus.mock.calls[0][0].id;f.rerender({value:null});expect(f.result.current).toMatchObject({data:null,error:'',loading:false});expect(api.cancelGit).toHaveBeenCalledWith(id);await act(async()=>{release(ready);await Promise.resolve();});expect(f.result.current.data).toBeNull();expect(api.gitStatus).toHaveBeenCalledTimes(1);});
});

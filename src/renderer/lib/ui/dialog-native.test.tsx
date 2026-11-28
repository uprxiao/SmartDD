// @vitest-environment jsdom
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Dialog,DialogContent,DialogTitle} from './dialog';

const f=vi.hoisted(()=>({root:vi.fn(),browser:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{nativeSurface:{overlay:f.root},browser:{overlay:f.browser}}}));
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('electronAPI',{invoke:vi.fn()});f.root.mockResolvedValue(undefined);f.browser.mockResolvedValue('data:image/jpeg;base64,fixture');});
afterEach(async()=>{cleanup();await act(async()=>{});vi.unstubAllGlobals();});
function Modal({name='永久删除任务'}:{name?:string}){return <Dialog open><DialogContent><DialogTitle>{name}</DialogTitle><button>确认</button></DialogContent></Dialog>}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {resolve,promise};}

it('does not expose the common modal until the native front slot has actually been parked',async()=>{
 const gate=deferred();f.root.mockImplementationOnce(()=>gate.promise);
 const view=render(<><div className="bw-workspace" data-browser-task="t1" data-browser-page="p1"/><Modal/></>);
 await waitFor(()=>expect(f.root).toHaveBeenCalledWith(expect.objectContaining({owner:expect.any(String),open:true})));
 expect(screen.queryByRole('dialog')).toBeNull();
 const owner=f.root.mock.calls[0][0].owner;
 await act(async()=>gate.resolve());await screen.findByRole('dialog',{name:'永久删除任务'});
 expect(f.browser).toHaveBeenCalledWith({taskId:'t1',tabId:'p1',owner,instance:owner,open:true});
 view.unmount();await waitFor(()=>expect(f.root).toHaveBeenCalledWith({owner,open:false}));
 expect(f.browser).toHaveBeenCalledWith({taskId:'t1',tabId:'p1',owner,instance:owner,open:false});
});
it('an old closing acquisition cannot release a newer or nested modal owner',async()=>{
 const a=deferred();f.root.mockImplementationOnce(()=>a.promise);
 const first=render(<Modal name="first"/>);await waitFor(()=>expect(f.root).toHaveBeenCalledTimes(1));const oldOwner=f.root.mock.calls[0][0].owner;
 first.unmount();const second=render(<Modal name="second"/>);await screen.findByRole('dialog',{name:'second'});const current=f.root.mock.calls.find(([v])=>v.open&&v.owner!==oldOwner)![0].owner;
 await act(async()=>a.resolve());await waitFor(()=>expect(f.root).toHaveBeenCalledWith({owner:oldOwner,open:false}));
 expect(f.root).not.toHaveBeenCalledWith({owner:current,open:false});expect(screen.getByRole('dialog',{name:'second'})).toBeTruthy();
 second.unmount();await waitFor(()=>expect(f.root).toHaveBeenCalledWith({owner:current,open:false}));
});
it('holds no native lease for a closed root and releases only after the actual portal closes',async()=>{
 const root=(open:boolean)=><Dialog open={open}><DialogContent><DialogTitle>普通确认</DialogTitle><button>确认</button></DialogContent></Dialog>;
 const view=render(root(false));expect(f.root).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
 view.rerender(root(true));await screen.findByRole('dialog',{name:'普通确认'});const owner=f.root.mock.calls[0][0].owner;
 view.rerender(root(false));await waitFor(()=>expect(f.root).toHaveBeenCalledWith({owner,open:false}));expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not wait on a failed browser capture, and does not expose the destructive button on a failed native gate',async()=>{
 f.browser.mockRejectedValueOnce(Error('capture failed'));const view=render(<><div className="bw-workspace" data-browser-task="t1" data-browser-page="p1"/><Modal/></>);await screen.findByRole('dialog',{name:'永久删除任务'});view.unmount();await act(async()=>{});
 f.root.mockRejectedValueOnce(Error('native layer failed'));render(<Modal/>);await screen.findByText('无法打开对话框');expect(screen.queryByRole('button',{name:'确认'})).toBeNull();
});

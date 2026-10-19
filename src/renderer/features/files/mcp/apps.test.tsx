// @vitest-environment jsdom
import {render,screen,waitFor,cleanup,act,fireEvent} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ViewerSession} from '@shared/file-viewer';
const api=vi.hoisted(()=>({open:vi.fn(),close:vi.fn(),bounds:vi.fn(),send:vi.fn(),listeners:new Set<(e:unknown)=>void>()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{viewerUiOpen:api.open,viewerUiClose:api.close,viewerUiBounds:api.bounds,viewerUiSend:api.send,viewerTool:vi.fn(),readViewer:vi.fn()}},events:{on:(_type:unknown,listener:(e:unknown)=>void)=>{api.listeners.add(listener);return()=>api.listeners.delete(listener)}}}));
vi.mock('@renderer/lib/theme',()=>({useTheme:()=>({effectiveTheme:'ydark'})}));
vi.mock('../html/preview',()=>({htmlViewOccluded:()=>false}));
import {McpAppFrame} from './apps';
const session:ViewerSession={id:'b7c94e9a-a5b9-40d1-8049-2696d982738c',adapterId:'fixture',generation:1,uri:'fixture://exact',writable:false,presentation:'mcp-app',resource:{uri:'fixture://exact',mimeType:'text/plain',base64:'eA==',bytes:1,etag:'a'.repeat(64)},subscribed:false};
beforeEach(()=>{vi.clearAllMocks();api.open.mockResolvedValue(undefined);api.close.mockResolvedValue(undefined);api.bounds.mockResolvedValue(undefined);api.send.mockResolvedValue(undefined);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>setTimeout(()=>f(0),1));vi.stubGlobal('cancelAnimationFrame',(id:number)=>clearTimeout(id));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();api.listeners.clear()});
describe('MCP native view React lifecycle (RPC seam unit)',()=>{
 it('opens with exact session, ignores unrelated events, reports current failure and closes/unsubscribes on unmount',async()=>{
  const retry=vi.fn(),view=render(<McpAppFrame session={session} onRetry={retry}/>);await waitFor(()=>expect(api.open).toHaveBeenCalledWith({id:session.id,uri:session.uri,generation:1}));
  act(()=>api.listeners.forEach(f=>f({id:'other',error:'wrong'})));expect(screen.queryByRole('alert')).toBeNull();
  act(()=>api.listeners.forEach(f=>f({id:session.id,error:'fixture disconnected'})));expect(screen.getByRole('alert').textContent).toContain('fixture disconnected');expect(api.close).toHaveBeenCalledWith(session.id);
  fireEvent.click(screen.getByText('重试扩展'));expect(retry).toHaveBeenCalledTimes(1);view.unmount();expect(api.listeners.size).toBe(0);
 });
 it('late native open resolution after unmount cannot schedule bounds or attach a new listener',async()=>{
  let release!:()=>void;api.open.mockImplementation(()=>new Promise<void>(r=>release=r));const view=render(<McpAppFrame session={session}/>);await waitFor(()=>expect(api.open).toHaveBeenCalledTimes(1));view.unmount();const before=api.bounds.mock.calls.length;
  await act(async()=>{release();await Promise.resolve()});await new Promise(r=>setTimeout(r,5));expect(api.close).toHaveBeenCalledWith(session.id);expect(api.bounds).toHaveBeenCalledTimes(before);expect(api.listeners.size).toBe(0);
 });
 it('native initialization rejection is visible and closes the pending view',async()=>{api.open.mockRejectedValue(new Error('fixture init failed'));render(<McpAppFrame session={session}/>);expect((await screen.findByRole('alert')).textContent).toContain('fixture init failed');expect(api.close).toHaveBeenCalledWith(session.id)});
});

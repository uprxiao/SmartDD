// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserSettingsDialog,type BrowserPreferences} from './settings-dialog';
const api=vi.hoisted(()=>({settings:vi.fn(),clearArtifacts:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{browser:api}}));
const initial:BrowserPreferences={searchEngine:'bing',identity:'clean',pendingIdentity:null,downloadDirectory:'/private/synthetic/Downloads',artifactBytes:1048576};
beforeEach(()=>{vi.resetAllMocks();});afterEach(cleanup);
it('keeps the current selection after a failed save and shows identity restart status only after host acknowledgement',async()=>{
  const close=vi.fn();render(<BrowserSettingsDialog taskId="task" initial={initial} onClose={close}/>);api.settings.mockRejectedValueOnce(new Error('save refused'));
  fireEvent.click(screen.getByRole('radio',{name:'Kagi'}));await screen.findByRole('alert');expect((screen.getByRole('radio',{name:'Bing'}) as HTMLInputElement).checked).toBe(true);expect(screen.queryByRole('status')).toBeNull();
  let release!:(value:BrowserPreferences)=>void;api.settings.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));fireEvent.click(screen.getByRole('radio',{name:/Electron 原生身份/}));fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(close).not.toHaveBeenCalled();expect(screen.queryByRole('status')).toBeNull();release({...initial,pendingIdentity:'native'});await screen.findByRole('status');expect((screen.getByRole('radio',{name:/Electron 原生身份/}) as HTMLInputElement).checked).toBe(true);expect(api.settings).toHaveBeenLastCalledWith({taskId:'task',identity:'native'});
});
it('requires cleanup confirmation and does not report zero bytes when the host rejects deletion',async()=>{
  render(<BrowserSettingsDialog taskId="task" initial={initial} onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'清理全部浏览器文件'}));expect(api.clearArtifacts).not.toHaveBeenCalled();api.clearArtifacts.mockRejectedValueOnce(new Error('file busy'));fireEvent.click(screen.getByRole('button',{name:'确认清理'}));await screen.findByRole('alert');expect(screen.getByLabelText('浏览器文件占用').textContent).toContain('1.0 MB');
  api.clearArtifacts.mockResolvedValueOnce({...initial,artifactBytes:0});fireEvent.click(screen.getByRole('button',{name:'确认清理'}));await waitFor(()=>expect(screen.getByLabelText('浏览器文件占用').textContent).toBe('0 MB'));expect(api.clearArtifacts).toHaveBeenLastCalledWith({taskId:'task',confirmed:true});expect(screen.getByText(/系统下载目录/).textContent).toContain(initial.downloadDirectory);
});

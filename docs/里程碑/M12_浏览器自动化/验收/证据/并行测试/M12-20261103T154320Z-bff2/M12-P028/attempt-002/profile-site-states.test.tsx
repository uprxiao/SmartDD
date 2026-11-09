// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserProfileSiteStates,type ProfileSiteStates} from './profile-site-states';
const api=vi.hoisted(()=>({revokeCertificate:vi.fn(),recoverCookies:vi.fn(),clearCookies:vi.fn()}));vi.mock('@renderer/lib/ipc',()=>({rpc:{browser:api}}));
const initial:ProfileSiteStates=[{importState:'ready',profile:{id:'project-p1',label:'项目登录态',scope:'project',owner:{kind:'project',id:'p1'},partition:'persist:wy-browser-project-p1',source:null},state:{schemaVersion:1,certificates:[{host:'outside.example.test',createdAt:1}],permissions:[]}}];
beforeEach(()=>vi.resetAllMocks());afterEach(cleanup);
it('retains a certificate record on host failure and removes it only after a successful scoped revocation',async()=>{
  render(<BrowserProfileSiteStates taskId="t1" currentProfile="project-p1" initial={initial} onClose={()=>{}}/>);api.revokeCertificate.mockRejectedValueOnce(new Error('database busy'));fireEvent.click(screen.getByRole('button',{name:'撤销'}));await screen.findByRole('alert');expect(screen.getByText('outside.example.test')).toBeTruthy();
  api.revokeCertificate.mockResolvedValueOnce([{...initial[0],state:{schemaVersion:1,certificates:[],permissions:[]}}]);fireEvent.click(screen.getByRole('button',{name:'撤销'}));await waitFor(()=>expect(screen.queryByText('outside.example.test')).toBeNull());expect(api.revokeCertificate).toHaveBeenLastCalledWith({taskId:'t1',profileId:'project-p1',host:'outside.example.test'});
});
it('keeps import disabled while attention is outstanding, and enables it only after host-confirmed recovery',async()=>{
  api.recoverCookies.mockResolvedValueOnce(initial);render(<BrowserProfileSiteStates taskId="t1" currentProfile="project-p1" initial={[{...initial[0],importState:'needs-attention'}]} onClose={()=>{}}/>);expect((screen.getByRole('button',{name:'导入 Chrome／Edge 登录态'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'重试恢复'}));await waitFor(()=>expect((screen.getByRole('button',{name:'导入 Chrome／Edge 登录态'}) as HTMLButtonElement).disabled).toBe(false));expect(api.recoverCookies).toHaveBeenCalledExactlyOnceWith({taskId:'t1',profileId:'project-p1'});
});
it('requires a separate clear confirmation and keeps attention on host failure without automatic retry',async()=>{
  api.clearCookies.mockRejectedValueOnce(Error('clear interrupted'));render(<BrowserProfileSiteStates taskId="t1" currentProfile="project-p1" initial={[{...initial[0],importState:'needs-attention'}]} onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'清空登录态'}));expect(api.clearCookies).not.toHaveBeenCalled();expect(screen.getByText(/将清空此登录态的全部/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'确认清空'}));await screen.findByText('clear interrupted');expect(api.clearCookies).toHaveBeenCalledExactlyOnceWith({taskId:'t1',profileId:'project-p1',confirmed:true});expect((screen.getByRole('button',{name:'导入 Chrome／Edge 登录态'}) as HTMLButtonElement).disabled).toBe(true);
});

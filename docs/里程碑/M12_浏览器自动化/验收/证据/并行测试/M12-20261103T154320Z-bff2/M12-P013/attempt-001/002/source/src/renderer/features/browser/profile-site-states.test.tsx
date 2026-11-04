// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BrowserProfileSiteStates,type ProfileSiteStates} from './profile-site-states';
const api=vi.hoisted(()=>({revokeCertificate:vi.fn()}));vi.mock('@renderer/lib/ipc',()=>({rpc:{browser:api}}));
const initial:ProfileSiteStates=[{profile:{id:'project-p1',label:'项目登录态',scope:'project',owner:{kind:'project',id:'p1'},partition:'persist:wy-browser-project-p1',source:null},state:{schemaVersion:1,certificates:[{host:'outside.example.test',createdAt:1}],permissions:[]}}];
beforeEach(()=>vi.resetAllMocks());afterEach(cleanup);
it('retains a certificate record on host failure and removes it only after a successful scoped revocation',async()=>{
  render(<BrowserProfileSiteStates taskId="t1" currentProfile="project-p1" initial={initial} onClose={()=>{}}/>);api.revokeCertificate.mockRejectedValueOnce(new Error('database busy'));fireEvent.click(screen.getByRole('button',{name:'撤销'}));await screen.findByRole('alert');expect(screen.getByText('outside.example.test')).toBeTruthy();
  api.revokeCertificate.mockResolvedValueOnce([{...initial[0],state:{schemaVersion:1,certificates:[],permissions:[]}}]);fireEvent.click(screen.getByRole('button',{name:'撤销'}));await waitFor(()=>expect(screen.queryByText('outside.example.test')).toBeNull());expect(api.revokeCertificate).toHaveBeenLastCalledWith({taskId:'t1',profileId:'project-p1',host:'outside.example.test'});
});

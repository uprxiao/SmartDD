// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {TaskView} from '@shared/tasks';
import {ResumeAdviceNotice} from './resume-advice';
const api=vi.hoisted(()=>({tasks:{resumeAdvice:vi.fn(),kill:vi.fn()}}));
const store=vi.hoisted(()=>({byId:new Map<string,{ptyId:string|null}>(),resume:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:api,events:{on:()=>()=>undefined}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:store}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,value?:{apps:string})=>key==='task.resumeAdvice'?`updated ${value!.apps}`:key})}));
const task=(extra:Partial<TaskView>={}):TaskView=>({id:'t1',projectId:'p1',projectName:'P',dirId:null,cwd:'/w',aiProfileId:null,aiProfileName:null,aiProfileColor:null,runner:'claude',nativeSessionId:'n1',title:'T',firstMessage:'',injectedEnvNames:[],configVersion:1,projectConfigVersion:1,archivedAt:null,createdAt:1,updatedAt:1,lastLaunchedAt:1,ptyId:'pty-1',recovery:'resumable',recoveryReason:'',...extra});
const mount=(value:TaskView)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ResumeAdviceNotice task={value}/></QueryClientProvider>);
beforeEach(()=>{vi.clearAllMocks();store.byId.set('t1',{ptyId:'pty-1'});});
afterEach(()=>cleanup());

describe('M11 R1.0 resume-after-update notice',()=>{
 it('shows nothing when no application change needs a resume, or the task is not running',async()=>{
  api.tasks.resumeAdvice.mockResolvedValue(null);mount(task());await waitFor(()=>expect(api.tasks.resumeAdvice).toHaveBeenCalledWith('t1'));expect(screen.queryByTestId('resume-advice')).toBeNull();
  cleanup();vi.clearAllMocks();mount(task({ptyId:null}));expect(api.tasks.resumeAdvice).not.toHaveBeenCalled();expect(screen.queryByTestId('resume-advice')).toBeNull();
 });
 it('names the applications and resumes the same session only after the user confirms the interruption',async()=>{
  api.tasks.resumeAdvice.mockResolvedValue({applications:['禅道','邮件']});
  api.tasks.kill.mockImplementation(async()=>{store.byId.set('t1',{ptyId:null});});store.resume.mockResolvedValue(undefined);
  mount(task());expect((await screen.findByTestId('resume-advice')).textContent).toContain('updated 禅道、邮件');
  fireEvent.click(screen.getByTestId('resume-advice-resume'));expect(await screen.findByTestId('resume-advice-confirm')).toBeDefined();expect(api.tasks.kill).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('resume-advice-confirm-resume'));
  await waitFor(()=>expect(store.resume).toHaveBeenCalledWith({taskId:'t1'}));expect(api.tasks.kill).toHaveBeenCalledWith('t1');expect(api.tasks.kill.mock.invocationCallOrder[0]).toBeLessThan(store.resume.mock.invocationCallOrder[0]);
 });
 it('keeps the dialog open with the error when the resume fails',async()=>{
  api.tasks.resumeAdvice.mockResolvedValue({applications:['邮件']});api.tasks.kill.mockImplementation(async()=>{store.byId.set('t1',{ptyId:null});});store.resume.mockRejectedValue(new Error('resume failed'));
  mount(task());fireEvent.click(await screen.findByTestId('resume-advice-resume'));fireEvent.click(await screen.findByTestId('resume-advice-confirm-resume'));
  expect((await screen.findByRole('alert')).textContent).toContain('resume failed');expect(screen.getByTestId('resume-advice-confirm')).toBeDefined();
 });
});

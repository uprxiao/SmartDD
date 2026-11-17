// @vitest-environment jsdom
import{it,expect,vi,afterEach}from'vitest';import{render,screen,fireEvent,waitFor,cleanup}from'@testing-library/react';
const m=vi.hoisted(()=>({reference:vi.fn(),insert:vi.fn(),opened:vi.fn(),nav:{currentViewId:'apps',currentAgentTaskId:'agent',applicationAgentTaskId:'agent'} as any}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{agentTasks:{applicationReference:m.reference},applications:{}},events:{on:()=>()=>{}}}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{current:null}}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:{enabled:true,tasks:[{taskId:'agent',projectId:'p',title:'Chosen task'}]}}));
vi.mock('@renderer/core/navigation',()=>({navigation:{get currentViewId(){return m.nav.currentViewId;},get currentAgentTaskId(){return m.nav.currentAgentTaskId;},get applicationAgentTaskId(){return m.nav.applicationAgentTaskId;},openAgentTask:(id:string)=>m.opened(id)}}));
import {ApplicationTerminalButton}from'./terminal-insertion';import{agentComposerTargets}from'../agent-tasks/composer-target';
afterEach(()=>{cleanup();m.insert.mockClear();m.opened.mockClear();m.nav.currentAgentTaskId='agent';});
it('A38: a host-derived reference targets the explicitly captured task draft, with no synthetic PTY or automatic submit',async()=>{
 const off=agentComposerTargets.register({taskId:'agent',projectId:'p',insert:m.insert,focus:()=>{}});m.reference.mockResolvedValue({taskId:'agent',projectId:'p',text:'HOST_ORIGINAL_REFERENCE'});try{render(<ApplicationTerminalButton projectId='p' source={{kind:'draft',draftId:'00000000-0000-4000-8000-000000000001',revision:2,contentHash:'a'.repeat(64)}}/>);fireEvent.click(screen.getByRole('button',{name:'插入任务引用'}));await waitFor(()=>expect(m.insert).toHaveBeenCalledWith('HOST_ORIGINAL_REFERENCE'));expect(m.reference.mock.calls.at(-1)?.slice(0,1)).toEqual(['agent']);expect(m.opened).toHaveBeenCalledWith('agent');}finally{off();}
});
it('A38: changing tasks while the host checks a reference rejects its late result instead of overwriting either draft',async()=>{
 let finish!:(v:unknown)=>void;m.reference.mockImplementation(()=>new Promise(r=>finish=r));const off=agentComposerTargets.register({taskId:'other',projectId:'p',insert:m.insert,focus:()=>{}});try{render(<ApplicationTerminalButton projectId='p' source={{kind:'skill',appId:'mail',skillId:'work-assistant'}}/>);fireEvent.click(screen.getByRole('button',{name:'插入任务引用'}));m.nav.currentAgentTaskId='other';finish({taskId:'agent',projectId:'p',text:'OLD_REFERENCE'});await screen.findByText('目标已变化，引用未插入');expect(m.insert).not.toHaveBeenCalled();expect(m.opened).not.toHaveBeenCalled();}finally{off();}
});

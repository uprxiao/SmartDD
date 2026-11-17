// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';import{render,fireEvent,screen,cleanup}from'@testing-library/react';
vi.mock('@renderer/lib/ipc',()=>({events:{on:()=>()=>{}},rpc:{agentTasks:{changes:async()=>[]}}}));
vi.mock('@renderer/features/files/workspace-panel',()=>({FileWorkspacePanel:()=> <div>FILE_SURFACE</div>}));
vi.mock('@renderer/features/browser/workspace',()=>({AgentBrowserSurface:()=> <div>BROWSER_SURFACE</div>}));
vi.mock('./agent-terminal',()=>({AgentTerminalDrawer:()=> <div>MANUAL_SHELL</div>}));
vi.mock('@renderer/core/navigation',()=>({navigation:{filePanelOpen:true,toggleFilePanel:vi.fn()}}));
import{AgentWorkspacePanels}from'./workspace-panels';import{panelsFor,homeWorkspace}from'./workspace-panels-store';
afterEach(cleanup);
it('A73: home exposes files/manual terminal only, menu keyboard actions cannot start a browser or a task',()=>{
 const scope={kind:'project' as const,projectId:'home-panel-test'};homeWorkspace.set(scope.projectId,'dir','/fixture');render(<AgentWorkspacePanels scope={scope} projectId={scope.projectId} onClose={()=>{}}/>);fireEvent.click(screen.getByTitle('打开面板'));expect(screen.getByRole('button',{name:/浏览器.*创建任务后可用/})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:/差异.*创建任务后可用/})).toHaveProperty('disabled',true);fireEvent.keyDown(document.body,{key:'b'});expect(panelsFor(scope).active).toBe('files');fireEvent.keyDown(document.body,{key:'t'});expect(screen.getByText('MANUAL_SHELL')).toBeTruthy();expect(panelsFor(scope).active).toBe('terminal');
});
it('A73: panel tabs can close to zero and reopen by their displayed key without losing another task selection',()=>{
 const a={kind:'task' as const,taskId:'panel-task-a'},b={kind:'task' as const,taskId:'panel-task-b'};panelsFor(b).open('browser');render(<AgentWorkspacePanels scope={a} projectId='p' onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'关闭文件面板'}));expect(screen.getByText('打开面板')).toBeTruthy();fireEvent.keyDown(document.body,{key:'f',isComposing:true});expect(panelsFor(a).tabs).toHaveLength(0);fireEvent.keyDown(document.body,{key:'f'});expect(screen.getByText('FILE_SURFACE')).toBeTruthy();expect(panelsFor(b).active).toBe('browser');
});

it('A65/A73: a task without a project can open its own diff; switching the sole terminal tab into a drawer leaves a valid active surface',()=>{
 const scope={kind:'task' as const,taskId:'unscoped-panel-test'};render(<AgentWorkspacePanels scope={scope} projectId={null} onClose={()=>{}}/>);fireEvent.click(screen.getByTitle('打开面板'));expect(screen.getByRole('button',{name:/^差异/})).toHaveProperty('disabled',false);expect(screen.getByRole('button',{name:/^浏览器/})).toHaveProperty('disabled',true);const panels=panelsFor(scope);panels.close('files');panels.open('terminal');panels.terminalDrawer();expect(panels.drawer).toBe(true);expect(panels.tabs).toContain(panels.active);expect(panels.active).not.toBe('terminal');
});

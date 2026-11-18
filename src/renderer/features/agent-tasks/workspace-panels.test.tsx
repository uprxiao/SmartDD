// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';import{render,fireEvent,screen,cleanup,waitFor}from'@testing-library/react';
const mock = vi.hoisted(()=>({page:vi.fn(async()=>({items:[],next:null})),turn:vi.fn(),hold:vi.fn(),release:vi.fn(),files:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({events:{on:()=>()=>{}},rpc:{agentTasks:{changePage:mock.page,changeTurn:mock.turn,holdDiff:mock.hold,releaseDiff:mock.release,changeFiles:mock.files}}}));
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

it('G2 opens an exact old turn instead of falling back and can load earlier options',async()=>{
 const scope={kind:'task' as const,taskId:'panel-history-old'};
 const panels=panelsFor(scope);
 const latest={turnId:'latest',recordNumber:2,status:'none',reason:'Recent status',files:[],filesTotal:0};
 const old={turnId:'old',recordNumber:1,status:'none',reason:'快照已清理（空间回收）',files:[],filesTotal:0};
 mock.page.mockResolvedValueOnce({items:[latest],next:12} as never).mockResolvedValueOnce({items:[old],next:null} as never);
 mock.turn.mockResolvedValue(old);
 panels.diffTurn='old';
 panels.open('diff');
 render(<AgentWorkspacePanels scope={scope} projectId="p" onClose={()=>{}} readOnly/>);
 const select=await screen.findByRole('combobox',{name:'差异回合'});
 expect(select).toHaveProperty('value','old');
 expect(screen.getByRole('status').textContent).toContain('快照已清理（空间回收）');
 expect(screen.queryByTitle('打开面板')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'加载更早轮次'}));
 await waitFor(()=>expect(mock.page).toHaveBeenCalledWith(scope.taskId,12));
 expect(select).toHaveProperty('value','old');
});

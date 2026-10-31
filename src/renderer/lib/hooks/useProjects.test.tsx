// @vitest-environment jsdom
import{act,cleanup,fireEvent,render,screen,waitFor}from'@testing-library/react';
import{QueryClientProvider,onlineManager,type QueryClient}from'@tanstack/react-query';
import{afterEach,beforeEach,expect,it,vi}from'vitest';
import{createRendererQueryClient}from'../query-client';
import{useProject,useProjectList,useRefreshProjects}from'./useProjects';
const m=vi.hoisted(()=>({list:vi.fn(),get:vi.fn()}));vi.mock('@renderer/lib/ipc',()=>({rpc:{projects:m}}));
let client:QueryClient;
const row=(name='SO original')=>({id:'own-project',name});
function Read({archived=false,id='own-project'}:{archived?:boolean;id?:string|null}){const list=useProjectList(archived),detail=useProject(id),refresh=useRefreshProjects();return <><p>{list.data?.[0]?.name??'list pending'}</p><p>{detail.data?.name??'detail pending'}</p>{list.error&&<p role="alert">{list.error.message}</p>}<button onClick={()=>void refresh()}>Refresh original project reads</button></>;}
function mount(archived=false,id:string|null='own-project'){return render(<QueryClientProvider client={client}><Read archived={archived} id={id}/></QueryClientProvider>);}
beforeEach(()=>{vi.resetAllMocks();onlineManager.setOnline(true);client=createRendererQueryClient();m.list.mockResolvedValue([row()]);m.get.mockResolvedValue(row());});afterEach(()=>{cleanup();client.clear();onlineManager.setOnline(true);});
it.each([false,true])('SO offline local project list(includeArchived=%s) executes original IPC',async archived=>{onlineManager.setOnline(false);mount(archived,null);await waitFor(()=>expect(m.list).toHaveBeenCalledExactlyOnceWith({includeArchived:archived}),{timeout:350});await screen.findByText('SO original');expect(m.get).not.toHaveBeenCalled();});
it('SO offline selected project detail executes original IPC',async()=>{onlineManager.setOnline(false);mount();await waitFor(()=>expect(m.get).toHaveBeenCalledExactlyOnceWith('own-project'),{timeout:350});expect(await screen.findAllByText('SO original')).toHaveLength(2);});
it('SO an explicit refresh while offline re-reads list and detail instead of keeping stale cache',async()=>{mount();await waitFor(()=>expect(screen.getAllByText('SO original')).toHaveLength(2));m.list.mockResolvedValue([row('SO updated')]);m.get.mockResolvedValue(row('SO updated'));await act(async()=>onlineManager.setOnline(false));fireEvent.click(screen.getByRole('button',{name:'Refresh original project reads'}));await waitFor(()=>{expect(m.list).toHaveBeenCalledTimes(2);expect(m.get).toHaveBeenCalledTimes(2);},{timeout:350});expect(await screen.findAllByText('SO updated')).toHaveLength(2);});
it('SO an offline local read failure returns its original reason with no extra retry',async()=>{m.list.mockRejectedValue(new Error('SO original SQLite unavailable'));onlineManager.setOnline(false);mount(false,null);await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('SO original SQLite unavailable'),{timeout:350});expect(m.list).toHaveBeenCalledOnce();});
it('SO a missing project identity does not invoke a detail read',async()=>{onlineManager.setOnline(false);mount(false,null);expect(m.get).not.toHaveBeenCalled();expect(client.getQueryState(['project',''])?.fetchStatus).toBe('idle');});

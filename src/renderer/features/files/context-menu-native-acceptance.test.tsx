// @vitest-environment jsdom
import{createHash}from'node:crypto';
import{mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync}from'node:fs';
import{join}from'node:path';
import{useSyncExternalStore}from'react';
import{act,cleanup,fireEvent,render,screen,waitFor}from'@testing-library/react';
import userEvent from'@testing-library/user-event';
import{afterAll,afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import{FileService}from'@main/core/files/file-service';
import{FileRootsService}from'@main/core/files/roots';
import{FileRecoveryStore}from'@main/core/files/recovery-store';
import{NativeFileBroker}from'@main/core/files/native-broker';
import{FileBreadcrumb}from'./breadcrumb';
import{WorkspaceTree}from'./workspace-tree';
import{FileWorkspaceStore}from'./workspace-store';
import type{FileClient}from'./file-buffer';
import{rpc}from'@renderer/lib/ipc';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('./terminal-context/context',()=>({useFileTerminalContext:()=>null}));
// E13 inspects origin/type applicability, never launches an application or
// copies/saves/reveals a source. OS app discovery is isolated, native file
// authority/classification/store and original Base UI menus remain real.
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{applications:vi.fn(async()=>({id:'unused-app-discovery',apps:[]}))}},events:{on:()=>()=>undefined}}));
const owner='context-origin-I',directory='子目录 space 🙂',names=['plain.txt','pixel.png','blob.bin'],rows:unknown[]=[];
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
let base:string,root:string,broker:NativeFileBroker,service:FileService,store:FileWorkspaceStore,before:unknown;
function fingerprints(){return names.map(name=>{const p=join(root,directory,name),s=statSync(p,{bigint:true});return{name,sha256:sha(p),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}})}
function View(){useSyncExternalStore(store.subscribe,store.snapshot);return <><FileBreadcrumb store={store} run={action=>{void action()}}/><WorkspaceTree store={store} run={action=>{void action()}}/></>}
function items(){return [...document.querySelectorAll('[role=menu] [role=menuitem]')].map(x=>x.textContent)}
const crumb=(relative:string)=>[...document.querySelectorAll<HTMLButtonElement>('.fw-breadcrumb button')].find(x=>x.title===join(root,relative))!;
const tree=(relative:string)=>[...document.querySelectorAll<HTMLButtonElement>('[role=treeitem]')].find(x=>x.title===join(root,relative))!;
async function context(node:HTMLElement){expect(node).toBeTruthy();fireEvent.contextMenu(node);await screen.findByRole('menu');return items()}
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('E13 real native source authority and original menu origin/type integration',()=>{
 beforeEach(async()=>{vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});vi.mocked(rpc.files.applications).mockClear();base=realpathSync(mkdtempSync('/private/tmp/willyou-context-menu-I-'));root=join(base,'project');mkdirSync(join(root,directory),{recursive:true});mkdirSync(join(base,'userdata'));writeFileSync(join(root,directory,'plain.txt'),'first\nsecond 中文🙂\nthird\n');writeFileSync(join(root,directory,'pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=','base64'));writeFileSync(join(root,directory,'blob.bin'),Buffer.from([0,1,2,255,128,0,3]));before=fingerprints();
  broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);const resolver={sources:()=>[{kind:'project-directory'as const,id:'menu-root',path:root,label:'Own context source',projectId:owner}]};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));const api=new Proxy({},{get:(_target,key:string)=>async(...args:unknown[])=>Reflect.apply((service as unknown as Record<string,(...args:unknown[])=>unknown>)[key==='roots'?'openScope':key],service,[owner,...args])})as FileClient;store=new FileWorkspaceStore({kind:'project',projectId:owner},api,null,null);await store.initialize();await store.open(store.treeRoot!,directory+'/plain.txt',true);await store.list(store.treeRoot!,'');await store.list(store.treeRoot!,directory);if(!store.currentExpanded.includes(directory))store.toggleDirectory(directory);render(<View/>);rows.push({diagnostic:true,root:store.treeRoot,route:store.active?.route,dom:document.body.innerHTML.slice(0,14000)});
 });
 afterEach(async()=>{cleanup();expect(fingerprints()).toEqual(before);store.dispose();service.closeOwner(owner);await service.watcher.dispose();broker.dispose();vi.unstubAllGlobals();rmSync(base,{recursive:true,force:true})});
 it('tree directory has no file actions; tree file has save/path without breadcrumb content/reveal',async()=>{const user=userEvent.setup(),active=store.active;fireEvent.contextMenu(tree(directory));expect(screen.queryByRole('menu')).toBeNull();expect(store.active).toBe(active);const menu=await context(tree(directory+'/plain.txt'));expect(menu).toContain('另存副本…');expect(menu).toContain('复制完整路径');expect(menu).toContain('复制相对路径');expect(menu).not.toContain('复制文件内容');expect(menu).not.toContain('在 Finder 中显示');expect(menu.some(x=>/新建|删除|重命名|提交|合并/.test(x??''))).toBe(false);await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());rows.push({scenario:'tree original real native directory/file menu origin',menu,activeRetained:store.active===active})});
 it('breadcrumb directory is bound to native authorized path and suppresses file-only save/content',async()=>{const user=userEvent.setup(),menu=await context(crumb(directory));expect(menu).toContain('复制完整路径');expect(menu).toContain('在 Finder 中显示');expect(menu).not.toContain('另存副本…');expect(menu).not.toContain('复制文件内容');expect(menu).not.toContain('添加到终端引用');const lease=store.treeRoot!;await waitFor(()=>expect(rpc.files.applications).toHaveBeenCalledWith({kind:'path',path:{lease:lease.lease,generation:lease.generation,relativePath:directory},directory:true}));rows.push({scenario:'native authority directory path target, no file actions',menu,target:vi.mocked(rpc.files.applications).mock.calls.at(-1)?.[0]});await user.keyboard('{Escape}');});
 it('breadcrumb native text/image/binary each retains correct document ref and source-type content capability',async()=>{const user=userEvent.setup();for(const name of names){await act(async()=>{await store.open(store.treeRoot!,directory+'/'+name,true)});const b=store.active!.buffer!;expect(!!b.editor).toBe(name==='plain.txt');const menu=await context(crumb(directory+'/'+name));expect(menu).toContain('另存副本…');expect(menu).toContain('复制完整路径');expect(menu).toContain('在 Finder 中显示');expect(menu.includes('复制文件内容')).toBe(name==='plain.txt');await waitFor(()=>expect(rpc.files.applications).toHaveBeenCalledWith({kind:'document',ref:b.file.ref}));rows.push({scenario:'native source classification and document ref in breadcrumb',name,content:b.content,editor:!!b.editor,menu,ref:b.file.ref});await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('menu')).toBeNull());}});
});
afterAll(()=>{if(process.env.SMARTDD_CONTEXT_MENU_EVIDENCE)writeFileSync(process.env.SMARTDD_CONTEXT_MENU_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-E13',nativeBroker:process.env.SMARTDD_M9_FILE_BROKER,boundary:'I jsdom original WorkspaceTree/FileBreadcrumb/FileContextActions/Base UI with real packaged native file authority/classification and production store/buffer. Unrelated OS application discovery is stubbed, terminal context absent. No native GUI/system clipboard/external/save/reveal actions claimed.',rows},null,2)+'\n')});

// @vitest-environment jsdom
import {randomUUID} from 'node:crypto';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {FileDocument,FileRoot} from '@shared/files';
import {FileWorkspaceStore} from './workspace-store';
import type {FileClient} from './file-buffer';
import {NotebookModel} from './notebook/model';

const injected=vi.hoisted(()=>({store:null as FileWorkspaceStore|null,saveCopy:vi.fn(async()=>({state:'cancelled'}))}));
vi.mock('./workspace-store',async original=>({...await original<typeof import('./workspace-store')>(),fileWorkspaceFor:()=>injected.store!}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{saveCopy:injected.saveCopy,applications:vi.fn(async()=>({id:'fixture',apps:[]}))}},events:{on:vi.fn(()=>()=>{})}}));
vi.mock('./lsp/components',()=>({FileLanguageProvider:({children}:{children:import('react').ReactNode})=>children,LanguageSettingsMenu:()=>null,LanguageResults:()=>null}));
vi.mock('./mcp/viewer',()=>({McpViewerMenu:()=>null,McpViewerSettings:()=>null,McpViewerSlot:({children}:{children:import('react').ReactNode})=>children}));
vi.mock('./git-metadata',()=>({useGitStatus:()=>({data:null,error:'',loading:false}),GitStatusMark:()=>null,FileChanges:()=>null}));
const bytes=new TextEncoder().encode(JSON.stringify({metadata:{title:'Download fixture'},cells:[{cell_type:'code',source:'print("unchanged")',metadata:{},execution_count:0,outputs:[]}]}));
vi.mock('./resource',()=>({readFileResource:async()=>bytes}));
vi.mock('./notebook/client',()=>({createNotebookClient:async()=>{const model=new NotebookModel(bytes,'copy.ipynb');return{ready:Promise.resolve(model.info),window:async(start:number,count:number)=>model.window(start,count),destroy:async()=>{}}},notebookFrameSlots:{acquire:async()=>()=>{}},notebookImageSlots:{acquire:async()=>()=>{}}}));
vi.mock('./office/pages-preview',()=>({FileOfficePagesPreview:()=>null}));
vi.mock('./office/preview',()=>({FileOfficePreview:()=>null}));
vi.mock('./pdf/preview',()=>({FilePdfPreview:()=>null}));
vi.mock('./media/preview',()=>({FileMediaPreview:()=>null}));
vi.mock('./csv/preview',()=>({FileCsvPreview:()=>null}));
vi.mock('./html/preview',()=>({FileHtmlPreview:()=>null}));
vi.mock('./tex/preview',()=>({FileTexPreview:()=>null}));
import {FileWorkspacePanel} from './workspace-panel';

beforeEach(()=>{injected.saveCopy.mockClear();injected.saveCopy.mockResolvedValue({state:'cancelled'});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}})});
afterEach(()=>{cleanup();injected.store?.dispose();injected.store=null;vi.unstubAllGlobals()});
async function fixture(attachment?:{onDownload?:()=>Promise<void>}){
  const root:FileRoot={source:'project-directory',sourceId:'root',path:'/synthetic',canonicalPath:'/synthetic',lease:randomUUID(),generation:1,label:'Synthetic',identity:{device:'1',inode:'2'}};
  const doc:FileDocument={ref:{id:randomUUID(),lease:root.lease,generation:1},documentKey:'synthetic:copy',name:'copy.ipynb',relativePath:'copy.ipynb',absolutePath:'/synthetic/copy.ipynb',writable:true,revision:{device:'1',inode:'3',size:bytes.length,hash:'a'.repeat(64),modifiedNs:'1',changedNs:'1'},content:{kind:'notebook',mime:'application/x-ipynb+json',basis:'extension'}};
  const api={roots:async()=>({roots:[root],unavailable:[]}),list:async()=>[],open:async(request:{readOnly?:boolean})=>({...doc,writable:!request.readOnly}),watch:async()=>null,stopWatch:async()=>{},closeDocument:async()=>{},closeScope:async()=>{}};
  const store=new FileWorkspaceStore({kind:'project',projectId:randomUUID()},api as unknown as FileClient,null,null);injected.store=store;await store.initialize();
  if(attachment)await store.openAttachment(root,'copy.ipynb',{key:'synthetic:attachment',...attachment});else await store.open(root,'copy.ipynb',true);
  render(<FileWorkspacePanel scope={store.scope} onClose={()=>{}}/>);await screen.findByText('Download fixture');await waitFor(()=>expect(screen.getByText('Run 0')).not.toBeNull());
  return{store,doc};
}
describe('Notebook download entry ownership',()=>{
  it('routes ordinary Notebook download through the native save-copy RPC without changing its source or save baseline',async()=>{
    const {store,doc}=await fixture(),buffer=store.active!.buffer!,revision=buffer.file.revision;
    fireEvent.click(await screen.findByRole('button',{name:'下载 Notebook'}));await waitFor(()=>expect(injected.saveCopy).toHaveBeenCalledTimes(1));
    expect(injected.saveCopy).toHaveBeenCalledWith({target:{kind:'document',ref:doc.ref}});expect(buffer.file.revision).toBe(revision);expect(buffer.dirty).toBe(false);expect(buffer.saveReceipt).toBeNull();
  });
  it('keeps attachment downloads on their host callback and never substitutes native source copy',async()=>{
    const callback=vi.fn(async()=>{});const {store}=await fixture({onDownload:callback});
    fireEvent.click(screen.getByRole('button',{name:'下载 Notebook'}));await waitFor(()=>expect(callback).toHaveBeenCalledTimes(1));expect(injected.saveCopy).not.toHaveBeenCalled();expect(store.active!.buffer!.editable).toBe(false);
  });
  it('does not expose a false download action when an attachment host supplies no callback',async()=>{
    await fixture({});expect(screen.queryByRole('button',{name:'下载 Notebook'})).toBeNull();expect(injected.saveCopy).not.toHaveBeenCalled();
  });
  it('shows a download failure and permits retry without submitting notebook code',async()=>{
    let fail=true;const callback=vi.fn(async()=>{if(fail)throw new Error('Synthetic download unavailable')});await fixture({onDownload:callback});
    fireEvent.click(screen.getByRole('button',{name:'下载 Notebook'}));await screen.findByText('Notebook 下载失败：Synthetic download unavailable');expect(injected.saveCopy).not.toHaveBeenCalled();
    expect(screen.queryByText('无法预览 Notebook')).toBeNull();expect(document.querySelector('.fa-notebook-cell')).not.toBeNull();
    fail=false;fireEvent.click(screen.getByRole('button',{name:'下载 Notebook'}));await waitFor(()=>expect(callback).toHaveBeenCalledTimes(2));expect(screen.queryByText('Notebook 下载失败：Synthetic download unavailable')).toBeNull();
  });
});

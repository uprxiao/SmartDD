import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {FileClient} from '../file-buffer';
import {FileWorkspaceStore} from '../workspace-store';
const api=vi.hoisted(()=>Object.fromEntries(['openOffice','closeOffice','editOffice','checkpointOffice','saveOffice','recalculateOffice','drafts','resolveDraft','closeDocument','closeScope','roots','list','open'].map(x=>[x,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
const workbook={kind:'xlsx' as const,sheets:[{id:'1',name:'Sheet',hidden:'visible' as const,rows:10,columns:10,protected:false,defaultRowHeight:20,defaultColumnWidth:80,rowSizes:[],columnSizes:[]}],date1904:false,signed:false,externalLinks:0,protected:false};
const state=(version=0,dirty=false)=>({version,dirty,canUndo:version>0,canRedo:false,workbook});
const scope={kind:'project' as const,projectId:'close'},root={source:'project-directory' as const,sourceId:'close',path:'/close',canonicalPath:'/close',lease:'root',generation:1,label:'Close',identity:{device:'1',inode:'2'}},file={ref:{id:'document',lease:'root',generation:1},name:'book.xlsx',relativePath:'book.xlsx',absolutePath:'/close/book.xlsx',documentKey:'local:1:2',revision:{hash:'base',device:'1',inode:'2',size:100,modifiedNs:'1',changedNs:'1'},writable:true};
let store:FileWorkspaceStore,release:()=>void;
beforeEach(async()=>{
 vi.resetAllMocks();release=()=>{};api.roots.mockResolvedValue({roots:[root],unavailable:[]});api.list.mockResolvedValue([]);api.open.mockResolvedValue(structuredClone(file));api.openOffice.mockResolvedValue({id:'office',hash:'base',workbook,state:state(),calculation:{state:'ready'}});api.drafts.mockResolvedValue([]);api.closeOffice.mockResolvedValue(undefined);api.closeDocument.mockResolvedValue(undefined);api.closeScope.mockResolvedValue(undefined);api.resolveDraft.mockResolvedValue({resolved:true});
 api.checkpointOffice.mockImplementation(async x=>({draftId:x.draftId,bufferVersion:x.bufferVersion,hash:'checkpoint'}));api.saveOffice.mockImplementation(async x=>({state:state(x.version),calculation:{state:'ready'},receipt:{state:'saved',opId:x.opId,bufferVersion:x.bufferVersion,revision:{...file.revision,hash:'saved'}},checkpoint:{draftId:x.draftId,bufferVersion:x.bufferVersion,hash:'checkpoint'}}));
 store=new FileWorkspaceStore(scope,api as unknown as FileClient,{getItem:()=>null,setItem:()=>{}},{load:async()=>null,save:async()=>{}});await store.initialize();await store.open(root,'book.xlsx',true);await store.active!.buffer!.getOffice().load();
});
afterEach(()=>{release();store.dispose();});
describe('J10 pending Office queue must settle before workspace disposal',()=>{
 it.each([true,false])('waits for an edit without raw pending before close, accepted=%s',async accepted=>{
  const tab=store.active!,buffer=tab.buffer!,office=buffer.office!;let entered=false;
  api.editOffice.mockImplementationOnce(async()=>{entered=true;await new Promise<void>(done=>{release=done;});if(!accepted)throw Error('original edit rejected');return{state:state(1,true),calculation:{state:'ready'}};});
  const editing=office.editCell({sheetId:'1',row:0,column:0,text:'in flight'});await vi.waitFor(()=>expect(entered).toBe(true));expect(buffer.dirty).toBe(false);
  let closed=false;const closing=store.close(tab.id).then(result=>{closed=true;return result;});await Promise.resolve();await Promise.resolve();expect(closed).toBe(false);expect(api.closeOffice).not.toHaveBeenCalled();
  release();expect(await editing).toBe(accepted);expect(await closing).toBe(accepted?'closed':'blocked');
  if(accepted){expect(api.saveOffice).toHaveBeenCalledTimes(1);expect(api.closeOffice).toHaveBeenCalledTimes(1);expect(store.tabs).toHaveLength(0);}else{expect(api.saveOffice).not.toHaveBeenCalled();expect(store.active).toBe(tab);expect(api.closeOffice).not.toHaveBeenCalled();expect(buffer.saveError).toContain('original edit rejected');expect(tab.error).toBe('');expect(await store.close(tab.id,true)).toBe('closed');}
 });
 it('closes a clean readonly workbook without any attempted write',async()=>{store.active!.buffer!.file.writable=false;expect(await store.close(store.active!.id)).toBe('closed');expect(api.saveOffice).not.toHaveBeenCalled();});
});

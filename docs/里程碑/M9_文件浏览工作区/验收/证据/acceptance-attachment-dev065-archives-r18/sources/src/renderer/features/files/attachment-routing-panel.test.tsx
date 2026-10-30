// @vitest-environment jsdom
import {randomUUID} from 'node:crypto';
import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {FileDocument,FileRoot} from '@shared/files';
import {FileWorkspaceStore} from './workspace-store';
import type {FileClient} from './file-buffer';
const injected=vi.hoisted(()=>({store:null as FileWorkspaceStore|null}));
vi.mock('./workspace-store',async original=>({...await original<typeof import('./workspace-store')>(),fileWorkspaceFor:()=>injected.store!}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{applications:vi.fn(async()=>({id:'fixture',apps:[]}))}},events:{on:vi.fn(()=>()=>{})}}));
vi.mock('./lsp/components',()=>({FileLanguageProvider:({children}:{children:import('react').ReactNode})=>children,LanguageSettingsMenu:()=>null,LanguageResults:()=>null,LanguageEditorTools:()=>null,useFileLanguage:()=>null}));
vi.mock('./mcp/viewer',()=>({McpViewerMenu:()=>null,McpViewerSettings:()=>null,McpViewerSlot:({children}:{children:import('react').ReactNode})=>children}));
vi.mock('./git-metadata',()=>({useGitStatus:()=>({data:null,error:'',loading:false}),GitStatusMark:()=>null,FileChanges:()=>null}));
vi.mock('./code/editor',()=>({codeHighlight:()=>[]}));
// This suite tests actual panel/store/CodeMirror dispatch and readonly behavior.
// Markdown Worker markup and HTML native isolation are verified separately.
vi.mock('./markdown/editor',()=>({markdownEditor:()=>[EditorView.contentAttributes.of({'data-markdown-preview':'true'})]}));
vi.mock('./html/preview',()=>({FileHtmlPreview:({buffer}:{buffer:import('./file-buffer').FileBuffer})=><div data-testid="html-presentation" data-file={buffer.file.ref.id}>Native HTML host seam</div>}));
vi.mock('./office/pages-preview',()=>({FileOfficePagesPreview:()=>null}));
vi.mock('./office/preview',()=>({FileOfficePreview:()=>null}));
vi.mock('./pdf/preview',()=>({FilePdfPreview:()=>null}));
vi.mock('./notebook/preview',()=>({FileNotebookPreview:()=>null}));
vi.mock('./media/preview',()=>({FileMediaPreview:()=>null}));
vi.mock('./csv/preview',()=>({FileCsvPreview:()=>null}));
vi.mock('./tex/preview',()=>({FileTexPreview:()=>null}));
import {FileWorkspacePanel} from './workspace-panel';
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}})});
afterEach(()=>{cleanup();injected.store?.dispose();injected.store=null;vi.unstubAllGlobals()});
async function fixture(name:string,attachment?:FileDocument['attachment']){
 const root:FileRoot={source:'project-directory',sourceId:'root',path:'/synthetic',canonicalPath:'/synthetic',lease:randomUUID(),generation:1,label:'Synthetic',identity:{device:'1',inode:'2'}},raw='# ATTACHMENT_中文🙂\r\n';
 const file:FileDocument={ref:{id:randomUUID(),lease:root.lease,generation:1},documentKey:'synthetic:'+name,name,relativePath:name,absolutePath:'/synthetic/'+name,writable:!attachment,revision:{device:'1',inode:'3',size:Buffer.byteLength(raw),hash:'a'.repeat(64),modifiedNs:'1',changedNs:'1'},content:{kind:'text',basis:'sample'},...(attachment?{attachment}:{})};
 const api={roots:async()=>({roots:[root],unavailable:[]}),list:async()=>[],open:async()=>file,read:async()=>({document:file,base64:Buffer.from(raw).toString('base64')}),refresh:async()=>file,drafts:async()=>[],watch:async()=>null,stopWatch:async()=>{},closeDocument:async()=>{},closeScope:async()=>{}};
 const store=new FileWorkspaceStore({kind:'project',projectId:randomUUID()},api as unknown as FileClient,null,null);injected.store=store;await store.initialize();
 if(attachment)await store.openAttachment(root,name,{key:'host',...(attachment.mimeType?{mimeType:attachment.mimeType}:{})});else await store.open(root,name,true);
 render(<FileWorkspacePanel scope={store.scope} onClose={()=>{}}/>);await waitFor(()=>expect(store.active?.buffer?.loadState).toBe('ready'));return{store,file};
}
describe('Attachment presentation dispatch through actual workspace panel',()=>{
 it('keeps ordinary MDX in Markdown and attachment MDX in readonly source with no false rich toggle',async()=>{
  await fixture('ordinary.mdx');await waitFor(()=>expect(document.querySelector('[data-markdown-preview=true]')).not.toBeNull());expect(screen.getByRole('button',{name:'查看源码'})).not.toBeNull();
  cleanup();injected.store!.dispose();await fixture('attachment.mdx',{mimeType:'text/markdown',textKind:null});await waitFor(()=>expect(document.querySelector('.cm-editor')).not.toBeNull());expect(document.querySelector('[data-markdown-preview=true]')).toBeNull();expect(screen.queryByRole('button',{name:'查看源码'})).toBeNull();expect(EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!.state.facet(EditorState.readOnly)).toBe(true);
 });
 it('uses a main-derived extensionless Markdown mapping but leaves an unknown extension as source',async()=>{
  await fixture('no-extension',{mimeType:'text/markdown',textKind:'markdown'});await waitFor(()=>expect(document.querySelector('[data-markdown-preview=true]')).not.toBeNull());expect(injected.store!.active!.buffer!.editable).toBe(false);
  cleanup();injected.store!.dispose();await fixture('unknown.ext',{mimeType:'text/markdown',textKind:null});await waitFor(()=>expect(document.querySelector('.cm-content')).not.toBeNull());expect(document.querySelector('[data-markdown-preview=true]')).toBeNull();expect(screen.queryByRole('button',{name:'查看源码'})).toBeNull();
 });
 it('passes only the mapped HTML buffer to the native host and retains readonly source/document switching',async()=>{
  const {file}=await fixture('html-attachment',{mimeType:'text/html',textKind:'html'});expect((await screen.findByTestId('html-presentation')).getAttribute('data-file')).toBe(file.ref.id);
  fireEvent.click(screen.getByRole('button',{name:'查看源码'}));await waitFor(()=>expect(document.querySelector('.cm-content')).not.toBeNull());expect(screen.queryByTestId('html-presentation')).toBeNull();expect(injected.store!.active!.buffer!.editable).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'查看文档'}));await screen.findByTestId('html-presentation');
 });
});

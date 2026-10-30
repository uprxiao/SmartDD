// @vitest-environment jsdom
import{randomUUID}from'node:crypto';
import{mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync}from'node:fs';
import{join}from'node:path';
import{act,cleanup,renderHook,waitFor}from'@testing-library/react';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import type{FileRoot,FileSearchRequest,FileSearchResult}from'@shared/files';
import{FileService}from'@main/core/files/file-service';
import{FileRootsService}from'@main/core/files/roots';
import{FileRecoveryStore}from'@main/core/files/recovery-store';
import{NativeFileBroker}from'@main/core/files/native-broker';
import{rankFileCandidates}from'./file-fuzzy-model.mjs';
import{useFileSearch}from'./file-search';
const transport=vi.hoisted(()=>({search:vi.fn(),cancel:vi.fn(async()=>undefined)}));
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{startSearchSession:(input:unknown)=>transport.search(input),cancelSearch:(id:string)=>transport.cancel(id)}},events:{on:()=>()=>undefined}}));
const root:FileRoot={source:'project-directory',sourceId:'fixture',path:'/fixture',canonicalPath:'/fixture',label:'Fixture',lease:randomUUID(),generation:1,identity:{device:'1',inode:'2'}};
// Adapter only for hook lifecycle tests. Actual name Worker is tested in A.
class RankingAdapter{
 onmessage:((event:{data:{ranked:unknown[]}})=>void)|null=null;terminated=false;
 postMessage(input:{paths:string[];query:string}){queueMicrotask(()=>{if(!this.terminated)this.onmessage?.({data:{ranked:rankFileCandidates(input.query,input.paths.map(path=>({path})))}})})}
 terminate(){this.terminated=true}
}
beforeEach(()=>{vi.stubGlobal('Worker',RankingAdapter);transport.cancel.mockClear();transport.search.mockImplementation(async(input:FileSearchRequest):Promise<FileSearchResult>=>({id:input.id,kind:input.kind,paths:input.kind==='name'?[input.query+'.txt']:[],rows:input.kind==='content'?[{relativePath:input.query+'.txt',line:1,column:1,text:input.query,ranges:[{from:0,to:input.query.length}]}]:[],limited:false,searched:1,skipped:0,issues:[]}))});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks()});
it.each(['name','content']as const)('C18 binds %s results to the current query before debounce and rejects an old delayed success',async kind=>{
 const hook=renderHook(({query}:{query:string})=>useFileSearch(root,kind,query),{initialProps:{query:'foo'}});
 const paths=()=>kind==='name'?hook.result.current.names.map(x=>x.path):hook.result.current.rows.map(x=>x.relativePath);
 await waitFor(()=>expect(paths()).toEqual(['foo.txt']));hook.rerender({query:'bar'});await waitFor(()=>expect(paths()).toEqual(['bar.txt']));
 hook.rerender({query:'foo'});expect(paths()).not.toContain('bar.txt');await waitFor(()=>expect(paths()).toEqual(['foo.txt']));
 let release!:(value:FileSearchResult)=>void;let held:FileSearchRequest|undefined;
 transport.search.mockImplementationOnce((input:FileSearchRequest)=>{held=input;return new Promise<FileSearchResult>(resolve=>{release=resolve})});
 hook.rerender({query:'bar'});await waitFor(()=>expect(held).toBeDefined());hook.rerender({query:'foo'});await waitFor(()=>expect(paths()).toEqual(['foo.txt']));
 await act(async()=>release({id:held!.id,kind,paths:['bar.txt'],rows:[{relativePath:'bar.txt',line:1,column:1,text:'bar',ranges:[]}],limited:false,searched:1,skipped:0,issues:[]}));expect(paths()).toEqual(['foo.txt']);
 hook.rerender({query:'   '});expect(hook.result.current.phase).toBe('idle');expect(paths()).toEqual([]);hook.unmount();
});
const excluded=['.git','.hg','.next','.pnpm-store','.svn','.turbo','.yarn','build','coverage','dist','node_modules'];
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('real FileService and packaged native name-search candidates',()=>{
 let base:string,project:string,service:FileService,broker:NativeFileBroker,nativeRoot:FileRoot,requests:string[];
 const files=['collapsed/one/two/DeepOnly_唯一.ts','foo.ts','a/foo.ts','foobar.ts','a/f-o-o.ts','中文资料.txt','space name.txt','MiXeDCase.txt','emoji😀-报告.txt',...excluded.map(p=>p+'/unique.txt'),'nested/node_modules/unique.txt','my_node_modules/unique.txt','abc.git/aunique.txt','.gitignore'];
 const search=async(query:string)=>service.searcher.search('name-acceptance',{id:randomUUID(),root:{lease:nativeRoot.lease,generation:nativeRoot.generation},kind:'name',query},()=>undefined);
 beforeEach(async()=>{
  base=mkdtempSync('/private/tmp/willyou-name-search-integration-');project=join(base,'project');mkdirSync(project);
  for(const p of files){const path=join(project,p);mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true});writeFileSync(path,'Native name fixture '+p+'\n')}
  broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);requests=[];const original=broker.request.bind(broker);broker.request=async(input,options)=>{requests.push(String(input.operation)+':'+String(input.relativePath??''));return original(input,options)};
  const resolver={sources:()=>[{kind:'project-directory'as const,id:'name-root',path:project,label:'Native name fixture',projectId:'names'}]};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));nativeRoot=(await service.openScope('name-acceptance',{kind:'project',projectId:'names'})).roots[0];
 });
 afterEach(async()=>{service.closeOwner('name-acceptance');await service.watcher.dispose();broker.dispose();for(const p of files)expect(readFileSync(join(project,p),'utf8')).toBe('Native name fixture '+p+'\n');rmSync(base,{recursive:true,force:true})});
 it('C01 finds deep native paths without expanding/loading their parent directories',async()=>{const result=await search('DeepOnly');expect(result.paths).toContain('collapsed/one/two/DeepOnly_唯一.ts');expect(requests).toContain('walk:');expect(requests.some(x=>x.startsWith('list:collapsed'))).toBe(false)});
 it('C02/C17 excludes all eleven exact segments while ordinary native listing still reads each directory',async()=>{const result=await search('unique');for(const p of excluded){expect(result.paths).not.toContain(p+'/unique.txt');const entries=await service.list('name-acceptance',{root:{lease:nativeRoot.lease,generation:nativeRoot.generation},relativePath:p});expect(entries.some(x=>x.name==='unique.txt')).toBe(true)}expect(result.paths).not.toContain('nested/node_modules/unique.txt');expect(result.paths).toEqual(expect.arrayContaining(['my_node_modules/unique.txt','abc.git/aunique.txt','.gitignore']))});
 it('C03/C04 retains zero-score candidates, stable basename ties and whole Unicode fragments',async()=>{const result=await search('foo'),candidates=['foo.ts','a/foo.ts','foobar.ts','a/f-o-o.ts'].filter(p=>result.paths.includes(p)),ranked=rankFileCandidates('foo',candidates.map(path=>({path})));expect(ranked.filter(x=>x.file_name==='foo.ts').map(x=>x.path)).toEqual(['foo.ts','a/foo.ts']);expect(ranked[0].score).toBe(110024);const pathRanked=rankFileCandidates('a/foo',[{path:'a/f-o-o.ts'},{path:'a/foo.ts'}]);expect(pathRanked.map(x=>x.path)).toEqual(['a/foo.ts','a/f-o-o.ts']);expect(pathRanked[1].score).toBe(0);for(const[q,path]of[['中文','中文资料.txt'],['space name','space name.txt'],['mixedcase','MiXeDCase.txt'],['😀','emoji😀-报告.txt']]){expect(result.paths).toContain(path);const match=rankFileCandidates(q,[{path}])[0];expect(match.matched).toBe(true);for(const f of match.fragments){const marked=match.file_name.slice(f.start,f.end);expect(marked).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)}}});
});

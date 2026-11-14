import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {pluginPanelSchema} from './plugins';
import {pluginListView,pluginPanelInput,pluginUiField,resolvePluginUiTemplate} from './plugin-ui';
const panel=()=>pluginPanelSchema.parse({id:'items',title:'待办',kind:'list',tabs:[{id:'bug',title:'Bug',input:{kind:'bug'}}],source:{capability:'tracker.items.list',input:{reference:'{row.reference}'},items:'items',pagination:{type:'cursor',inputField:'cursor',nextField:'nextCursor',pageSize:50},partial:{completeField:'complete',problemsField:'problems'}},rowKey:'id',columns:[{field:'title',title:'标题'}]});
describe('data-only plugin declaration presentation',()=>{
 it('retains opaque typed references and does not mutate the original source',()=>{
  const reference={connectionId:'synthetic-connection',object:{id:'79291',revision:4}},input=resolvePluginUiTemplate({kind:'{tab.input.kind}',reference:'{row.reference}'},{tab:{input:{kind:'bug'}},row:{reference}}) as {reference:typeof reference};
  expect(input).toEqual({kind:'bug',reference});input.reference.object.id='changed';expect(reference.object.id).toBe('79291');
 });
 it('renders embedded labels as text while refusing structured values in strings',()=>{
  expect(resolvePluginUiTemplate('Bug #{row.id} · {value.title}',{row:{id:'1'},value:{title:'<script>not executable</script>'}})).toBe('Bug #1 · <script>not executable</script>');
  expect(()=>resolvePluginUiTemplate('Ref {row.reference}',{row:{reference:{id:1}}})).toThrow('结构化引用');
 });
 it('refuses unknown/prototype scopes, missing required data and accessor execution',()=>{
  expect(()=>resolvePluginUiTemplate('{process.env}',{})).toThrow();expect(()=>pluginUiField({},'constructor.name')).toThrow();expect(()=>resolvePluginUiTemplate('{row.missing}',{row:{}})).toThrow('缺少');
  let accessed=false;const row=Object.defineProperty({},'reference',{get:()=>{accessed=true;return'wrong';}});expect(pluginUiField(row,'reference')).toBeUndefined();expect(accessed).toBe(false);
 });
 it('combines selected-tab input with typed declaration parameters',()=>{
  const p=panel();expect(pluginPanelInput(p,{tab:p.tabs[0],row:{reference:{id:'synthetic'}}})).toEqual({kind:'bug',reference:{id:'synthetic'}});
 });
 it('preserves partial rows and an explicit next cursor, including structured problem codes',()=>{
  expect(pluginListView(panel(),{items:[{id:'1',title:'First'}],nextCursor:'page-2',complete:false,problems:[{code:'PAGE_UNAVAILABLE',objectId:null}]})).toMatchObject({rows:[{key:'1',value:{title:'First'}}],nextCursor:'page-2',complete:false,problems:['PAGE_UNAVAILABLE']});
 });
 it('distinguishes a valid empty list from missing rows, duplicate IDs and invalid completeness/cursors',()=>{
  const p=panel(),base={items:[],nextCursor:null,complete:true,problems:[]};expect(pluginListView(p,base)).toMatchObject({rows:[],complete:true,nextCursor:null});
  for(const value of [{...base,items:undefined},{...base,items:[{id:'same'},{id:'same'}]},{...base,nextCursor:0},{...base,complete:'yes'}])expect(()=>pluginListView(p,value)).toThrow();
 });
});


it.each(['bug','story'])('uses five-row pages from the real Zentao declaration for %s requests',kind=>{
 const manifest=JSON.parse(readFileSync(new URL('../../plugins/zentao/package/.willyou-plugin/plugin.json',import.meta.url),'utf8'));
 const declaration=pluginPanelSchema.parse(manifest.ui.panels.find((p:{id:string})=>p.id==='my-work'));
 const tab=declaration.tabs.find(t=>t.id===kind);
 expect(pluginPanelInput(declaration,{tab})).toEqual({kind,limit:5});
 expect(declaration.source.pagination?.pageSize).toBe(5);
});

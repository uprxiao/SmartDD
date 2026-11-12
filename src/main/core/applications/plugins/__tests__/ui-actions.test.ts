import {randomUUID} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {pluginPanelSchema,type PluginUiRead} from '@shared/plugins';
import {PluginUiActions} from '../ui-actions';

let now:number,actions:PluginUiActions;
const panel=pluginPanelSchema.parse({id:'work',title:'Work',kind:'list',tabs:[{id:'bug',title:'Bug',input:{kind:'bug'}},{id:'story',title:'Story',input:{kind:'story'}}],source:{capability:'demo.items.list',items:'items'},rowKey:'id',columns:[{field:'id',title:'ID'}],rowActions:[{kind:'openUrl',title:'Open',field:'url'},{kind:'insertTerminal',title:'Insert',payload:{reference:'{row.reference}'}}],onRowOpen:{detail:'object'},details:{object:{titleTemplate:'Object {row.id}',source:{capability:'demo.object.get',input:{kind:'{tab.input.kind}',reference:'{row.reference}'}},sections:[],actions:[{kind:'insertTerminal',title:'Insert detail',payload:{kind:'{tab.input.kind}',reference:'{value.reference}'},closeOnDone:true},{kind:'openUrl',title:'Open detail',field:'url'}]}}});
const input=(capability='demo.items.list',value:Record<string,unknown>={kind:'bug'}):PluginUiRead=>({requestId:randomUUID(),appId:'demo',projectId:'p1',panelId:'work',packageHash:'a'.repeat(64),capability,input:value});
function list(url='https://example.invalid/bug/1',check=vi.fn()){
  const value={items:[{id:'1',title:'Bug',url,reference:{opaque:'R1'}},{id:'2',title:'Other',url:'https://example.invalid/bug/2',reference:{opaque:'R2'}}]};
  const receipt=actions.remember('owner',input(),panel,'Demo',value,{username:'qa'},'c'.repeat(64),check)!;
  return{receipt,value,check,request:{receiptId:receipt,actionIndex:0,row:{receiptId:receipt,index:0,tabId:'bug'}}};
}
beforeEach(()=>{now=1000;actions=new PluginUiActions(()=>now);});
describe('host-owned declaration action proofs',()=>{
  it('opens only the declared URL from the original host result, not renderer text or a mutated source object',()=>{
    const f=list();f.value.items[0].url='https://changed.invalid';const a=actions.prepare('owner',f.request);expect(a).toMatchObject({kind:'openUrl',url:'https://example.invalid/bug/1',appId:'demo',projectId:'p1'});
    expect(()=>actions.prepare('owner',{...f.request,url:'https://client.invalid'} as never)).toThrow();expect(f.check).toHaveBeenCalled();
  });
  it.each(['file:///etc/passwd','javascript:alert(1)','data:text/html,test','https://qa:password@example.invalid/','https://example.invalid/\nuser'])('refuses unsafe URL %s',url=>{
    const f=list(url);expect(()=>actions.prepare('owner',f.request)).toThrow();
  });
  it('preserves structured opaque reference objects in bounded terminal text and strips terminal controls',()=>{
    const f=list(),a=actions.prepare('owner',{...f.request,actionIndex:1});expect(a).toMatchObject({kind:'insertTerminal'});if(a.kind!=='insertTerminal')throw new Error('fixture');expect(a.text).toContain('"reference":{"opaque":"R1"}');expect(a.text).not.toContain('R2');
    const proof=actions.proof('owner',a.id);expect(proof.value).toEqual(a);if(proof.value.kind==='insertTerminal')proof.value.text='client mutation';expect(actions.proof('owner',a.id).value).toEqual(a);
  });
  it('derives detail actions from the exact original row, tab and returned detail',()=>{
    const f=list(),detail=actions.remember('owner',input('demo.object.get',{kind:'bug',reference:{opaque:'R1'}}),panel,'Demo',{reference:{opaque:'DETAIL1'},url:'https://example.invalid/detail/1'},{username:'qa'},'c'.repeat(64),vi.fn())!;
    const request={...f.request,receiptId:detail,detailId:'object'},a=actions.prepare('owner',request);expect(a).toMatchObject({kind:'insertTerminal',closeOnDone:true});if(a.kind==='insertTerminal')expect(a.text).toContain('"kind":"bug","reference":{"opaque":"DETAIL1"}');
    expect(actions.prepare('owner',{...request,actionIndex:1})).toMatchObject({kind:'openUrl',url:'https://example.invalid/detail/1'});
    for(const changes of[{row:{...request.row,index:1}},{row:{...request.row,tabId:'story'}},{detailId:'constructor'},{detailId:'missing'}])expect(()=>actions.prepare('owner',{...request,...changes})).toThrow();
  });
  it('rejects forged owners, rows, missing declarations and cross-project or cross-connection origins',()=>{
    const f=list();expect(()=>actions.prepare('foreign',f.request)).toThrow();
    for(const changes of[{row:{...f.request.row,index:9}},{actionIndex:31},{row:{...f.request.row,tabId:'story'}}])expect(()=>actions.prepare('owner',{...f.request,...changes})).toThrow();
    for(const changes of[{projectId:'p2'},{appId:'other'},{packageHash:'b'.repeat(64)}]){const other=actions.remember('owner',{...input(),...changes},panel,'Demo',f.value,{},'c'.repeat(64),vi.fn())!;expect(()=>actions.prepare('owner',{...f.request,receiptId:other})).toThrow();}
    const other=actions.remember('owner',input(),panel,'Demo',f.value,{},'d'.repeat(64),vi.fn())!;expect(()=>actions.prepare('owner',{...f.request,receiptId:other})).toThrow();
  });
  it('rechecks current authority at preparation and at terminal dispatch; expiry, release and close invalidate proofs',()=>{
    const f=list(),a=actions.prepare('owner',f.request),proof=actions.proof('owner',a.id);f.check.mockImplementation(()=>{throw new Error('connection changed');});expect(()=>proof.assert()).toThrow('connection changed');expect(()=>actions.prepare('owner',f.request)).toThrow('connection changed');f.check.mockReset();
    actions.release('foreign',a.id);proof.assert();actions.release('owner',a.id);expect(()=>proof.assert()).toThrow();
    const b=actions.prepare('owner',f.request);now+=300001;expect(()=>actions.proof('owner',b.id)).toThrow();expect(()=>actions.prepare('owner',f.request)).toThrow();
    const g=list(),c=actions.prepare('owner',g.request);actions.close();expect(()=>actions.proof('owner',c.id)).toThrow();
  });
  it('bounds retained read results and action handles without deleting a still-visible earlier proof',()=>{
    const f=list(),first=actions.prepare('owner',f.request);for(let i=1;i<16;i++)actions.prepare('owner',f.request);expect(()=>actions.prepare('owner',f.request)).toThrow('动作过多');actions.proof('owner',first.id).assert();
    for(let i=1;i<32;i++)list();expect(()=>list()).toThrow('引用过多');actions.proof('owner',first.id).assert();now+=300001;expect(()=>list()).not.toThrow();
  });
  it('claims a native-open action once before any asynchronous external call, while retaining original policy checks',()=>{
    const f=list(),a=actions.prepare('owner',f.request),claimed=actions.consume('owner',a.id);claimed.assert();expect(()=>actions.consume('owner',a.id)).toThrow();expect(()=>actions.proof('owner',a.id)).toThrow();f.check.mockImplementation(()=>{throw new Error('revoked');});expect(()=>claimed.assert()).toThrow('revoked');
  });
});

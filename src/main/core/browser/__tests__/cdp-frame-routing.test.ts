import {describe,expect,it,vi} from 'vitest';
import type {WebContents} from 'electron';
import {BrowserCdpProxy} from '../cdp-proxy';

function fixture(){
  const nodes=[{nodeId:'child-button',backendDOMNodeId:42,role:{value:'button'},name:{value:'inside child'}}];
  const sendCommand=vi.fn(async()=>({nodes}));
  const proxy=new BrowserCdpProxy({isDestroyed:()=>false,debugger:{sendCommand}} as unknown as WebContents);
  const send=vi.fn(),client={socket:{readyState:1,send},pageSessions:new Set(['wy-session-1']),browserSessions:new Set<string>(),primary:'wy-session-1'};
  const attach=(id:string,targetId:string,type='iframe')=>Reflect.get(proxy,'message')(null,'Target.attachedToTarget',{sessionId:id,targetInfo:{targetId,type},waitingForDebugger:false},undefined);
  const detach=(id:string)=>Reflect.get(proxy,'message')(null,'Target.detachedFromTarget',{sessionId:id},undefined);
  const request=async(params:Record<string,unknown>={},sessionId='wy-session-1',method='Accessibility.getFullAXTree')=>{
    await Reflect.get(proxy,'handle').call(proxy,client,JSON.stringify({id:7,method,params,sessionId}));
    return JSON.parse(send.mock.calls.at(-1)![0] as string);
  };
  return{proxy,nodes,sendCommand,attach,detach,request};
}

describe('first Helper snapshot in an owned cross-process frame',()=>{
  it('routes an explicit child-frame AX read to its owned session while preserving the wire reply',async()=>{
    const f=fixture();f.attach('child-session','child-frame');const capture=f.proxy.captureSnapshot();
    const reply=await f.request({frameId:'child-frame'});capture.finish();
    expect(f.sendCommand).toHaveBeenCalledExactlyOnceWith('Accessibility.getFullAXTree',{frameId:'child-frame'},'child-session');
    expect(reply).toEqual({id:7,result:{nodes:f.nodes},sessionId:'wy-session-1'});
    expect(capture.trees).toEqual([{sessionId:'child-session',frameId:'child-frame',nodes:f.nodes}]);
  });
  it('also routes a direct page request that has no virtual session',async()=>{
    const f=fixture();f.attach('child-session','child-frame');
    const send=vi.fn();await Reflect.get(f.proxy,'handle').call(f.proxy,{socket:{readyState:1,send},pageSessions:new Set(),browserSessions:new Set()},JSON.stringify({id:8,method:'Accessibility.getFullAXTree',params:{frameId:'child-frame'}}));
    expect(f.sendCommand.mock.calls.at(-1)).toEqual(['Accessibility.getFullAXTree',{frameId:'child-frame'},'child-session']);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({id:8,result:{nodes:f.nodes}});
  });
  it('keeps an explicitly selected native child session',async()=>{
    const f=fixture();f.attach('first-session','first-frame');f.attach('other-session','other-frame');
    await f.request({frameId:'first-frame'},'first-session');
    expect(f.sendCommand).toHaveBeenCalledExactlyOnceWith('Accessibility.getFullAXTree',{frameId:'first-frame'},'first-session');
  });
  it('never routes an unknown frame to another page or sibling',async()=>{
    const f=fixture();f.attach('child-session','child-frame');await f.request({frameId:'foreign-frame'});
    expect(f.sendCommand).toHaveBeenCalledExactlyOnceWith('Accessibility.getFullAXTree',{frameId:'foreign-frame'});
  });
  it('does not route a detached child session',async()=>{
    const f=fixture();f.attach('child-session','child-frame');f.detach('child-session');await f.request({frameId:'child-frame'});
    expect(f.sendCommand).toHaveBeenCalledExactlyOnceWith('Accessibility.getFullAXTree',{frameId:'child-frame'});
  });
  it('rejects an ambiguous owner before sending any native command',async()=>{
    const f=fixture();f.attach('first-session','same-frame');f.attach('second-session','same-frame');
    const reply=await f.request({frameId:'same-frame'});
    expect(f.sendCommand).not.toHaveBeenCalled();expect(reply.error.message).toContain('唯一确定');
  });
  it('does not accept a foreign or stale explicit session',async()=>{
    const f=fixture();f.attach('child-session','child-frame');const reply=await f.request({frameId:'child-frame'},'foreign-session');
    expect(f.sendCommand).not.toHaveBeenCalled();expect(reply.error.message).toContain('outside this page');
  });
  it('does not redirect a top-frame snapshot or other CDP methods',async()=>{
    const f=fixture();f.attach('child-session','child-frame');
    await f.request({});await f.request({backendNodeId:42,frameId:'child-frame'},'wy-session-1','DOM.describeNode');
    expect(f.sendCommand.mock.calls).toEqual([['Accessibility.getFullAXTree',{}],['DOM.describeNode',{backendNodeId:42,frameId:'child-frame'}]]);
  });
});

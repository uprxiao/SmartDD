import {describe,expect,it} from 'vitest';
import {browserPageArguments} from '../page-commands';

describe('browser page command input boundary',()=>{
  it('preserves an omitted release button so the native pointer releases its held button',()=>{
    expect(browserPageArguments('mouse down',{})).toEqual(['mouse','down','left']);
    expect(browserPageArguments('mouse up',{})).toEqual(['mouse','up']);
    expect(browserPageArguments('mouse up',{button:'right'})).toEqual(['mouse','up','right']);
  });
  it('expresses media motion as the fixed native parser bare marker, including clearing the previous reduction',()=>{
    expect(browserPageArguments('set media',{'color-scheme':'dark','reduced-motion':'reduce'})).toEqual(['set','media','dark','reduced-motion']);
    expect(browserPageArguments('set media',{'color-scheme':'light','reduced-motion':'no-preference'})).toEqual(['set','media','light']);
    expect(browserPageArguments('set media',{'reduced-motion':'reduce'})).toEqual(['set','media','reduced-motion']);
    expect(browserPageArguments('set media',{})).toEqual(['set','media']);
    expect(()=>browserPageArguments('set media',{'reduced-motion':'invalid'})).toThrow('reduced-motion');
  });
  it('keeps option-looking text, quoting and shell syntax inside one input value',()=>{
    const source='--cdp ws://foreign $(touch forbidden); "quoted"\nsecond line';
    expect(browserPageArguments('find',{locator:'text',value:source,action:'fill',text:false})).toEqual(['find','text',source,'fill','false']);
    expect(browserPageArguments('storage local set',{key:123,value:true})).toEqual(['storage','local','set','123','true']);
    expect(()=>browserPageArguments('storage local set',{key:'a',value:{secret:'no coercion'}})).toThrow('文本字段');
  });
  it('retains array upload paths containing commas and refuses empty paths',()=>{
    expect(browserPageArguments('upload',{element:'@held',files:['/private/tmp/a,b','/private/tmp/c d']})).toEqual(['upload','@held','/private/tmp/a,b','/private/tmp/c d']);
    expect(browserPageArguments('upload',{element:'@held',files:'/private/tmp/a,/private/tmp/b'})).toEqual(['upload','@held','/private/tmp/a','/private/tmp/b']);
    expect(()=>browserPageArguments('upload',{element:'@held',files:[]})).toThrow('不能为空');
  });
  it('preserves role name/exact options declared by the requirements',()=>{
    expect(browserPageArguments('find',{locator:'role',value:'button',action:'click',name:'Save draft',exact:true})).toEqual(['find','role','button','click','--name','Save draft','--exact']);
    expect(browserPageArguments('find',{locator:'role',value:'button',action:'click',exact:false})).toEqual(['find','role','button','click']);
  });
  it('expresses nth selector, action and a literal payload without repurposing action or invoking a shell',()=>{
    expect(browserPageArguments('find',{locator:'nth',value:'1 button[data-name="A B"]',action:'fill',text:'literal $(no-shell)'})).toEqual(['find','nth','1','button[data-name="A B"]','fill','literal $(no-shell)']);
    expect(()=>browserPageArguments('find',{locator:'nth',value:1,action:'fill',text:'value'})).toThrow('CSS选择器');
    expect(()=>browserPageArguments('find',{locator:'nth',value:'1 button',action:'button',text:'focus'})).toThrow('find action');
  });
  it('refuses non-finite coordinates before constructing input and makes no generic fallback',()=>{
    expect(()=>browserPageArguments('mouse move',{x:Infinity,y:1})).toThrow('有限数字');
    expect(browserPageArguments('connect',{url:'ws://foreign'})).toBeNull();
    expect(browserPageArguments('open',{url:'file:///private/tmp/forbidden'})).toBeNull();
  });
});

// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {BROWSER_WAIT_OBSERVER} from '../wait';
describe('fixed read-only wait observer',()=>{
  afterEach(()=>document.body.replaceChildren());
  const observe=new Function('return ('+BROWSER_WAIT_OBSERVER+')')();
  it('treats missing/hidden selectors as hidden and does not invert an omitted text condition',()=>{
    expect(observe('#missing',null,true)).toMatchObject({selector:true,text:true});
    expect(observe('#missing',null,false)).toMatchObject({selector:false,text:true});
    const node=document.createElement('span');node.id='hidden';node.hidden=true;document.body.append(node);
    expect(observe('#hidden',null,true)).toMatchObject({selector:true,text:true});
  });
  it('returns each supplied condition independently so one match cannot erase another',()=>{
    document.body.innerText='Existing text';
    expect(observe('#missing','Existing text',false)).toMatchObject({selector:false,text:true});
    expect(observe(null,'Missing text',false)).toMatchObject({selector:true,text:false});
    expect(observe(null,'Missing text',true)).toMatchObject({selector:true,text:true});
  });
});

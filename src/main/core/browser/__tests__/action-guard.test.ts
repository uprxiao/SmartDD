// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { BROWSER_GUARD_SOURCE } from '../action-guard';

declare global {
  var __wyBrowserGuard: {
    arm(node:Node):boolean;
    disarm():{accepted:string[];blocked:string[];connected:boolean};
  };
}

describe('S1 guard bootstrap before page listeners',()=>{
  beforeEach(()=>{new Function(BROWSER_GUARD_SOURCE)();});
  it('allows the retained node and blocks a clone before later page capture listeners',()=>{
    // Compile and execute the exact injected source. This is DOM-level, not Electron evidence.
    new Function(BROWSER_GUARD_SOURCE)();
    const guard=globalThis.__wyBrowserGuard;
    const original=document.createElement('button');original.textContent='Action';document.body.append(original);
    const hits:EventTarget[]=[];const page=(event:Event)=>hits.push(event.target!);window.addEventListener('click',page,true);
    try{
      expect(guard.arm(original)).toBe(true);
      original.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,composed:true}));
      expect(hits).toEqual([original]);expect(guard.disarm().blocked).toEqual([]);
      guard.arm(original);const clone=original.cloneNode(true);original.replaceWith(clone);
      const accepted=clone.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,composed:true}));
      expect(accepted).toBe(false);expect(hits).toEqual([original]);expect(guard.disarm().blocked).toContain('click');
    }finally{guard.disarm();window.removeEventListener('click',page,true);document.body.replaceChildren();}
  });
  it('rejects disconnected nodes before arming and records delivered input separately from a later block',()=>{
    const guard=globalThis.__wyBrowserGuard;
    const input=document.createElement('input');expect(guard.arm(input)).toBe(false);document.body.append(input);guard.arm(input);
    input.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,composed:true}));
    const clone=input.cloneNode();input.replaceWith(clone);clone.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,composed:true}));
    const state=guard.disarm();expect(state.accepted).toContain('beforeinput');expect(state.blocked).toContain('beforeinput');document.body.replaceChildren();
  });
  it('allows the previous focused input to commit a blur change without allowing unrelated inputs or a replaced target',()=>{
    const guard=globalThis.__wyBrowserGuard;
    const button=document.createElement('button'),previous=document.createElement('input'),unrelated=document.createElement('input');
    document.body.append(button,previous,unrelated); previous.focus();
    const seen:EventTarget[]=[];const onChange=(event:Event)=>seen.push(event.target!);window.addEventListener('change',onChange,true);
    try{
      guard.arm(button);
      expect(previous.dispatchEvent(new Event('change',{bubbles:true,cancelable:true}))).toBe(true);
      expect(unrelated.dispatchEvent(new Event('change',{bubbles:true,cancelable:true}))).toBe(false);
      button.replaceWith(button.cloneNode());
      expect(previous.dispatchEvent(new Event('change',{bubbles:true,cancelable:true}))).toBe(false);
      expect(seen).toEqual([previous]);
      expect(guard.disarm()).toMatchObject({accepted:['change'],blocked:['change','change'],connected:false});
    }finally{guard.disarm();window.removeEventListener('change',onChange,true);document.body.replaceChildren();}
  });
});

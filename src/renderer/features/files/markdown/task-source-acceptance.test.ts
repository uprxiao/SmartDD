// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskSource, taskLines, taskLinks, taskImage } from '../../../../../prototypes/m6-codex/tests/markdown-task-fixture.mjs';
import { createSourceField } from '../editor-source';
import { markdownEditor } from './editor';
import { analyze, renderWindow } from './model.mjs';

// U component boundary: jsdom geometry and asynchronous Worker transport are
// controlled; original analyze/renderWindow, source field and widget handler run.
class ModelWorker {
 onmessage: ((event: {data: unknown})=>void)|null=null;
 parsed: ReturnType<typeof analyze>['parsed']|null=null;
 stopped=false;
 postMessage(data: {type:string;id:number;rev:number;source:string;start:number;readOnly:boolean}) {
  const {id,rev}=data;
  const result=data.type==='parse'?(()=>{const r=analyze(data.source);this.parsed=r.parsed;return{type:'result',id,rev,index:r.index};})():{type:'window',id,rev,items:renderWindow(this.parsed!,data.start,60,data.readOnly)};
  setTimeout(()=>{if(!this.stopped)this.onmessage?.({data:result});},0);
 }
 terminate(){this.stopped=true;}
}
const views:EditorView[]=[];
const until=async(fn:()=>boolean)=>{const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw Error('Original task widgets not settled');await new Promise(r=>setTimeout(r,10));}};
beforeEach(()=>{
 vi.stubGlobal('Worker',ModelWorker);vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});
});
afterEach(()=>{views.splice(0).forEach(v=>v.destroy());vi.unstubAllGlobals();document.body.replaceChildren();});
async function mount(readOnly=false){
 const source=createSourceField(taskSource),links=vi.fn(),images=vi.fn(async(_element:HTMLImageElement,_href:string,_signal:AbortSignal)=>{}),parent=document.createElement('div');document.body.append(parent);
 const view=new EditorView({parent,state:EditorState.create({doc:source.normalized,selection:{anchor:source.normalized.length},extensions:[source.extensions,EditorState.readOnly.of(readOnly),markdownEditor({source,editable:!readOnly},{status(){},link:links,image:images})]})});views.push(view);
 await until(()=>parent.querySelectorAll('input[data-md-task-line]').length===4);
 return{source,view,parent,links,images,raw:()=>view.state.field(source.field).raw};
}
describe('Y07 task widgets retain exact source lines and authored Unicode paths',()=>{
 it.each(taskLines)('only changes the marker byte for zero-based source line %i through original widget handler',async line=>{
  const f=await mount();let expected=taskSource;
  for(let step=0;step<2;step++){
   const old=expected,parts=[...old.matchAll(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)],target=parts[line],at=target.index!+target[0].indexOf('[')+1;
   expected=old.slice(0,at)+(old[at]===' '?'x':' ')+old.slice(at+1);
   f.parent.querySelector<HTMLInputElement>(`input[data-md-task-line="${line}"]`)!.click();await until(()=>f.raw()===expected);
   const changed=expected.split('').filter((c,i)=>c!==old[i]);expect(changed).toHaveLength(1);
   expect(f.raw().slice(0,at)).toBe(old.slice(0,at));expect(f.raw().slice(at+1)).toBe(old.slice(at+1));
   await until(()=>{const e=f.parent.querySelector<HTMLInputElement>(`input[data-md-task-line="${line}"]`);return!!e&&e.checked===(expected[at]!==' ');});
  }
  expect(f.raw().split('\r\n').slice(0,3)).toEqual(taskSource.split('\r\n').slice(0,3));expect(f.raw().replace(/\r\n/g,'')).not.toMatch(/[\r\n]/);
 });
 it('disables real widgets and preserves source in readonly mode',async()=>{const f=await mount(true);for(const e of f.parent.querySelectorAll<HTMLInputElement>('input[data-md-task-line]')){expect(e.disabled).toBe(true);e.click();}expect(f.raw()).toBe(taskSource);});
 it('passes authored Unicode/space destinations to original link and image hosts',async()=>{const f=await mount();for(const href of taskLinks){const a=f.parent.querySelector<HTMLAnchorElement>(`a[data-md-href="${href}"]`);expect(a).toBeTruthy();a!.click();expect(f.links).toHaveBeenLastCalledWith(href);}expect(f.images.mock.calls.some(args=>args[1]===taskImage)).toBe(true);expect(f.raw()).toBe(taskSource);});
});

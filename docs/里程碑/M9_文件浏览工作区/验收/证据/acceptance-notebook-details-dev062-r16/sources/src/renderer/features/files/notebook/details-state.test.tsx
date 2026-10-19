// @vitest-environment jsdom
import {render,cleanup,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NotebookModel} from './model';
import type {FileBuffer} from '../file-buffer';
let model:NotebookModel;
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}}}));
vi.mock('../resource',()=>({readFileResource:async()=>new Uint8Array(0)}));
vi.mock('./client',()=>({createNotebookClient:async()=>({ready:Promise.resolve(model.info),window:async(start:number,count:number,choices:unknown)=>model.window(start,count,choices as never),destroy:async()=>undefined}),notebookFrameSlots:{acquire:async()=>()=>{}},notebookImageSlots:{acquire:async()=>()=>{}}}));
import {FileNotebookPreview} from './preview';
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}});vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>setTimeout(()=>f(0),1));vi.stubGlobal('cancelAnimationFrame',(id:number)=>clearTimeout(id));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('Notebook native details UI state',()=>{
 it('preserves inner Code and Raw output expansion while outer collapse releases their DOM',async()=>{
  model=new NotebookModel(new TextEncoder().encode(JSON.stringify({metadata:{},cells:[{cell_type:'code',source:'print("kept source")',metadata:{codex:{descriptionMarkdown:'Description',outputSummaries:[{summaryMarkdown:'Output summary'}]}},outputs:[{output_type:'stream',text:'raw output kept'}]}]})),'details.ipynb');
  const buffer={notebookPosition:0,file:{name:'details.ipynb',revision:{size:1,hash:'a'.repeat(64)}}} as FileBuffer;
  const view=render(<FileNotebookPreview buffer={buffer}/>);await waitFor(()=>expect(view.container.querySelector('.fa-code-disclosure')).not.toBeNull());
  const outer=()=>view.container.querySelector<HTMLDetailsElement>('.fa-notebook-cell')!,inner=()=>view.container.querySelector<HTMLDetailsElement>('.fa-code-disclosure')!,raw=()=>view.container.querySelector<HTMLDetailsElement>('.fa-raw-output')!;
  expect(outer().open).toBe(true);expect(inner().open).toBe(false);fireEvent.click(inner().querySelector('summary')!);fireEvent.click(raw().querySelector('summary')!);await waitFor(()=>{expect(inner().open).toBe(true);expect(raw().open).toBe(true);});
  fireEvent.click(outer().querySelector('summary')!);await waitFor(()=>expect(view.container.querySelector('.fa-notebook-cell-body')).toBeNull());
  fireEvent.click(outer().querySelector('summary')!);await waitFor(()=>expect(inner()).not.toBeNull());expect(inner().open).toBe(true);expect(raw().open).toBe(true);expect(raw().textContent).toContain('raw output kept');
 });
});

// @vitest-environment jsdom
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, undoDepth } from '@codemirror/commands';
import { getChunks, getOriginalDoc } from '@codemirror/merge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSourceField } from './editor-source';
import { fileConflictDiffGuard, fileConflictOriginal, syncFileConflictDiff } from './conflict-diff';
const observed=vi.hoisted(()=>({calls:[] as {a:number;b:number}[]}));
// U only: observe real engine input sizes through the supported override. The
// original diff function/config/result is used, not a fabricated diff.
vi.mock('@codemirror/merge',async importOriginal=>{
 const real=await importOriginal<typeof import('@codemirror/merge')>();
 return{...real,unifiedMergeView:(config:Parameters<typeof real.unifiedMergeView>[0])=>real.unifiedMergeView({...config,diffConfig:{...config.diffConfig,override:(a,b)=>{observed.calls.push({a:a.length,b:b.length});return real.diff(a,b,{scanLimit:500,timeout:50});}}})};
});
const views:EditorView[]=[],errors:unknown[]=[];
beforeEach(()=>{observed.calls=[];errors.length=0;vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});});
afterEach(()=>{views.splice(0).forEach(v=>{const parent=v.dom.parentElement;v.destroy();parent?.remove();});vi.unstubAllGlobals();expect(errors).toEqual([]);});
function fixture(raw:string){const source=createSourceField(raw),slot=new Compartment(),parent=document.body.appendChild(document.createElement('div'));const view=new EditorView({parent,state:EditorState.create({doc:source.normalized,extensions:[source.extensions,history(),slot.of([]),fileConflictDiffGuard(slot,source),EditorView.exceptionSink.of(e=>errors.push(e))]})});views.push(view);return{view,source,slot,sync:(disk:string|null)=>syncFileConflictDiff(view,slot,disk,view.state.field(source.field).raw)};}
describe('H33 display-only merge and pre-transaction budget',()=>{
 it('compares D to L without replacing source/history/selection or adding decision buttons',()=>{
  const f=fixture('Local\r\nTail\r');f.view.dispatch({changes:{from:1,to:2,insert:'X'},selection:{anchor:1,head:2},userEvent:'input.type'});f.view.focus();
  const source=f.view.state.field(f.source.field),selection=f.view.state.selection,history=undoDepth(f.view.state);
  expect(f.sync('Disk\r\nTail\r').state).toBe('enabled');expect(getOriginalDoc(f.view.state).toString()).toBe('Disk\nTail\n');expect(getChunks(f.view.state)?.chunks.length).toBeGreaterThan(0);
  expect(f.view.state.field(f.source.field)).toBe(source);expect(f.view.state.selection.eq(selection)).toBe(true);expect(undoDepth(f.view.state)).toBe(history);expect(f.view.hasFocus).toBe(true);expect(f.view.dom.querySelector('.cm-chunkButtons')).toBeNull();
 });
 it('updates the actual readonly original field when a newer disk snapshot arrives',()=>{
  const f=fixture('LOCAL');f.sync('FIRST');const doc=f.view.state.doc;f.sync('SECOND\r\n');expect(getOriginalDoc(f.view.state).toString()).toBe('SECOND\n');expect(f.view.state.field(fileConflictOriginal)).toBe('SECOND\r\n');expect(f.view.state.doc).toBe(doc);
 });
 it.each(['units','lines'] as const)('%s exact boundary draws; growth removes diff before its field can invoke the engine; undo restores it',kind=>{
  const raw=kind==='units'?'L'+'a'.repeat(262143):'L\n'+'a\n'.repeat(4998)+'a',disk='D'+raw.slice(1),f=fixture(raw);expect(f.sync(disk).state).toBe('enabled');expect(observed.calls.length).toBeGreaterThan(0);const calls=observed.calls.length;
  f.view.dispatch({changes:{from:f.view.state.doc.length,insert:kind==='units'?'x':'\n'},userEvent:'input.type'});
  expect(f.view.state.field(fileConflictOriginal,false)).toBeUndefined();expect(observed.calls.length).toBe(calls);expect(f.sync(disk).state).toBe('too-large');expect(f.view.state.field(f.source.field).raw).toBe(raw+(kind==='units'?'x':'\n'));
  expect(undo(f.view)).toBe(true);expect(f.view.state.field(f.source.field).raw).toBe(raw);expect(f.sync(disk).state).toBe('enabled');expect(getChunks(f.view.state)?.chunks.length).toBeGreaterThan(0);
 });
 it('raw CRLF crossing is gated even when normalized source remains below the character limit',()=>{
  const raw='L'+'a'.repeat(262140)+'\r\n',f=fixture(raw);f.sync('D');const calls=observed.calls.length;
  f.view.dispatch({changes:{from:f.view.state.doc.length,insert:'\nx'}});expect(f.view.state.field(f.source.field).raw.length).toBe(262146);expect(f.view.state.doc.length).toBeLessThan(262145);expect(f.view.state.field(fileConflictOriginal,false)).toBeUndefined();expect(observed.calls.length).toBe(calls);
 });
 it('oversized disk removes a prior diff and source selection stays available',()=>{
  const f=fixture('LOCAL');f.sync('DISK');const before=observed.calls.length;expect(f.sync('x'.repeat(262145)).state).toBe('too-large');expect(observed.calls.length).toBe(before);expect(f.view.state.field(fileConflictOriginal,false)).toBeUndefined();f.view.dispatch({selection:{anchor:0,head:5}});expect(f.view.state.sliceDoc(0,5)).toBe('LOCAL');
 });
 it('closing comparison removes display state without adopting the disk source',()=>{
  const f=fixture('LOCAL');f.sync('DISK');f.sync(null);expect(f.view.state.field(fileConflictOriginal,false)).toBeUndefined();expect(f.view.state.field(f.source.field).raw).toBe('LOCAL');
 });
});

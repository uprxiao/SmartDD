// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSourceView } from './source-view';
vi.mock('./code/editor',()=>({codeHighlight:()=>[]}));
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const current=()=>EditorView.findFromDOM(document.querySelector('.cm-editor')as HTMLElement)!;
describe('H33 full source fallback and synthetic host',()=>{
 it('keeps complete oversized disk source readonly and keyboard-selectable',()=>{
  const raw='Disk\r\n'+'x'.repeat(300000)+'\rTail\n';render(<FileSourceView text={raw} readOnly label="磁盘版本 内容"/>);
  const view=current(),content=screen.getByLabelText('磁盘版本 内容');expect(view.state.doc.toString()).toBe(raw.replace(/\r\n?/g,'\n'));expect(view.state.readOnly).toBe(true);expect(content.getAttribute('contenteditable')).toBe('false');
  act(()=>view.focus());fireEvent.keyDown(content,{key:'a',code:'KeyA',ctrlKey:true});expect(view.state.selection.main.from).toBe(0);expect(view.state.selection.main.to).toBe(view.state.doc.length);expect(view.state.doc.toString().endsWith('\nTail\n')).toBe(true);
 });
 it('keeps the same editor/history after a synthetic host reflects its actual raw edit',()=>{
  const edited=vi.fn(),mounted=render(<FileSourceView text={'Local\r\n'} original={'Disk\r\n'} readOnly={false} label="文件编辑器" filename="file.ts" onEdit={edited}/>),view=current();
  act(()=>view.dispatch({changes:{from:0,to:1,insert:'X'},userEvent:'input.type'}));expect(edited).toHaveBeenLastCalledWith('Xocal\r\n');const doc=view.state.doc,depth=undoDepth(view.state);
  mounted.rerender(<FileSourceView text={'Xocal\r\n'} original={'New disk\r\n'} readOnly={false} label="文件编辑器" filename="file.ts" onEdit={edited}/>);
  expect(current()).toBe(view);expect(view.state.doc).toBe(doc);expect(undoDepth(view.state)).toBe(depth);expect(view.state.readOnly).toBe(false);
 });
});

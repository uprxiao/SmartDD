// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PptxImagePlacement } from './pptx-image-placement';

beforeAll(() => {
  class Pointer extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  }
  vi.stubGlobal('PointerEvent', Pointer);
});
afterEach(() => cleanup());
it('reports text-box click autosize and drag-fixed placement while preserving the image callback contract',()=>{
 const commit=vi.fn();render(<PptxImagePlacement width={720} height={405} purpose="text" onCommit={commit} onCancel={()=>{}}/>);
 const area=screen.getByRole('region',{name:'放置文本框'});vi.spyOn(area,'getBoundingClientRect').mockReturnValue({left:100,top:50,width:1440,height:810,right:1540,bottom:860,x:100,y:50,toJSON(){}});
 fireEvent.pointerDown(area,{button:0,pointerId:2,clientX:300,clientY:150});fireEvent.pointerUp(area,{pointerId:2,clientX:300,clientY:150});expect(commit).toHaveBeenCalledExactlyOnceWith({x:100,y:50,width:112,height:56},true);
 cleanup();const drag=vi.fn();render(<PptxImagePlacement width={720} height={405} purpose="text" onCommit={drag} onCancel={()=>{}}/>);const next=screen.getByRole('region',{name:'放置文本框'});vi.spyOn(next,'getBoundingClientRect').mockReturnValue({left:100,top:50,width:1440,height:810,right:1540,bottom:860,x:100,y:50,toJSON(){}});
 fireEvent.pointerDown(next,{button:0,pointerId:3,clientX:800,clientY:450});fireEvent.pointerUp(next,{pointerId:3,clientX:300,clientY:150});expect(drag).toHaveBeenCalledExactlyOnceWith({x:100,y:50,width:250,height:150},false);
});
const open = () => {
  const commit = vi.fn(), cancel = vi.fn();
  render(<PptxImagePlacement width={720} height={405} onCommit={commit} onCancel={cancel} />);
  const area = screen.getByRole('region', { name: '放置图片占位' });
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 1440, height: 810, right: 1540, bottom: 860, x: 100, y: 50, toJSON() {} });
  return { area, commit, cancel };
};
it('uses the live page rectangle to convert a drag into actual slide coordinates and commits once', () => {
  const f = open();
  fireEvent.pointerDown(f.area, { button: 0, pointerId: 2, clientX: 300, clientY: 150 });
  fireEvent.pointerMove(f.area, { pointerId: 2, clientX: 800, clientY: 450 });
  fireEvent.pointerUp(f.area, { pointerId: 2, clientX: 800, clientY: 450 });
  fireEvent.pointerUp(f.area, { pointerId: 2, clientX: 800, clientY: 450 });
  expect(f.commit).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 50, width: 250, height: 150 });
});
it('bounds reverse drags to the slide and ignores a different pointer', () => {
  const f = open();
  fireEvent.pointerDown(f.area, { button: 0, pointerId: 3, clientX: 300, clientY: 150 });
  fireEvent.pointerUp(f.area, { pointerId: 4, clientX: 800, clientY: 450 });
  expect(f.commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(f.area, { pointerId: 3, clientX: -100, clientY: -100 });
  expect(f.commit).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 0, width: 100, height: 50 });
});
it('cancels pointer capture without creating a picture, and Escape only cancels', () => {
  const f = open();
  fireEvent.pointerDown(f.area, { button: 0, pointerId: 3, clientX: 300, clientY: 150 });
  fireEvent.pointerCancel(f.area, { pointerId: 3 });
  fireEvent.pointerUp(f.area, { pointerId: 3, clientX: 800, clientY: 450 });
  fireEvent.keyDown(f.area, { key: 'Escape' });
  expect(f.commit).not.toHaveBeenCalled(); expect(f.cancel).toHaveBeenCalledOnce();
});
it('uses the reference 112×56 click size, bounded at edges, and offers keyboard placement', () => {
  const f = open();
  fireEvent.pointerDown(f.area, { button: 0, pointerId: 2, clientX: 1600, clientY: 900 });
  fireEvent.pointerUp(f.area, { pointerId: 2, clientX: 1600, clientY: 900 });
  expect(f.commit).toHaveBeenCalledExactlyOnceWith({ x: 608, y: 349, width: 112, height: 56 });
  cleanup(); const g = open(); fireEvent.keyDown(g.area, { key: 'Enter' });
  expect(g.commit).toHaveBeenCalledExactlyOnceWith({ x: 304, y: 174.5, width: 112, height: 56 });
});

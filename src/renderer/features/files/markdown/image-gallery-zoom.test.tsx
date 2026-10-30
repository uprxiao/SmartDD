// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ImageGallery} from '../../../../../prototypes/m6-codex/src/ImageGallery.jsx';

let resized: () => void;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {cleanup();vi.unstubAllGlobals();});

const scale = () => Number(/scale\(([^)]+)\)/.exec(document.querySelector<HTMLImageElement>('.fw-gallery img')!.style.transform)![1]);
function gallery(width: number, height: number) {
  const picture = {id:1,alt:'Owned fixture',src:'data:image/png;base64,fixture'};
  render(<ImageGallery initial={{picture,pictures:[picture]}} overlay={false} download={false} onClose={() => {}} onDownload={() => {}} />);
  const viewport = document.querySelector('.fw-gallery-viewport')!, image = document.querySelector('.fw-gallery img')!;
  Object.defineProperties(viewport,{clientWidth:{configurable:true,value:1000},clientHeight:{configurable:true,value:700}});
  Object.defineProperties(image,{naturalWidth:{value:width},naturalHeight:{value:height}});
  fireEvent.load(image);
  return {viewport,image};
}

it.each([[40,30,1],[4000,800,.234],[100000,10000,.01]])('V12 disables both real step endpoints with %sx%s image and fit %s', (width,height,fit) => {
  // Decoder/viewport geometry is controlled here; real decoding and trusted
  // pointer actions are covered separately in the packaged-App matrix.
  gallery(width,height);
  const minus = screen.getByRole('button',{name:'缩小图片'}), plus = screen.getByRole('button',{name:'放大图片'});
  expect(scale()).toBeCloseTo(fit,8);
  const values = [...new Set([.25,.33,.5,.67,.75,.8,.9,1,1.1,1.25,1.5,1.75,2,2.5,3,4,5,fit])].sort((a,b)=>a-b);
  for (const value of values.filter(value=>value>fit)) {fireEvent.click(plus);expect(scale()).toBeCloseTo(value,8);}
  expect(plus.hasAttribute('disabled')).toBe(true);
  for (const value of values.slice(0,-1).reverse()) {fireEvent.click(minus);expect(scale()).toBeCloseTo(value,8);}
  expect(minus.hasAttribute('disabled')).toBe(true);
  fireEvent.click(minus);expect(scale()).toBeCloseTo(Math.min(.25,fit),8);
});

it('V12 recalculates fit and clears zoom when the actual viewport observer fires', () => {
  const {viewport} = gallery(4000,800);
  fireEvent.click(screen.getByRole('button',{name:'放大图片'}));expect(scale()).toBe(.25);
  Object.defineProperty(viewport,'clientWidth',{value:600});
  act(() => resized());
  expect(scale()).toBeCloseTo(.134,8);
  expect(document.querySelector<HTMLImageElement>('.fw-gallery img')!.style.transform).toContain('translate(0px, 0px)');
});

// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error Shared approved prototype is JavaScript.
import { FilePdfPreview } from '@root/prototypes/m6-codex/src/FilePdfPreview.jsx';
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('wires the same actual wheel lifecycle into the prototype and resets it on a new path', () => {
  const changed=vi.fn(), fixture={pdfSource:'synthetic'}, renderView=(path: string)=><FilePdfPreview kind="pdf" path={path} hostOptions={fixture} onStateChange={changed} />;
  const f=render(renderView('A.pdf')), node=f.container.querySelector('.fa-pdf-scroll') as HTMLElement;
  expect(node).toBeTruthy(); node.scrollLeft=50; node.scrollTop=200;
  const wheel=(deltaY: number)=>act(()=>node.dispatchEvent(new WheelEvent('wheel',{deltaY,ctrlKey:true,cancelable:true,clientX:100,clientY:100})));
  wheel(-3); act(()=>vi.advanceTimersByTime(119)); expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('true');
  act(()=>vi.advanceTimersByTime(1)); expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('false');
  act(()=>vi.advanceTimersByTime(79)); wheel(-3); expect(changed.mock.calls.at(-1)?.[0].zoom).toBeCloseTo(100*Math.exp(.03),8);
  wheel(-20); f.rerender(renderView('B.pdf')); const left=node.scrollLeft;
  act(()=>vi.advanceTimersByTime(300)); expect(node.scrollLeft).toBe(left); expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('false');
  wheel(-20); const end=node.scrollLeft; f.unmount(); act(()=>vi.advanceTimersByTime(300)); expect(node.scrollLeft).toBe(end); expect(vi.getTimerCount()).toBe(0);
});

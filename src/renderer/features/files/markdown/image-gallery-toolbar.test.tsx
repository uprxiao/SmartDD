// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ImageGallery } from '../../../../../prototypes/m6-codex/src/ImageGallery.jsx';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('keeps keyboard focus inside the gallery when downloading disables its button',async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  let rejectDownload:(error:Error)=>void=()=>{};
  const pending=new Promise<void>((_,reject)=>{rejectDownload=reject;}),close=vi.fn();
  const picture={id:'focus',src:'data:image/png;base64,A',alt:'Focus original'};
  render(<ImageGallery initial={{picture,pictures:[picture]}} overlay={false} download onDownload={()=>pending} onClose={close}/>);
  const button=screen.getByRole('button',{name:'下载'});button.focus();fireEvent.click(button);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('.fw-gallery-viewport'));
  await act(async()=>{rejectDownload(Error('Declared download refusal'));await pending.catch(()=>{});});
  expect(screen.getByRole('alert').textContent).toContain('Declared download refusal');
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(close).toHaveBeenCalledTimes(1);
});
it('V11 direct legacy toolbar downloads the current picture, bounds navigation and keeps a single picture non-navigable without editing controls',()=>{
  // Decoder/geometry isolated here; P/A exercise actual encoded image bytes.
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const a={id:'a',name:'a.png',alt:'Original A',src:'data:image/png;base64,A'},b={id:'b',name:'b.png',alt:'Original B',src:'data:image/png;base64,B'},download=vi.fn(),close=vi.fn();
  const view=render(<ImageGallery key="multi" initial={{picture:a,pictures:[a,b]}} overlay={false} download onDownload={download} onClose={close}/>);
  expect(document.querySelector('.fw-gallery-legacy')).not.toBeNull();expect(document.querySelector('.fw-gallery-overlay')).toBeNull();expect(screen.queryByRole('button',{name:/编辑|旋转|裁剪/})).toBeNull();
  expect(screen.queryByLabelText('上一张图片')).toBeNull();fireEvent.click(screen.getByLabelText('下一张图片'));expect(screen.getByText('Original B')).toBeTruthy();expect(screen.queryByLabelText('下一张图片')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'下载'}));expect(download).toHaveBeenLastCalledWith(b);fireEvent.click(screen.getByLabelText('上一张图片'));fireEvent.click(screen.getByRole('button',{name:'下载'}));expect(download).toHaveBeenLastCalledWith(a);
  view.rerender(<ImageGallery key="single" initial={{picture:a,pictures:[a]}} overlay={false} download onDownload={download} onClose={close}/>);
  for(const label of['上一张图片','下一张图片'])expect(screen.queryByLabelText(label)).toBeNull();expect(screen.getByText('Original A')).toBeTruthy();
  expect(screen.getByLabelText('缩小图片')).toBeTruthy();expect(screen.getByLabelText('放大图片')).toBeTruthy();expect(screen.getByLabelText('重置图片适应缩放').textContent).toMatch(/\d+%/);fireEvent.click(screen.getByRole('button',{name:'下载'}));expect(download).toHaveBeenLastCalledWith(a);fireEvent.click(screen.getByLabelText('关闭图片预览'));expect(close).toHaveBeenCalledTimes(1);
});

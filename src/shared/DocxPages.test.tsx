// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { DocxPages } from './DocxPages';

// Original project-authored F19 revision fixture, unchanged. Its final page
// starts with a page break and text in the same OOXML run.
const bytes = new Uint8Array(readFileSync(resolve('src/shared/__fixtures__/docx-inline-page-break.docx')));
const sourceHash = 'ece3143674d7127278b5289b1ca1051f6b7f8348cc2fb6ae9195404b5f15b859';
const hash = () => createHash('sha256').update(bytes).digest('hex');

beforeEach(() => {
  expect(hash()).toBe(sourceHash);
  // jsdom does not load srcdoc or implement layout. Parse/render is real;
  // these tests claim document content and variant isolation, not geometry.
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); expect(hash()).toBe(sourceHash); });

it.each([false, true])('preserves inline-break content in independent clean/tracked renders (toggle=%s)', async (redlinesEnabled) => {
  const errors = vi.fn();
  render(createElement(DocxPages, { bytes, hasRevisions: true, redlinesEnabled, onError: errors }));
  const frame = screen.getByTitle('DOCX 只读正文') as HTMLIFrameElement;
  fireEvent.load(frame);
  await waitFor(() => expect(document.querySelector('.docx-preview')?.getAttribute('data-pages')).toBe('2'), { timeout: 3500 });
  const variants = [...frame.contentDocument!.body.children];
  expect(variants).toHaveLength(2);
  for (const variant of variants) {
    const pages = variant.querySelectorAll('section.docx');
    expect(pages).toHaveLength(2);
    expect(pages[1].textContent).toContain('J11 SECOND PAGE ORIGINAL');
    expect(variant.textContent).toContain('J11 HEADER ORIGINAL');
    expect(variant.textContent).toContain('J11 FOOTER ORIGINAL');
    expect(variant.querySelectorAll('table td')).toHaveLength(4);
  }
  expect(variants[0].querySelector('del')).toBeNull();
  expect(variants[1].querySelectorAll('del')).toHaveLength(1);
  if (redlinesEnabled) {
    fireEvent.click(screen.getByRole('button', { name: 'Hide redlines' }));
    expect(variants[0].hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('.docx-preview')?.getAttribute('data-pages')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Show redlines' }));
    expect(variants[1].hasAttribute('hidden')).toBe(false);
    expect(variants[1].textContent).toContain('J11 SECOND PAGE ORIGINAL');
  } else {
    expect(screen.queryByRole('button', { name: 'Hide redlines' })).toBeNull();
    expect(variants[1].hasAttribute('hidden')).toBe(false);
  }
  expect(errors).not.toHaveBeenCalled();
});

it.each([
  {hasRevisions:false,redlinesEnabled:false},
  {hasRevisions:false,redlinesEnabled:true},
  {hasRevisions:true,redlinesEnabled:false},
  {hasRevisions:true,redlinesEnabled:true},
])('gates the redlines control independently from content: %j',async({hasRevisions,redlinesEnabled})=>{
  const fixture=hasRevisions?'three-page-tracked.docx':'three-page-clean.docx';
  const original=new Uint8Array(readFileSync(resolve('prototypes/m6-codex/public/assets/m9-docx',fixture)));
  const before=createHash('sha256').update(original).digest('hex');
  render(createElement(DocxPages,{bytes:original,hasRevisions,redlinesEnabled}));
  const frame=screen.getByTitle('DOCX 只读正文') as HTMLIFrameElement;fireEvent.load(frame);
  await waitFor(()=>expect(document.querySelector('.docx-preview')?.getAttribute('data-pages')).toBe('3'),{timeout:3500});
  const [clean,tracked]=[...frame.contentDocument!.body.children];
  expect(clean.hasAttribute('hidden')).toBe(hasRevisions);expect(tracked.hasAttribute('hidden')).toBe(!hasRevisions);
  const toggle=screen.queryByRole('button',{name:'Hide redlines'});
  expect(Boolean(toggle)).toBe(hasRevisions&&redlinesEnabled);
  if(toggle){expect(toggle.getAttribute('aria-pressed')).toBe('true');fireEvent.click(toggle);expect(clean.hasAttribute('hidden')).toBe(false);expect(screen.getByRole('button',{name:'Show redlines'}).getAttribute('aria-pressed')).toBe('false');}
  expect(createHash('sha256').update(original).digest('hex')).toBe(before);
});

it('protects an unfinished comment, then clears only the selection and preserves the scroll on a permitted view toggle',async()=>{
  const selected=vi.fn();
  const {rerender}=render(createElement(DocxPages,{bytes,hasRevisions:true,redlinesEnabled:true,commentDraft:'unfinished instruction',onSelectionChange:selected}));
  const frame=screen.getByTitle('DOCX 只读正文') as HTMLIFrameElement;fireEvent.load(frame);
  await waitFor(()=>expect(document.querySelector('.docx-preview')?.getAttribute('data-pages')).toBe('2'),{timeout:3500});
  const [clean,tracked]=[...frame.contentDocument!.body.children];
  const text=tracked.querySelector('p')!.firstChild!;const range=frame.contentDocument!.createRange();range.selectNodeContents(text);
  const selection=frame.contentDocument!.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  const priorText=selection.toString();expect(priorText.length).toBeGreaterThan(0);
  const scroll=screen.getByLabelText('DOCX 页面内容');scroll.scrollTop=317;
  fireEvent.click(screen.getByRole('button',{name:'Hide redlines'}));
  expect(screen.getByText('请先处理评论草稿。')).toBeTruthy();expect(tracked.hasAttribute('hidden')).toBe(false);expect(selection.toString()).toBe(priorText);expect(selected).not.toHaveBeenCalled();expect(scroll.scrollTop).toBe(317);
  rerender(createElement(DocxPages,{bytes,hasRevisions:true,redlinesEnabled:true,commentDraft:'',onSelectionChange:selected}));
  fireEvent.click(screen.getByRole('button',{name:'Hide redlines'}));
  expect(clean.hasAttribute('hidden')).toBe(false);expect(selection.rangeCount).toBe(0);expect(selected).toHaveBeenLastCalledWith(null);expect(scroll.scrollTop).toBe(317);expect(hash()).toBe(sourceHash);
});

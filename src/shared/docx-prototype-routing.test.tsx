// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
// @ts-expect-error The shared prototype producer is JavaScript.
import { FileOfficePreview } from '../../prototypes/m6-codex/src/FileOfficePreview';

// Test the real producer and shared route predicate. Decoder/iframe layout is
// covered separately; this seam only identifies which actual branch mounts.
vi.mock('./DocxPages', () => ({ DocxPages: ({ onRequestEdits }: { onRequestEdits?: () => void }) =>
  <div data-testid="routing-legacy-body">Legacy document{onRequestEdits && <button onClick={onRequestEdits}>Request edits</button>}</div> }));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const name = url.split('/').pop()!;
    const bytes = readFileSync(resolve('prototypes/m6-codex/public/assets/m9-docx', name));
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(hostOptions = {}) {
  render(<FileOfficePreview kind="docx" hostOptions={hostOptions} />);
  fireEvent.click(screen.getByText('Office 原型场景 · 合成数据'));
}

const route = () => document.querySelector('.fo-workspace')?.getAttribute('data-docx-route');
const documentFlag = () => screen.getByRole('checkbox', { name: '文档宿主能力（原型）' }) as HTMLInputElement;
const renderFlag = () => screen.getByRole('checkbox', { name: '排版能力（原型）' }) as HTMLInputElement;
const source = () => screen.getByRole('radiogroup', { name: 'DOCX 来源场景（原型）' }).querySelector<HTMLInputElement>('input:checked')!;
const chooseSource = (value: string) => fireEvent.click(screen.getByRole('radiogroup', { name: 'DOCX 来源场景（原型）' }).querySelector<HTMLInputElement>(`input[value="${value}"]`)!);
function setFlags(document: boolean, rendering: boolean) {
  if (documentFlag().checked !== document) fireEvent.click(documentFlag());
  if (renderFlag().checked !== rendering) fireEvent.click(renderFlag());
}

it('uses independent explicit capabilities instead of the previous route preset', async () => {
  mount({ docxRoute: 'popcorn', documentHostFlag: false, renderFlag: true });
  expect(route()).toBe('legacy');
  expect(documentFlag().checked).toBe(false);
  expect(renderFlag().checked).toBe(true);
  await screen.findByTestId('routing-legacy-body');
});

it('routes all four ordinary-file flag combinations through the actual controls', async () => {
  mount();
  for (const [document, rendering, expected] of [[false, false, 'legacy'], [false, true, 'legacy'], [true, false, 'legacy'], [true, true, 'popcorn']] as const) {
    setFlags(document, rendering);
    expect(route()).toBe(expected);
    expect(source().value).toBe('file');
    if (expected === 'legacy') await screen.findByTestId('routing-legacy-body');
    else expect(screen.queryByTestId('routing-legacy-body')).toBeNull();
  }
});

it.each(['attachment', 'durable'])('keeps %s on the legacy route for every flag combination', async (kind) => {
  mount();
  chooseSource(kind);
  for (const [document, rendering] of [[false, false], [false, true], [true, false], [true, true]]) {
    setFlags(document, rendering);
    expect(source().value).toBe(kind);
    expect(route()).toBe('legacy');
    await screen.findByTestId('routing-legacy-body');
  }
});

it('keeps the previous route example as a visible preset for the real flags and source', () => {
  mount();
  chooseSource('attachment');
  fireEvent.change(screen.getByRole('combobox', { name: 'DOCX 查看路线' }), { target: { value: 'popcorn' } });
  expect(source().value).toBe('file');
  expect(documentFlag().checked).toBe(true);
  expect(renderFlag().checked).toBe(true);
  expect(route()).toBe('popcorn');
});

it('protects an unfinished comment across both capability and source changes', async () => {
  mount({ docxRoute: 'legacy', annotationsEnabled: true });
  await screen.findByTestId('routing-legacy-body');
  fireEvent.click(screen.getByRole('button', { name: 'Request edits' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Office 评论草稿' }), { target: { value: 'G181 未提交评论' } });
  fireEvent.click(documentFlag());
  chooseSource('attachment');
  await waitFor(() => expect(documentFlag().checked).toBe(false));
  expect(source().value).toBe('file');
  expect(route()).toBe('legacy');
  expect((screen.getByRole('textbox', { name: 'Office 评论草稿' }) as HTMLTextAreaElement).value).toBe('G181 未提交评论');
  expect(screen.getByText('请先处理评论草稿。')).toBeTruthy();
});

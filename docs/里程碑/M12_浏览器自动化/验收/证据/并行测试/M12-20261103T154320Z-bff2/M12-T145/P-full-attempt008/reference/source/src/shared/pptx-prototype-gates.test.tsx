// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error The shared prototype producer is JavaScript.
import { FileOfficePreview } from '../../prototypes/m6-codex/src/FileOfficePreview';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(readOnly = false) {
  const draft = vi.fn(), state = vi.fn();
  render(<FileOfficePreview kind="pptx" readOnly={readOnly} onDraft={draft} onStateChange={state} />);
  fireEvent.click(screen.getByText('Office 原型场景 · 合成数据'));
  return { draft, latest: () => state.mock.calls.at(-1)![0] };
}

const checkbox = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const edit = () => screen.getByRole('button', { name: '编辑' }) as HTMLButtonElement;
const format = () => screen.queryByRole('button', { name: '格式' });

it.each(['PPTX 源字节（原型）', 'PPTX 读取能力（原型）', '可写来源', '库文件'])
('gates the actual edit controls independently through %s without changing the document', name => {
  const { draft, latest } = mount();
  expect(latest().canEdit).toBe(false);
  expect(format()).toBeNull();
  fireEvent.click(edit());
  expect(latest().canEdit).toBe(true);
  expect(format()).not.toBeNull();
  expect(screen.getByRole('button', { name: '文本' })).not.toBeNull();
  fireEvent.click(checkbox(name));
  expect(latest().canEdit).toBe(false);
  expect(edit().disabled).toBe(true);
  expect(format()).toBeNull();
  expect(screen.queryByRole('button', { name: '文本' })).toBeNull();
  expect(latest().dirty).toBe(false);
  expect(draft).not.toHaveBeenCalled();
  fireEvent.click(checkbox(name));
  expect(latest().canEdit).toBe(true);
  expect(format()).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '完成编辑' }));
  expect(latest().canEdit).toBe(false);
  expect(format()).toBeNull();
  expect(draft).not.toHaveBeenCalled();
});

it('keeps annotations independent from source write/edit capability', () => {
  const { draft, latest } = mount();
  fireEvent.click(checkbox('请求修改能力'));
  for (const name of ['PPTX 源字节（原型）', 'PPTX 读取能力（原型）', '可写来源', '库文件']) {
    fireEvent.click(checkbox(name));
    expect(latest().canEdit).toBe(false);
    expect(screen.getByRole('button', { name: '请求修改' })).not.toBeNull();
    fireEvent.click(checkbox(name));
  }
  expect(latest().dirty).toBe(false);
  expect(draft).not.toHaveBeenCalled();
});

it('closes template manual editing and annotations without pretending the source is unwritable', () => {
  const { latest } = mount();
  fireEvent.click(checkbox('请求修改能力'));
  fireEvent.click(edit());
  fireEvent.click(checkbox('模板'));
  expect(latest().canEdit).toBe(false);
  expect(edit().disabled).toBe(true);
  expect(format()).toBeNull();
  expect(screen.queryByRole('button', { name: '请求修改' })).toBeNull();
  fireEvent.click(checkbox('模板'));
  expect(latest().canEdit).toBe(true);
  expect(format()).not.toBeNull();
  expect(screen.getByRole('button', { name: '请求修改' })).not.toBeNull();
});

it('cannot unlock host read-only mode with synthetic capability controls', () => {
  const { draft, latest } = mount(true);
  expect(edit().disabled).toBe(true);
  for (const name of ['PPTX 源字节（原型）', 'PPTX 读取能力（原型）', '可写来源']) {
    fireEvent.click(checkbox(name));
    fireEvent.click(checkbox(name));
    expect(latest().canEdit).toBe(false);
    expect(edit().disabled).toBe(true);
    expect(format()).toBeNull();
  }
  expect(draft).not.toHaveBeenCalled();
});

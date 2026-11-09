// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// @ts-expect-error The shared prototype producer is JavaScript.
import { FileOfficePreview } from '../../prototypes/m6-codex/src/FileOfficePreview';

afterEach(() => cleanup());
const hostOptions = { sourceKind: 'local', sourceState: 'live', manualEditing: true, annotationsEnabled: false };
const begin = async () => {
  fireEvent.click(screen.getByRole('button', { name: '图片' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '生成图片' }));
  fireEvent.keyDown(await screen.findByRole('region', { name: '放置图片占位' }), { key: 'Enter' });
  return screen.findByRole('textbox', { name: '生成描述' });
};
it('stages a saved synthetic placeholder request independently of comment capability; only explicit insertion calls the terminal adapter', async () => {
  const insert = vi.fn(async () => ({ status: 'inserted' })), draft = vi.fn();
  render(<FileOfficePreview kind="pptx" path="public/generation.pptx" hostOptions={hostOptions} onDraft={draft} onInsertContext={insert} />);
  fireEvent.change(await begin(), { target: { value: '画出海边日出' } });
  expect((screen.getByRole('button', { name: '加入请求' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '保存占位示例' }));
  const document = JSON.parse(draft.mock.calls.at(-1)![0]), picture = document.slides[0].elements.at(-1);
  expect(picture).toMatchObject({ kind: 'image', isPlaceholder: true, x: 284, y: 197, width: 112, height: 56 });
  fireEvent.click(screen.getByRole('button', { name: '加入请求' }));
  expect(screen.queryByRole('textbox', { name: '生成描述' })).toBeNull(); expect(insert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '完成编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '插入上下文' }));
  await waitFor(() => expect(insert).toHaveBeenCalledOnce());
  expect(insert.mock.calls[0]).toEqual([expect.stringContaining('画出海边日出'), expect.objectContaining({ kind: 'pptx', elementId: picture.id })]);
});
it('keeps a stale description and requires an explicit new selection after selecting away and back', async () => {
  const insert = vi.fn(async () => ({ status: 'inserted' })), draft = vi.fn();
  render(<FileOfficePreview kind="pptx" hostOptions={hostOptions} onDraft={draft} onInsertContext={insert} />);
  fireEvent.change(await begin(), { target: { value: '保留这段描述' } });
  const document = JSON.parse(draft.mock.calls.at(-1)![0]), picture = document.slides[0].elements.at(-1), title = document.slides[0].elements[0];
  const titleNode = screen.getByLabelText(`text 对象 ${title.id}`), pictureNode = screen.getByLabelText(`image 对象 ${picture.id}`);
  // jsdom has no pointer capture. This test checks selection invalidation,
  // while actual pointer capture and geometry remain real-browser/App checks.
  Object.defineProperty(titleNode, 'setPointerCapture', { value: vi.fn(), configurable: true });
  Object.defineProperty(pictureNode, 'setPointerCapture', { value: vi.fn(), configurable: true });
  fireEvent.pointerDown(titleNode, { button: 0, pointerId: 1 });
  await screen.findByText('目标已改变，描述已保留。');
  fireEvent.pointerDown(pictureNode, { button: 0, pointerId: 1 });
  expect((screen.getByRole('button', { name: '加入请求' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('textbox', { name: '生成描述' }) as HTMLTextAreaElement).value).toBe('保留这段描述');
  fireEvent.click(screen.getByRole('button', { name: '重新选择目标' }));
  fireEvent.click(screen.getByRole('button', { name: '保存占位示例' }));
  fireEvent.click(screen.getByRole('button', { name: '加入请求' }));
  expect(screen.queryByRole('textbox', { name: '生成描述' })).toBeNull(); expect(insert).not.toHaveBeenCalled();
});
it('does not expose generation without the real context adapter, while ordinary image insertion remains available', () => {
  const draft = vi.fn(); render(<FileOfficePreview kind="pptx" hostOptions={hostOptions} onDraft={draft} />);
  fireEvent.click(screen.getByRole('button', { name: '图片' }));
  expect(screen.queryByRole('menuitem', { name: '生成图片' })).toBeNull();
  expect(screen.queryByRole('region', { name: '放置图片占位' })).toBeNull();
  expect(JSON.parse(draft.mock.calls.at(-1)![0]).slides[0].elements.at(-1)).toMatchObject({ kind: 'image' });
});

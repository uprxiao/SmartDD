// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileBuffer } from '../file-buffer';
import { CsvModel } from './model';
import { FileCsvPreview } from './preview';

const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./client', () => ({ createCsvClient: api.create }));
const clients: ReturnType<typeof client>[] = [];
function client(raw: string, delimiter: ',' | '\t') {
  const model = new CsvModel(raw, delimiter);
  return { ready: Promise.resolve(model.info), window: vi.fn(async (...args: Parameters<CsvModel['window']>) => model.window(...args)), cell: vi.fn(async (row: number, column: number, offset = 0) => model.cell(row, column, offset)), copyCell: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined) };
}
const buffer = (raw: string, name = 'fixture.csv', instance = 1) => ({ raw, instance, baseHash: `${instance}`, version: 0, file: { name } }) as unknown as FileBuffer;
beforeEach(() => {
  vi.clearAllMocks(); clients.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: () => void) {}
    observe(element: HTMLElement) { Object.defineProperties(element, { clientWidth: { configurable: true, value: 336 }, clientHeight: { configurable: true, value: 560 } }); this.callback(); }
    disconnect() {}
  });
  api.create.mockImplementation(async (raw, delimiter) => { const value = client(raw, delimiter); clients.push(value); return value; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CSV table interactions (worker boundary isolated)', () => {
  it('keeps formula/HTML/large numbers as readonly text and copies the selected complete field', async () => {
    render(<FileCsvPreview buffer={buffer('name,value\n00012345678901234567890,"<img src=x onerror=alert(1)>"\nformula,=SUM(A1:A2)')} />);
    await screen.findByText('00012345678901234567890');
    expect(document.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByText('=SUM(A1:A2)'));
    await waitFor(() => expect((screen.getByLabelText('单元格内容') as HTMLInputElement).value).toBe('=SUM(A1:A2)'));
    expect((screen.getByLabelText('单元格内容') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByLabelText('复制完整单元格内容'));
    expect(clients[0].copyCell).toHaveBeenCalledWith(2, 1);
  });
  it('reaches the last row and column with keyboard while bounding mounted cells', async () => {
    const raw = Array.from({ length: 1100 }, (_, row) => Array.from({ length: 40 }, (_, col) => `${row}:${col}`).join(',')).join('\n');
    render(<FileCsvPreview buffer={buffer(raw)} />); await screen.findByText('0:0');
    const grid = screen.getByRole('grid'); fireEvent.keyDown(grid, { key: 'End', ctrlKey: true });
    await waitFor(() => expect((screen.getByLabelText('单元格内容') as HTMLInputElement).value).toBe('1099:39'));
    await screen.findByText('1099:39'); expect(document.querySelectorAll('[role=gridcell]').length).toBeLessThanOrEqual(50 * 24);
    expect(grid.getAttribute('aria-activedescendant')).toBe('csv-1-1099-39');
    fireEvent.keyDown(grid, { key: 'Home', ctrlKey: true, isComposing: true });
    expect((screen.getByLabelText('单元格内容') as HTMLInputElement).value).toBe('1099:39');
    fireEvent.keyDown(grid, { key: 'Home', metaKey: true }); await screen.findByText('0:0');
    await waitFor(() => expect((screen.getByLabelText('单元格内容') as HTMLInputElement).value).toBe('0:0'));
  });
  it('uses TAB, reports long fields, and prevents stale windows from replacing a newly opened file', async () => {
    const long = '中'.repeat(9000), first = buffer(`first\t"${long}"`, 'one.tsv');
    const view = render(<FileCsvPreview buffer={first} />); await screen.findByText('first');
    expect(api.create.mock.calls[0][1]).toBe('\t');
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowRight' });
    await screen.findByText('单元格较长，此处显示前一部分；可复制完整内容或查看源码。');
    let resolve!: (value: ReturnType<CsvModel['window']>) => void;
    clients[0].window.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.scroll(screen.getByRole('grid'), { target: { scrollTop: 120 } });
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    view.rerender(<FileCsvPreview buffer={buffer('new,table', 'two.csv', 2)} />); await screen.findByText('new');
    await act(async () => resolve(new CsvModel('STALE', ',').window(0, 0, 1, 1)));
    expect(screen.queryByText('STALE')).toBeNull(); expect(clients[0].destroy).toHaveBeenCalled();
    expect((screen.getByLabelText('单元格内容') as HTMLInputElement).value).toBe('new');
  });
  it('shows parse failure and permits retry; empty input never manufactures a data row', async () => {
    api.create.mockRejectedValueOnce(new Error('表格格式无效：引号未闭合；请查看源码'));
    const view = render(<FileCsvPreview buffer={buffer('valid')} />);
    await screen.findByRole('alert'); expect(screen.queryByText('valid')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新解析' })); await screen.findByText('valid');
    view.rerender(<FileCsvPreview buffer={buffer('', 'empty.csv', 2)} />); await screen.findByText('空表格');
    expect(document.querySelectorAll('[role=gridcell]').length).toBe(0);
    expect((screen.getByLabelText('复制完整单元格内容') as HTMLButtonElement).disabled).toBe(true);
  });
});

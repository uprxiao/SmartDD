// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTreePathTooltip } from '../files/tree-path-tooltip';
import { useBrowserTabTooltip } from './tab-tooltip';
const api = vi.hoisted(() => ({ overlay: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { browser: api } }));
class Pointer extends MouseEvent {
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; }
}
const title = 'P075 超长网页标题 · ' + '完整标题检查 中文 '.repeat(18) + '结束';
const url = 'http://fixture.invalid/' + 'long-address-'.repeat(100);
function Fixture({ surfaceOpen = false, pageBlocked = false, model = 'page1' }) {
  const tip = useTreePathTooltip(model);
  const native = useBrowserTabTooltip({ taskId: 't1', tabId: model, tooltip: tip.target ? { target: tip.target, element: tip.element, dismiss: tip.dismiss } : null, pageBlocked, surfaceOpen });
  return <><button {...tip.bind(title + '\n' + url)}>tab</button>{native.element}<output data-testid="parking">{String(native.parked)}:{native.revision}</output>{native.image && <img alt="parked page" src={native.image} />}</>;
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('PointerEvent', Pointer); api.overlay.mockReset().mockResolvedValue(null); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const hover = () => fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'mouse' });
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
it('waits for 500ms and actual parking acknowledgement before showing the complete selectable title and URL', async () => {
  let capture!: (image: string) => void;
  api.overlay.mockImplementationOnce(() => new Promise(resolve => { capture = resolve; }));
  render(<Fixture />); hover(); await tick(499); expect(api.overlay).not.toHaveBeenCalled();
  await tick(1); expect(screen.queryByRole('tooltip')).toBeNull();
  const opened = api.overlay.mock.calls[0][0]; expect(opened).toMatchObject({ taskId: 't1', tabId: 'page1', open: true, owner: expect.stringMatching(/^tab-tooltip:/) });
  await act(async () => capture('data:image/jpeg;base64,cGFnZQ=='));
  expect(screen.getByRole('tooltip').textContent).toBe(title + '\n' + url);
  expect(screen.getByRole('button').getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  expect(screen.getByAltText('parked page').getAttribute('src')).toBe('data:image/jpeg;base64,cGFnZQ==');
  fireEvent.keyDown(window, { key: 'Escape' }); await tick(0);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(api.overlay).toHaveBeenLastCalledWith({ ...opened, open: false });
  expect(screen.getByTestId('parking').textContent).toBe('false:1');
});
it('cancels a late capture and never reopens a tooltip dismissed before parking completes', async () => {
  let capture!: (image: null) => void;
  api.overlay.mockImplementationOnce(() => new Promise(resolve => { capture = resolve; }));
  render(<Fixture />); hover(); await tick(500); fireEvent.keyDown(window, { key: 'Escape' }); await tick(0);
  await act(async () => capture(null)); expect(screen.queryByRole('tooltip')).toBeNull();
  expect(api.overlay.mock.calls.map(([input]) => input.open)).toEqual([true, false]);
});
it('gives a dialog priority and closes only its own hold, without acquiring a surface hold', async () => {
  const view = render(<Fixture />); hover(); await tick(500); expect(screen.getByRole('tooltip')).toBeTruthy();
  const owner = api.overlay.mock.calls[0][0].owner;
  view.rerender(<Fixture surfaceOpen />); await tick(0); expect(screen.queryByRole('tooltip')).toBeNull();
  expect(api.overlay).toHaveBeenLastCalledWith({ taskId: 't1', tabId: 'page1', open: false, owner });
  expect(api.overlay.mock.calls.every(([input]) => input.owner === owner)).toBe(true);
});
it('uses no native parking for a startup/error surface, and dismisses stale title on page change or window blur', async () => {
  const view = render(<Fixture pageBlocked />); hover(); await tick(500); expect(screen.getByRole('tooltip')).toBeTruthy(); expect(api.overlay).not.toHaveBeenCalled();
  view.rerender(<Fixture pageBlocked model="page2" />); expect(screen.queryByRole('tooltip')).toBeNull();
  hover(); await tick(500); fireEvent.blur(window); expect(screen.queryByRole('tooltip')).toBeNull();
});
it('does not reopen from an obsolete acknowledgement after switching tabs', async () => {
  let capture!: (image: null) => void;
  api.overlay.mockImplementationOnce(() => new Promise(resolve => { capture = resolve; }));
  const view = render(<Fixture />); hover(); await tick(500); view.rerender(<Fixture model="page2" />); await tick(0);
  await act(async () => capture(null)); expect(screen.queryByRole('tooltip')).toBeNull();
  expect(api.overlay).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: 'page1', open: false }));
});

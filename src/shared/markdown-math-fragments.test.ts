import { expect, it, vi } from 'vitest';
import { createMarkdownMathFragments } from './markdown-math-fragments.mjs';
import type { MarkdownMathResult, MarkdownMathSession } from './markdown-math-session.mjs';

it('DEV116 coalesces 100 sibling DOM owners without changing engine results or increasing the 60-request limit', async () => {
  const renderGroup = vi.fn<MarkdownMathSession['renderGroup']>(async formulas => ({ html: formulas.map(value => '<b>' + value.source + '</b>'), nodes: 100, units: 300, overflow: false }));
  const session = createMarkdownMathFragments({ renderGroup, dispose() {} });
  const controllers = Array.from({ length: 100 }, () => new AbortController());
  const pending = controllers.map((controller, index) => session.renderGroup([{ source: String(index), displayMode: false }], { signal: controller.signal, baseNodes: 2, baseUnits: 4 }));
  expect((await Promise.all(pending)).map(value => value.html[0])).toEqual(controllers.map((_, index) => '<b>' + index + '</b>'));
  expect(renderGroup).toHaveBeenCalledOnce(); expect(renderGroup.mock.calls[0][1]).toMatchObject({ baseNodes: 200, baseUnits: 400 });
  for (const controller of controllers.slice(0, -1)) controller.abort();
  expect(renderGroup.mock.calls[0][1].signal.aborted).toBe(false);
  controllers.at(-1)!.abort(); expect(renderGroup.mock.calls[0][1].signal.aborted).toBe(true);
});
it('DEV116 excludes a fragment cancelled before the batch, and ignores a cancelled original late result', async () => {
  let release!: (result: MarkdownMathResult) => void;
  const renderGroup = vi.fn<MarkdownMathSession['renderGroup']>(() => new Promise(resolve => { release = resolve; }));
  const session = createMarkdownMathFragments({ renderGroup, dispose() {} });
  const a = new AbortController(), b = new AbortController(), c = new AbortController();
  const first = session.renderGroup([{ source: 'a', displayMode: false }], { signal: a.signal }); const firstFailed = expect(first).rejects.toMatchObject({ name: 'AbortError' }); a.abort();
  const second = session.renderGroup([{ source: 'b', displayMode: false }], { signal: b.signal }), secondFailed = expect(second).rejects.toMatchObject({ name: 'AbortError' });
  const third = session.renderGroup([{ source: 'c', displayMode: true }], { signal: c.signal });
  await Promise.resolve(); expect(renderGroup.mock.calls[0][0].map(value => value.source)).toEqual(['b', 'c']); b.abort();
  release({ html: ['B', 'C'], nodes: 2, units: 2, overflow: false }); await firstFailed; await secondFailed; expect((await third).html).toEqual(['C']); c.abort();
});
it('DEV116 forwards overflow and failures from the original engine to live fragments', async () => {
  const original = new Error('native failure');
  const renderGroup = vi.fn<MarkdownMathSession['renderGroup']>().mockResolvedValueOnce({ html: [], nodes: 1001, units: 0, overflow: true }).mockRejectedValueOnce(original);
  const session = createMarkdownMathFragments({ renderGroup, dispose() {} }), a = new AbortController(), b = new AbortController();
  expect(await session.renderGroup([{ source: 'a', displayMode: false }], { signal: a.signal })).toMatchObject({ overflow: true, html: [] }); a.abort();
  await expect(session.renderGroup([{ source: 'b', displayMode: false }], { signal: b.signal })).rejects.toBe(original); b.abort();
});
it('DEV116 disposal cancels queued and active owners without disposing the editor engine', async () => {
  const renderGroup = vi.fn<MarkdownMathSession['renderGroup']>(() => new Promise(() => {})), dispose = vi.fn();
  const session = createMarkdownMathFragments({ renderGroup, dispose }), a = new AbortController(), b = new AbortController();
  const first = session.renderGroup([{ source: 'a', displayMode: false }], { signal: a.signal }), failedA = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); const second = session.renderGroup([{ source: 'b', displayMode: false }], { signal: b.signal }), failedB = expect(second).rejects.toMatchObject({ name: 'AbortError' });
  session.dispose(); session.dispose(); await failedA; await failedB; expect(renderGroup).toHaveBeenCalledOnce(); expect(renderGroup.mock.calls[0][1].signal.aborted).toBe(true); expect(dispose).not.toHaveBeenCalled();
  await expect(session.renderGroup([], { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' });
});

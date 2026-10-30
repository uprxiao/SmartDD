// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { useEffect, useSyncExternalStore } from 'react';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot } from '@shared/files';
import type { LspQuery } from '@shared/file-lsp';
import type { FileClient } from '../file-buffer';
import { FileWorkspaceStore } from '../workspace-store';
import { FileTextEditor } from '../text-editor';
import { FileLanguageProvider, LanguageResults, useFileLanguage } from './components';
import { LanguageHover } from './model';
import type { LanguageWorkspace } from './workspace';
const api = vi.hoisted(() => ({ languageOpen: vi.fn(), languageChange: vi.fn(), languageQuery: vi.fn(), languageCancel: vi.fn(), languageClose: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api }, events: { on: () => () => undefined } }));
vi.mock('../code/editor', () => ({ codeHighlight: () => [] }));
vi.mock('../markdown/editor', () => ({ markdownEditor: () => [] }));
const stores: FileWorkspaceStore[] = [];
const text = 'const alpha = "🙂";\r\nalpha();\r\n';
const root: FileRoot = { lease: randomUUID(), generation: 1, source: 'project-directory', sourceId: 'root', path: '/fixture', canonicalPath: '/fixture', label: 'Fixture', identity: { device: '1', inode: '2' } };
const location = (name = 'B.ts') => ({ relativePath: name, displayPath: `/fixture/${name}`, outsideRoot: false, range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } } });
function Content({ store, found }: { store: FileWorkspaceStore; found: (value: LanguageWorkspace) => void }) {
  useSyncExternalStore(store.subscribe, store.snapshot); const language = useFileLanguage(); useEffect(() => { if (language) found(language); }, [language]);
  return <><LanguageResults/>{store.active?.buffer?.editor && <FileTextEditor key={store.active.buffer.instance} buffer={store.active.buffer} wrap={false}/>}</>;
}
async function fixture() {
  const documents = new Map<string, FileDocument>();
  const fileApi = { roots: vi.fn(async () => ({ roots: [root], unavailable: [] })), list: vi.fn(async () => []), open: vi.fn(async ({ relativePath }: { relativePath: string }) => {
    const file: FileDocument = { ref: { id: randomUUID(), lease: root.lease, generation: 1 }, name: relativePath, documentKey: relativePath, relativePath, absolutePath: `/fixture/${relativePath}`, writable: true, revision: { device: '1', inode: relativePath, hash: 'a'.repeat(64), size: text.length, modifiedNs: '1', changedNs: '1' } }; documents.set(file.ref.id, file); return file;
  }), read: vi.fn(async (ref: { id: string }) => ({ document: documents.get(ref.id)!, base64: Buffer.from(text).toString('base64') })), refresh: vi.fn(async (ref: { id: string }) => documents.get(ref.id)!), drafts: vi.fn(async () => []), closeDocument: vi.fn(async () => undefined), closeScope: vi.fn(async () => undefined) };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'fixture' }, fileApi as unknown as FileClient, null, null); stores.push(store); await store.initialize(); await store.open(root, 'A.ts', true); let language!: LanguageWorkspace;
  await act(async () => { render(<FileLanguageProvider workspace={store}><Content store={store} found={value => { language = value; }}/></FileLanguageProvider>); });
  return { store, language, fileApi, view: () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)! };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
  api.languageOpen.mockImplementation(async input => ({ state: 'ready', id: input.id, server: 'Protocol fixture 1', positionEncoding: 'utf-16', capabilities: { hover: true, locationKinds: ['definition', 'typeDefinition', 'implementation', 'references'] }, root, relativePath: 'A.ts' }));
  api.languageChange.mockResolvedValue(undefined); api.languageCancel.mockResolvedValue(undefined); api.languageClose.mockResolvedValue(undefined);
  api.languageQuery.mockImplementation(async (input: LspQuery) => input.kind === 'hover' ? { kind: 'hover', text: 'const alpha: string' } : { kind: input.kind, locations: [] });
});
afterEach(() => { cleanup(); stores.splice(0).forEach(store => store.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('DEV048 real EditorView language integration', () => {
  it.each(['disabled','none','definition','full','failed'] as const)('Q01: exposes capability-gated actual menu for %s without inventing availability', async mode => {
    if (mode === 'failed') api.languageOpen.mockRejectedValueOnce(new Error('explicit language service startup failure'));
    else api.languageOpen.mockImplementationOnce(async input => mode === 'disabled' ? { state: 'unavailable', reason: '代码语言服务已关闭' } : {
      state: 'ready', id: input.id, server: 'Capability fixture', positionEncoding: 'utf-16', root, relativePath: 'A.ts',
      capabilities: { hover: mode === 'full', locationKinds: mode === 'full' ? ['definition','typeDefinition','implementation','references'] : mode === 'definition' ? ['definition'] : [] },
    });
    const f = await fixture();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '代码语义导航' })); });
    const labels = { definition:'转到定义', typeDefinition:'转到类型定义', implementation:'转到实现', references:'查找引用' };
    for (const [kind, name] of Object.entries(labels)) {
      const item = screen.getByRole('menuitem', { name });
      const enabled = mode === 'full' || mode === 'definition' && kind === 'definition';
      expect(item.getAttribute('aria-disabled') === 'true').toBe(!enabled);
    }
    expect(f.language.current?.supports('hover')).toBe(mode === 'full');
    if (mode === 'disabled') expect(screen.getByText('代码语言服务已关闭')).toBeTruthy();
    if (mode === 'failed') expect(screen.getByRole('alert').textContent).toContain('explicit language service startup failure');
    expect(api.languageQuery).not.toHaveBeenCalled();
  });

  it('Q02: all four kinds preserve zero-result selection, then navigate exactly one UTF-16 destination', async () => {
    const f = await fixture();
    for (const kind of ['definition','typeDefinition','implementation','references'] as const) {
      const previous = f.store.active?.route.relativePath;
      api.languageQuery.mockResolvedValueOnce({ kind, locations: [] });
      await act(async () => { await f.language.request(kind, 6); }); expect(f.store.active?.route.relativePath).toBe(previous);
      api.languageQuery.mockResolvedValueOnce({ kind, locations: [location(`${kind}.ts`)] });
      await act(async () => { await f.language.request(kind, 6); });
      expect(f.store.active?.route.relativePath).toBe(`${kind}.ts`);
      expect(f.view().state.selection.main).toMatchObject({ from: 6, to: 11 });
    }
  });

  it('Q02: one and multiple outside-root results remain read-only locations and issue no file-open request', async () => {
    const f = await fixture(), before = f.fileApi.open.mock.calls.length;
    for (const count of [1,2]) {
      const outside = { relativePath:null, displayPath:'/outside/fixture.ts', outsideRoot:true, range:location().range };
      api.languageQuery.mockResolvedValueOnce({ kind:'definition', locations:Array.from({length:count},()=>outside) });
      await act(async () => { await f.language.request('definition',6); });
      const buttons = screen.getAllByRole('button',{name:'/outside/fixture.ts:1:7 · 根外只读位置'});
      expect(buttons).toHaveLength(count); expect(buttons.every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
      await act(async () => { await f.language.select(outside); });
      expect(f.fileApi.open).toHaveBeenCalledTimes(before); expect(f.store.active?.route.relativePath).toBe('A.ts');
    }
  });

  it('Q03: leaving during a real editor hover cancels the request and ignores its late result', async () => {
    const f=await fixture(),view=f.view();vi.spyOn(view,'posAtCoords').mockReturnValue(7);
    let release!:(value:unknown)=>void;api.languageQuery.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    fireEvent.mouseMove(view.contentDOM,{clientX:20,clientY:20});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
    fireEvent.mouseLeave(view.dom);expect(api.languageCancel).toHaveBeenCalledTimes(1);
    await act(async()=>{release({kind:'hover',text:'late after pointer left'});await vi.advanceTimersByTimeAsync(5100);});
    expect(screen.queryByRole('tooltip')).toBeNull();expect(api.languageQuery).toHaveBeenCalledTimes(1);
  });
  it('uses 300ms initial hover, at most two 500ms null retries, and 100ms leave close', async () => {
    const show = vi.fn(), request = vi.fn(async () => null as string | null), hover = new LanguageHover(show);
    hover.enter('token', 1, 2, request, () => true); await vi.advanceTimersByTimeAsync(299); expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(request).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(499); expect(request).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1); expect(request).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(500); expect(request).toHaveBeenCalledTimes(3); await vi.advanceTimersByTimeAsync(5000); expect(request).toHaveBeenCalledTimes(3);
    request.mockResolvedValue('type'); hover.enter('other', 1, 2, request, () => true); await vi.advanceTimersByTimeAsync(300); expect(show).toHaveBeenLastCalledWith({ text: 'type', x: 1, y: 2 }); hover.leave(); await vi.advanceTimersByTimeAsync(99); expect(show).not.toHaveBeenLastCalledWith(null); await vi.advanceTimersByTimeAsync(1); expect(show).toHaveBeenLastCalledWith(null); hover.cancel();
  });
  it.each(['ctrlKey', 'metaKey'])('handles %s+token with actual editor DOM and does not navigate on zero results', async modifier => {
    const f = await fixture(), view = f.view(); vi.spyOn(view, 'posAtCoords').mockReturnValue(7);
    await act(async () => { fireEvent.mouseDown(view.contentDOM, { [modifier]: true, button: 0, clientX: 30, clientY: 30 }); });
    expect(api.languageQuery).toHaveBeenCalledWith(expect.objectContaining({ kind: 'definition', position: { line: 0, character: 6 } })); expect(f.store.active?.route.relativePath).toBe('A.ts'); expect(screen.getByRole('status').textContent).toContain('未找到定义');
  });
  it('renders all four kinds and appends locations in batches of 100 without replacing existing results', async () => {
    const f = await fixture(); api.languageQuery.mockImplementation(async (input: LspQuery) => ({ kind: input.kind, locations: Array.from({ length: 101 }, () => location()) }));
    for (const kind of ['definition','typeDefinition','implementation','references'] as const) {
      await act(async () => { await f.language.request(kind, 6); });
      const first = screen.getAllByRole('button', { name: '/fixture/B.ts:1:7' }); expect(first).toHaveLength(100);
      fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
      const all = screen.getAllByRole('button', { name: '/fixture/B.ts:1:7' }); expect(all).toHaveLength(101); expect(all[0]).toBe(first[0]);
      expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
    }
  });
  it('Q02: appends a second full batch then the remainder and navigates with the original zero-based range', async () => {
    const f = await fixture(); api.languageQuery.mockResolvedValueOnce({kind:'references',locations:Array.from({length:201},(_,i)=>location(`result-${i}.ts`))});
    await act(async()=>{await f.language.request('references',6);});
    expect(screen.queryByRole('button',{name:'/fixture/result-100.ts:1:7'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'加载更多'}));
    expect(screen.getByRole('button',{name:'/fixture/result-199.ts:1:7'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'/fixture/result-200.ts:1:7'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'加载更多'}));
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'/fixture/result-200.ts:1:7'}));});
    expect(f.store.active?.route.relativePath).toBe('result-200.ts');expect(f.view().state.selection.main).toMatchObject({from:6,to:11});
  });
  it('Q04: deduplicates path+position and truncates forward history only for a new destination', async () => {
    const f=await fixture();
    const jump=async(name:string)=>{api.languageQuery.mockResolvedValueOnce({kind:'definition',locations:[location(name)]});await act(async()=>{await f.language.request('definition',6);});};
    await jump('B.ts'); await jump('C.ts');
    expect(f.language.history.entries).toHaveLength(3);
    await jump('C.ts'); expect(f.language.history.entries).toHaveLength(3);
    await act(async()=>{await f.language.travel(-1);});expect(f.store.active?.route.relativePath).toBe('B.ts');
    await jump('B.ts');expect(f.language.history.canForward).toBe(true);
    await jump('D.ts');expect(f.language.history.canForward).toBe(false);expect(f.language.history.entries.map(entry=>entry.path)).toEqual(['A.ts','B.ts','D.ts']);
  });
  it('Q04: ignores stale inactive editor key events and reports backend failure without advancing history', async () => {
    const f=await fixture();api.languageQuery.mockResolvedValueOnce({kind:'definition',locations:[location('B.ts')]});
    await act(async()=>{await f.language.request('definition',6);});
    const view=f.view(),before=f.fileApi.open.mock.calls.length,active=f.store.activeId;
    view.focus();f.store.activeId=null; // the old editor can still be mounted until the next React commit
    const event=new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true});
    await act(async()=>{view.contentDOM.dispatchEvent(event);});
    // CodeMirror may handle Alt+Left locally; the inactive semantic surface must not navigate.
    expect(f.fileApi.open).toHaveBeenCalledTimes(before);expect(f.store.activeId).toBeNull();expect(f.language.history.index).toBe(1);
    await act(async()=>{f.store.activate(active!);});
    api.languageQuery.mockRejectedValueOnce(new Error('language backend unavailable'));
    await act(async()=>{await f.language.request('definition',6);});
    expect(screen.getByRole('alert').textContent).toContain('language backend unavailable');expect(f.language.history.index).toBe(1);expect(f.store.active?.route.relativePath).toBe('B.ts');
  });
  it('Q03: actual EditorView retries null at 300/800/1300ms only and closes a successful hover 100ms after leave', async () => {
    const f=await fixture(),view=f.view();vi.spyOn(view,'posAtCoords').mockReturnValue(7);
    api.languageQuery.mockResolvedValue({kind:'hover',text:null});
    fireEvent.mouseMove(view.contentDOM,{clientX:20,clientY:20});
    await act(async()=>{await vi.advanceTimersByTimeAsync(299);});expect(api.languageQuery).not.toHaveBeenCalled();
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(api.languageQuery).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(499);});expect(api.languageQuery).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(api.languageQuery).toHaveBeenCalledTimes(2);
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);});expect(api.languageQuery).toHaveBeenCalledTimes(3);
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(api.languageQuery).toHaveBeenCalledTimes(3);
    fireEvent.mouseLeave(view.dom);api.languageQuery.mockResolvedValue({kind:'hover',text:'const alpha: string'});
    fireEvent.mouseMove(view.contentDOM,{clientX:20,clientY:20});
    await act(async()=>{await vi.advanceTimersByTimeAsync(300);});expect(screen.getByRole('tooltip').textContent).toBe('const alpha: string');
    fireEvent.mouseLeave(view.dom);await act(async()=>{await vi.advanceTimersByTimeAsync(99);});expect(screen.getByRole('tooltip')).toBeTruthy();
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('Q03: switching the active tab cancels an in-flight hover and excludes its late contents', async () => {
    const f=await fixture(),view=f.view();vi.spyOn(view,'posAtCoords').mockReturnValue(7);
    let release!:(value:unknown)=>void;api.languageQuery.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    fireEvent.mouseMove(view.contentDOM,{clientX:20,clientY:20});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
    const oldId=f.language.current!.id;await act(async()=>{await f.store.open(root,'B.ts',true);});
    expect(api.languageCancel).toHaveBeenCalledWith(oldId,expect.any(String));expect(api.languageClose).toHaveBeenCalledWith(oldId);
    await act(async()=>{release({kind:'hover',text:'late tab A'});await vi.advanceTimersByTimeAsync(5000);});
    expect(screen.queryByRole('tooltip')).toBeNull();expect(f.store.active?.route.relativePath).toBe('B.ts');expect(api.languageQuery).toHaveBeenCalledTimes(1);
  });
  it('Q04: focused editor keyboard history respects boundary buttons without handling another surface', async () => {
    const f=await fixture();
    expect((screen.getByRole('button',{name:'语义导航后退'}) as HTMLButtonElement).disabled).toBe(true);
    for(const name of ['B.ts','C.ts']){api.languageQuery.mockResolvedValueOnce({kind:'definition',locations:[location(name)]});await act(async()=>{await f.language.request('definition',6);});}
    const press=async(key:string)=>{const view=f.view();view.focus();await act(async()=>{fireEvent.keyDown(view.contentDOM,{key,altKey:true});});};
    await press('ArrowLeft');expect(f.store.active?.route.relativePath).toBe('B.ts');
    await press('ArrowLeft');expect(f.store.active?.route.relativePath).toBe('A.ts');
    expect((screen.getByRole('button',{name:'语义导航后退'}) as HTMLButtonElement).disabled).toBe(true);
    await press('ArrowRight');await press('ArrowRight');expect(f.store.active?.route.relativePath).toBe('C.ts');
    expect((screen.getByRole('button',{name:'语义导航前进'}) as HTMLButtonElement).disabled).toBe(true);
    const other=document.createElement('button');document.body.append(other);other.focus();
    const event=new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true});other.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);expect(f.store.active?.route.relativePath).toBe('C.ts');other.remove();
  });
  it('navigates A→B→C then back/forward with production workspace; terminal key events remain untouched', async () => {
    const f = await fixture(); api.languageQuery.mockResolvedValueOnce({ kind: 'definition', locations: [location('B.ts')] });
    await act(async () => { await f.language.request('definition', 6); }); expect(f.store.active?.route.relativePath).toBe('B.ts');
    api.languageQuery.mockResolvedValueOnce({ kind: 'definition', locations: [location('C.ts')] }); await act(async () => { await f.language.request('definition', 6); }); expect(f.store.active?.route.relativePath).toBe('C.ts');
    expect(f.language.history.canBack).toBe(true); expect(f.language.history.canForward).toBe(false);
    await act(async () => { await f.language.travel(-1); }); expect(f.store.active?.route.relativePath).toBe('B.ts'); await act(async () => { await f.language.travel(-1); }); expect(f.store.active?.route.relativePath).toBe('A.ts'); expect(f.language.history.canBack).toBe(false);
    await act(async () => { await f.language.travel(1); }); expect(f.store.active?.route.relativePath).toBe('B.ts');
    const terminal = document.createElement('textarea'); document.body.append(terminal); terminal.focus(); const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }); terminal.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); expect(f.store.active?.route.relativePath).toBe('B.ts'); terminal.remove();
  });
  it('cancels hover on edits, composition and view replacement, and never renders a late response', async () => {
    const f = await fixture(), view = f.view(); vi.spyOn(view, 'posAtCoords').mockReturnValue(7); let release!: (value: unknown) => void; api.languageQuery.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    fireEvent.mouseMove(view.contentDOM, { clientX: 20, clientY: 20 }); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(api.languageQuery).toHaveBeenCalledTimes(1);
    await act(async () => { view.dispatch({ changes: { from: 0, insert: 'X' } }); }); expect(api.languageCancel).toHaveBeenCalled();
    await act(async () => { release({ kind: 'hover', text: 'stale' }); }); expect(screen.queryByRole('tooltip')).toBeNull(); expect(api.languageChange).toHaveBeenCalledWith(expect.objectContaining({ version: 2, text: expect.stringContaining('Xconst') }));
    fireEvent.compositionStart(view.contentDOM); fireEvent.mouseMove(view.contentDOM, { clientX: 20, clientY: 20 }); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(api.languageQuery).toHaveBeenCalledTimes(1);
    await act(async () => { await f.store.open(root, 'B.ts'); }); expect(api.languageClose).toHaveBeenCalledWith(api.languageOpen.mock.calls[0][0].id); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('closes an initializing consumer on unmount and rejects late capability/response state', async () => {
    let release!: (value: unknown) => void; api.languageOpen.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const f = await fixture(), id = api.languageOpen.mock.calls[0][0].id;
    await act(async () => { await f.store.open(root, 'B.ts'); }); expect(api.languageClose).toHaveBeenCalledWith(id);
    await act(async () => { release({ state: 'unavailable', reason: 'old unavailable' }); }); expect(f.language.current?.id).not.toBe(id); expect(f.language.current?.session?.state).toBe('ready');
  });
});

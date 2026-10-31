// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { deleteCharBackward, insertNewlineAndIndent, selectAll } from '@codemirror/commands';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileBuffer } from './file-buffer';
import { FileTextEditor } from './text-editor';

// Worker rendering is unrelated to readonly input. The production component,
// EditorView, commands, buffer, service and native filesystem remain real.
vi.mock('./code/editor', () => ({ codeHighlight: () => [] }));
vi.mock('./markdown/editor', () => ({ markdownEditor: () => [] }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const disk = (path: string) => { const stat = statSync(path, { bigint: true }); return { hash: sha(readFileSync(path)), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), inode: String(stat.ino), mode: Number(stat.mode) & 0o777 }; };
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
class ObservedBroker extends NativeFileBroker {
  operations: unknown[] = [];
  override request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> { this.operations.push(input.operation); return super.request<T>(input, options); }
}
async function fixture(kind: 'permission' | 'size') {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-readonly-text-'))), project = join(base, 'project'), userdata = join(base, 'userdata'); mkdirSync(project); mkdirSync(userdata);
  const path = join(project, `${kind}.txt`), text = kind === 'size' ? 'X'.repeat(10 * 1024 * 1024 + 1) : 'Readonly 中文🙂\n'; writeFileSync(path, text); if (kind === 'permission') chmodSync(path, 0o444);
  const broker = new ObservedBroker(process.env.SMARTDD_M9_FILE_BROKER!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Readonly acceptance', projectId: 'readonly-text' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const root = (await service.openScope('readonly', { kind: 'project', projectId: 'readonly-text' })).roots[0];
  const file = await service.open('readonly', { lease: root.lease, generation: root.generation, relativePath: `${kind}.txt` });
  const api: ConstructorParameters<typeof FileBuffer>[1] = {
    read: ref => service.read('readonly', ref), refresh: ref => service.refresh('readonly', ref), drafts: async ref => service.drafts('readonly', ref), readDraft: (ref, id) => service.readDraft('readonly', ref, id),
    save: vi.fn(input => service.save('readonly', input)), checkpoint: vi.fn(input => service.checkpoint('readonly', input)), resolveDraft: input => service.resolveDraft('readonly', input), closeDocument: async ref => service.closeDocument('readonly', ref),
  };
  const buffer = new FileBuffer(file, api, () => undefined); await buffer.load();
  const f = { path, text, buffer, api, service, broker, cleanup: async () => { buffer.dispose(); service.closeOwner('readonly'); await service.watcher.dispose(); broker.dispose(); chmodSync(path, 0o600); rmSync(base, { recursive: true, force: true }); } }; fixtures.push(f); return f;
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
afterEach(async () => { cleanup(); for (const f of fixtures.splice(0)) await f.cleanup(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.SMARTDD_READONLY_EVIDENCE) writeFileSync(process.env.SMARTDD_READONLY_EVIDENCE, JSON.stringify({ caseId: 'M9-T-H11', at: new Date().toISOString(), broker: process.env.SMARTDD_M9_FILE_BROKER, brokerSha256: sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)), boundary: 'Production EditorView/component and real service/native IO. DOM events are synthetic jsdom events, not App or physical keyboard evidence; syntax workers are isolated.', rows }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('M9 H11 actual readonly text input and native save boundary', () => {
  it('readonly content accepts keyboard focus and Find restores it without enabling writes', async () => {
    const f = await fixture('permission'), before = disk(f.path);
    const mounted = render(<><button>Before readonly editor</button><FileTextEditor buffer={f.buffer} wrap={false} /><button>After readonly editor</button></>);
    const editor = EditorView.findFromDOM(mounted.container.querySelector('.cm-editor') as HTMLElement)!;
    act(() => mounted.getByRole('button', { name: 'Before readonly editor' }).focus());
    const user = userEvent.setup(), focusPath: string[] = [];
    for (let i = 0; i < 12; i++) {
      await user.tab();
      focusPath.push(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '');
      if (document.activeElement === editor.contentDOM || document.activeElement === mounted.getByRole('button', { name: 'After readonly editor' })) break;
    }
    expect(document.activeElement).toBe(editor.contentDOM);
    fireEvent.keyDown(document.activeElement!, { key: 'f', code: 'KeyF', metaKey: true });
    const find = mounted.getByRole('textbox', { name: '在文件中查找' });
    expect(document.activeElement).toBe(find);
    fireEvent.keyDown(find, { key: 'Escape' });
    expect(mounted.queryByRole('textbox', { name: '在文件中查找' })).toBeNull();
    expect(document.activeElement).toBe(editor.contentDOM);
    expect(editor.state.facet(EditorState.readOnly)).toBe(true);
    expect(editor.contentDOM.getAttribute('contenteditable')).toBe('false');
    expect(f.buffer.dirty).toBe(false); expect(disk(f.path)).toEqual(before);
    expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled();
    rows.push({ scenario: 'readonly Tab reachability / Find / Escape restore', focusPath, before, after: disk(f.path), readonly: true, writes: 0 });
  });
  it.each(['permission', 'size'] as const)('%s readonly blocks input, paste, selection replacement and writes', async kind => {
    const f = await fixture(kind), before = disk(f.path); const mounted = render(<FileTextEditor buffer={f.buffer} wrap={false} />);
    const editor = EditorView.findFromDOM(mounted.container.querySelector('.cm-editor') as HTMLElement)!;
    expect(editor.state.facet(EditorState.readOnly)).toBe(true); expect(editor.contentDOM.getAttribute('contenteditable')).toBe('false'); expect(f.buffer.editable).toBe(false);
    expect(mounted.queryByRole('button', { name: '撤销' })).toBeNull(); expect(mounted.queryByRole('button', { name: '重做' })).toBeNull();
    const commands: boolean[] = []; act(() => { commands.push(insertNewlineAndIndent(editor)); selectAll(editor); commands.push(deleteCharBackward(editor)); });
    // These are the commands bound by the production defaultKeymap. Bare
    // insertNewline/insertTab helpers are not wired to this component and can
    // write programmatically; they are not a simulated user command.
    expect(sha(f.buffer.raw)).toBe(before.hash);
    const paste = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(paste, 'clipboardData', { value: { files: [], types: ['text/plain'], getData: (type: string) => type === 'text/plain' ? 'PASTE MUST NOT MODIFY' : '' } });
    act(() => { editor.contentDOM.dispatchEvent(paste); editor.contentDOM.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: '替换' })); });
    // Attempt a DOM mutation as if typing/replacing had reached contenteditable;
    // the real CodeMirror observer must discard it in readonly state.
    await act(async () => { const line = editor.contentDOM.querySelector('.cm-line')!; line.textContent = 'FORBIDDEN REPLACEMENT'; editor.contentDOM.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'FORBIDDEN REPLACEMENT' })); await realDelay(30); });
    const saved = await f.buffer.save(); await realDelay(20);
    expect(saved).toBe(true); expect(sha(f.buffer.raw)).toBe(before.hash); expect(f.buffer.dirty).toBe(false); expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled(); expect(f.broker.operations).not.toContain('save');
    let permissionProbe: unknown = null;
    if (kind === 'permission') {
      expect(f.buffer.file.writable).toBe(false);
      permissionProbe = await f.service.save('readonly', { ref: f.buffer.file.ref, opId: crypto.randomUUID(), bufferVersion: 1, baseHash: f.buffer.baseHash, base64: Buffer.from('MUST BE REFUSED').toString('base64') });
      expect(permissionProbe).toMatchObject({ state: 'failed', message: '文件为只读；本地修改仍保留' }); expect(f.broker.operations).not.toContain('save');
    } else { expect(before.size).toBe('10485761'); expect(f.buffer.decoded).toMatchObject({ kind: 'text', editable: false, reason: '文件超过 10 MiB，当前以只读文本打开' }); }
    const after = disk(f.path); expect(after).toEqual(before);
    rows.push({ kind, before, after, rawHash: sha(f.buffer.raw), dirty: f.buffer.dirty, readonlyFacet: editor.state.facet(EditorState.readOnly), contentEditable: editor.contentDOM.getAttribute('contenteditable'), commands, saveResult: saved, uiSaveCalls: vi.mocked(f.api.save).mock.calls.length, nativeSaveCalls: f.broker.operations.filter(value => value === 'save').length, reason: f.buffer.decoded?.kind === 'text' ? f.buffer.decoded.reason ?? 'file writable=false' : '', permissionProbe });
  }, 20_000);
});

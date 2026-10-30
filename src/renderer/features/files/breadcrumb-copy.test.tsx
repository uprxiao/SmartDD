// @vitest-environment jsdom
// G023 component tests only: DOM Range + a local event clipboardData sink.
// No navigator clipboard API, OS clipboard, native broker or App UI is used.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot, PathRequest } from '@shared/files';
import { FileBreadcrumb } from './breadcrumb';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';

vi.mock('./terminal-context/context', () => ({ useFileTerminalContext: () => null }));
// Application discovery is unrelated to copying a DOM breadcrumb selection.
vi.mock('@renderer/lib/ipc', () => ({
  events: { on: () => () => undefined },
  rpc: { files: { applications: async () => ({ id: 'no-os-discovery', apps: [] }) } },
}));
const stores: FileWorkspaceStore[] = [];
const observations: Array<Record<string, unknown>> = [];
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
  stores.splice(0).forEach(store => store.dispose());
  vi.unstubAllGlobals();
});
afterAll(async () => {
  const directory = process.env.WILLYOU_G023_EVIDENCE;
  if (directory) await writeFile(join(directory, 'component-observations.json'), JSON.stringify({
    boundary: 'jsdom component/DOM Range; each copy uses an in-memory clipboardData sink, never a system clipboard API',
    observations,
  }, null, 2) + '\n');
});

async function fixture(names = { label: '项目›别名', folder: '目录›片段', file: '报告›🙂.txt' }) {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const path = '/fixture/真实根›中文';
  const root: FileRoot = {
    source: 'project-directory', sourceId: 'g023-root', path, canonicalPath: path,
    label: names.label, lease: randomUUID(), generation: 1,
    identity: { device: '1', inode: 'g023-root' },
  };
  const relativePath = names.folder + '/' + names.file;
  const absolutePath = path + '/' + relativePath;
  const documents = new Map<string, FileDocument>();
  const api = {
    roots: async () => ({ roots: [root], unavailable: [] }),
    list: async () => [],
    open: async (input: PathRequest) => {
      const file: FileDocument = {
        ref: { id: randomUUID(), lease: input.lease, generation: 1 },
        documentKey: 'g023:' + input.relativePath, name: names.file,
        relativePath: input.relativePath, absolutePath, writable: true,
        revision: { device: '1', inode: 'fixture-file', hash: 'a'.repeat(64), size: 5, modifiedNs: '1', changedNs: '1' },
      };
      documents.set(file.ref.id, file); return file;
    },
    read: async (ref: { id: string }) => ({ document: documents.get(ref.id)!, base64: btoa('BASE\n') }),
    refresh: async (ref: { id: string }) => documents.get(ref.id)!,
    drafts: async () => [], closeDocument: async () => undefined, closeScope: async () => undefined,
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'g023-fixture' }, api as unknown as FileClient, null, null);
  stores.push(store); await store.initialize(); await store.open(root, relativePath, true);
  render(<FileBreadcrumb store={store} run={() => { throw new Error('No business action is part of this copy-selection component test'); }} />);
  const crumb = screen.getByLabelText('文件路径');
  const text = (name: string) => {
    const element = screen.getByRole('button', { name });
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (!node || node.nodeValue !== name) throw new Error('Fixture text node does not match displayed breadcrumb segment');
    return node;
  };
  return { crumb, names, absolutePath, rootText: text(names.label), folderText: text(names.folder), fileText: text(names.file) };
}

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange(); range.setStart(start, startOffset); range.setEnd(end, endOffset);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return selection.toString();
}
function copy(target: HTMLElement, label: string) {
  const selected = window.getSelection()!.toString();
  const values = new Map<string, string>();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => values.set(type, value) } });
  fireEvent(target, event);
  const result = { label, selected, prevented: event.defaultPrevented, values: Object.fromEntries(values), clipboardDataScope: 'in-memory event sink only' };
  observations.push(result); return { ...result, text: values.get('text/plain') };
}

describe('G023 original E15 DOM selection copy preserves literal filename characters', () => {
  it('keeps a partial selection inside one filename containing literal U+203A and Unicode unchanged', async () => {
    const f = await fixture();
    expect(select(f.fileText, 1, f.fileText, '报告›🙂'.length)).toBe('告›🙂');
    const result = copy(f.crumb, 'literal-filename-fragment');
    expect(result.prevented).toBe(true);
    expect(result.text).toBe('告›🙂');
  });
  it('keeps a partial display-root label containing literal U+203A unchanged', async () => {
    const f = await fixture();
    expect(select(f.rootText, 1, f.rootText, 4)).toBe('目›别');
    const result = copy(f.crumb, 'literal-root-label-fragment');
    expect(result.text).toBe('目›别');
  });
  it('converts only the selected structural separator across two segments, preserving both names literal U+203A', async () => {
    const f = await fixture();
    expect(select(f.folderText, 0, f.fileText, 3)).toBe('目录›片段›报告›');
    const result = copy(f.crumb, 'mixed-name-and-structural-separators');
    expect(result.prevented).toBe(true);
    expect(result.text).toBe('目录›片段/报告›');
  });
  it('converts a genuine selected structural separator for ordinary partial segment selection', async () => {
    const f = await fixture({ label: 'Alias', folder: 'plain', file: 'data.txt' });
    expect(select(f.folderText, 2, f.fileText, 4)).toBe('ain›data');
    expect(copy(f.crumb, 'ordinary-structural-control').text).toBe('ain/data');
  });
  it.each([false, true])('maps the full DOM range despite browser layout newlines (literal newline=%s)', async (literalNewline) => {
    const f = await fixture({ label: '项目›别名', folder: '目录›片段', file: literalNewline ? '报告\n›🙂.txt' : '报告›🙂.txt' });
    select(f.rootText, 0, f.fileText, f.names.file.length);
    const selection = window.getSelection()!;
    const rendered = [f.names.label, '›', f.names.folder, '›', f.names.file].join('\n');
    const spy = vi.spyOn(selection, 'toString').mockReturnValue(rendered);
    try { expect(copy(f.crumb, 'browser-layout-full-range').text).toBe(f.absolutePath); }
    finally { spy.mockRestore(); }
  });
  it('maps the complete display breadcrumb to the actual full path and preserves literal U+203A in source path', async () => {
    const f = await fixture();
    expect(select(f.rootText, 0, f.fileText, f.names.file.length)).toBe('项目›别名›目录›片段›报告›🙂.txt');
    const result = copy(f.crumb, 'full-path-control');
    expect(result.prevented).toBe(true);
    expect(result.text).toBe('/fixture/真实根›中文/目录›片段/报告›🙂.txt');
    expect(result.text).toBe(f.absolutePath);
  });
  it('leaves a selection outside the breadcrumb to normal text copy handling', async () => {
    const f = await fixture();
    const outside = document.createElement('p'); outside.textContent = '普通›文本🙂'; document.body.append(outside);
    try {
      expect(select(outside.firstChild!, 0, outside.firstChild!, outside.textContent.length)).toBe('普通›文本🙂');
      const result = copy(f.crumb, 'outside-normal-text-control');
      expect(result.prevented).toBe(false); expect(result.text).toBeUndefined();
    } finally { outside.remove(); }
  });
});

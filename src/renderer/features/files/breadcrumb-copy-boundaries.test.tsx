// @vitest-environment jsdom
// Component/helper boundary only. No system clipboard API is called.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { breadcrumbSelectionText } from '@shared/file-breadcrumb-copy.mjs';
// @ts-ignore -- The shared prototype is JSX and is inspected at runtime here.
import { FileWorkspace } from '@root/prototypes/m6-codex/src/FileWorkspace.jsx';

// Only unrelated editor/tree/format surfaces are stubs. The P FileWorkspace,
// its actual breadcrumb onCopy, Lucide SVG and the shared copy helper are real.
vi.mock('@root/prototypes/m6-codex/src/FileCodeTextarea', () => ({
  FileCodeTextarea: () => <div data-unrelated-editor-stub />,
  FilePrototypeBlame: () => null,
}));
vi.mock('@root/prototypes/m6-codex/src/FileWorkspaceTree', () => ({ FileWorkspaceTree: () => null }));
vi.mock('@root/prototypes/m6-codex/src/FileMarkdown', () => ({ FileMarkdown: () => null }));
vi.mock('@root/prototypes/m6-codex/src/FileArtifactPreview', () => ({ FileArtifactPreview: () => null }));
const nodes: HTMLElement[] = [];
const observations: Array<Record<string, unknown>> = [];
afterEach(() => {
  window.getSelection()?.removeAllRanges(); cleanup(); nodes.splice(0).forEach(node => node.remove());
  localStorage.clear(); vi.unstubAllGlobals();
});
afterAll(async () => {
  const directory = process.env.WILLYOU_G026_EVIDENCE;
  if (directory) await writeFile(join(directory, 'boundary-observations.json'), JSON.stringify({
    boundary: 'jsdom actual Range/helper and actual P FileWorkspace breadcrumb, in-memory copy-event sink, no OS clipboard or App',
    observations,
  }, null, 2) + '\n');
});
function choose(start: Node, startOffset: number, end: Node, endOffset: number, backward = false) {
  const selection = window.getSelection()!; selection.removeAllRanges();
  if (backward) selection.setBaseAndExtent(end, endOffset, start, startOffset);
  else { const range = document.createRange(); range.setStart(start, startOffset); range.setEnd(end, endOffset); selection.addRange(range); }
  return selection;
}
function record(label: string, selection: Selection, value: unknown, container?: HTMLElement) {
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  observations.push({ label, selected: selection.toString(), anchorNode: selection.anchorNode?.nodeName,
    anchorOffset: selection.anchorOffset, focusNode: selection.focusNode?.nodeName, focusOffset: selection.focusOffset,
    rangeText: range?.cloneContents().textContent, value, markup: container?.innerHTML });
}
function htmlCrumbs() {
  const container = document.createElement('div');
  container.innerHTML = '<button>目录›片段</button><span class="fw-crumb-chevron" aria-hidden="true">›</span><button>报告›🙂.txt</button>';
  document.body.append(container); nodes.push(container);
  return { container, left: container.children[0].firstChild!, separator: container.children[1], right: container.children[2].firstChild! };
}
function helper(label: string, container: HTMLElement, selection: Selection, absolutePath = '/fixture/目录›片段/报告›🙂.txt') {
  const value = breadcrumbSelectionText(container, selection, absolutePath); record(label, selection, value, container); return value;
}
function prototypeCrumbs() {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  render(<FileWorkspace task={{ id: 'g026-own-task', cwd: '/fixture/实际根›中文', hostId: 'local', status: 'idle' }} project={{ id: 'g026-own-project', name: '显示›别名', path: '/fixture/实际根›中文' }} dark={false} onTheme={() => undefined} onClose={() => undefined} />);
  const container = document.querySelector<HTMLElement>('.fw-breadcrumb')!;
  expect(container).not.toBeNull();
  const buttons = container.querySelectorAll('button');
  expect([...buttons].map(button => button.textContent)).toEqual(['显示›别名', 'AGENTS.md']);
  const separator = container.querySelector<SVGElement>('svg[data-breadcrumb-separator]')!;
  expect(separator.namespaceURI).toBe('http://www.w3.org/2000/svg');
  return { container, left: buttons[0].firstChild!, right: buttons[1].firstChild!, separator };
}
function copyP(label: string, container: HTMLElement) {
  const values = new Map<string, string>();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => values.set(type, value) } });
  fireEvent(container, event);
  const result = { text: values.get('text/plain'), prevented: event.defaultPrevented };
  record(label, window.getSelection()!, result, container); return result;
}

describe('G026 shared selection helper non-system boundary cases', () => {
  it('preserves ordinary selected literal U+203A text without breadcrumb list or separator markup', () => {
    const container = document.createElement('div'); container.textContent = '普通›文字'; document.body.append(container); nodes.push(container);
    const selection = choose(container.firstChild!, 1, container.firstChild!, 4);
    expect(selection.toString()).toBe('通›文'); expect(helper('plain-text-without-list', container, selection)).toBe('通›文');
  });
  it('copies only a real textual separator selected inside its text node as slash', () => {
    const f = htmlCrumbs(), selection = choose(f.separator.firstChild!, 0, f.separator.firstChild!, 1);
    expect(selection.toString()).toBe('›'); expect(helper('textual-separator-content', f.container, selection)).toBe('/');
  });
  it('copies only a real textual separator selected as an element node as slash', () => {
    const f = htmlCrumbs(), range = document.createRange(); range.selectNode(f.separator);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    expect(selection.toString()).toBe('›'); expect(helper('textual-separator-element', f.container, selection)).toBe('/');
  });
  it('normalizes backward mixed selection by DOM structure while retaining name U+203A', () => {
    const f = htmlCrumbs(), selection = choose(f.left, 1, f.right, 3, true);
    expect(selection.anchorNode).toBe(f.right); expect(selection.focusNode).toBe(f.left);
    expect(selection.toString()).toBe('录›片段›报告›');
    expect(helper('backward-html-mixed', f.container, selection)).toBe('录›片段/报告›');
  });
  it('does not intercept a range with one endpoint outside the breadcrumb', () => {
    const outside = document.createElement('p'); outside.textContent = '外部文本'; document.body.append(outside); nodes.push(outside);
    const f = htmlCrumbs(), selection = choose(outside.firstChild!, 1, f.right, 3);
    expect(helper('one-outside-endpoint', f.container, selection)).toBeNull();
  });
  it('does not intercept a collapsed caret inside a filename', () => {
    const f = htmlCrumbs(), selection = choose(f.right, 2, f.right, 2);
    expect(selection.isCollapsed).toBe(true); expect(helper('collapsed-caret', f.container, selection)).toBeNull();
  });
});
describe('G026 actual shared P FileWorkspace SVG breadcrumb copy', () => {
  it('preserves literal U+203A inside a partially selected prototype display-root name', () => {
    const f = prototypeCrumbs(); choose(f.left, 1, f.left, 4);
    expect(copyP('P-literal-name', f.container)).toEqual({ text: '示›别', prevented: true });
  });
  it('inserts one slash across the actual SVG even though native selected text has no chevron character', () => {
    const f = prototypeCrumbs(), selection = choose(f.left, 1, f.right, 3);
    expect(selection.toString()).toBe('示›别名AGE');
    expect(copyP('P-cross-SVG', f.container)).toEqual({ text: '示›别名/AGE', prevented: true });
  });
  it('maps complete P breadcrumb selection to actual full path instead of the display alias', () => {
    const f = prototypeCrumbs(), selection = choose(f.left, 0, f.right, 'AGENTS.md'.length);
    expect(selection.toString()).toBe('显示›别名AGENTS.md');
    expect(copyP('P-full-actual-path', f.container)).toEqual({ text: '/fixture/实际根›中文/AGENTS.md', prevented: true });
  });
  it('retains the structural slash when selection ends after the actual SVG but before the next filename', () => {
    const f = prototypeCrumbs();
    const selection = choose(f.left, 1, f.separator.parentNode!, Array.prototype.indexOf.call(f.separator.parentNode!.childNodes, f.separator) + 1);
    expect(selection.toString()).toBe('示›别名');
    expect(copyP('P-text-through-SVG', f.container)).toEqual({ text: '示›别名/', prevented: true });
  });
  it('leaves a graphic-only SVG selection with no text to normal empty copy handling', () => {
    const f = prototypeCrumbs(), range = document.createRange(); range.selectNode(f.separator);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    expect(selection.toString()).toBe('');
    expect(copyP('P-SVG-only-no-text', f.container)).toEqual({ text: undefined, prevented: false });
  });
  it('normalizes actual P backward SVG-crossing selection without losing literal name text', () => {
    const f = prototypeCrumbs(), selection = choose(f.left, 1, f.right, 3, true);
    expect(selection.anchorNode).toBe(f.right); expect(selection.focusNode).toBe(f.left);
    expect(copyP('P-backward-cross-SVG', f.container)).toEqual({ text: '示›别名/AGE', prevented: true });
  });
});

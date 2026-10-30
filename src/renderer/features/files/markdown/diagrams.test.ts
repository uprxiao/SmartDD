// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileBuffer } from '../file-buffer';
const bridge = vi.hoisted(() => ({ diagram: vi.fn(), cancelDiagram: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: bridge } }));
import { loadMarkdownDiagram } from './diagrams';
const BaseURL = URL, tick = () => new Promise(resolve => setTimeout(resolve, 0));
const buffer = { file: { ref: { id: 'U-only-ref', lease: 'U-only-lease', generation: 1 } } } as unknown as FileBuffer;
const pending: { resolve(value: string): void; reject(error: Error): void }[] = [], cleanups: (() => void)[] = [];
let creates: ReturnType<typeof vi.fn<(blob: Blob | MediaSource) => string>>, revokes: ReturnType<typeof vi.fn<(url: string) => void>>;
function mount() { const element = document.createElement('div'); document.body.append(element); const abort = new AbortController(), dispose = loadMarkdownDiagram(buffer, element, 'flowchart LR\n A-->B', abort.signal); if (typeof dispose === 'function') cleanups.push(dispose); return { element, abort, dispose }; }
beforeEach(() => {
  document.body.replaceChildren(); document.documentElement.className = ''; pending.length = 0; bridge.diagram.mockReset(); bridge.cancelDiagram.mockReset().mockResolvedValue(undefined);
  bridge.diagram.mockImplementation(() => new Promise<string>((resolve, reject) => pending.push({ resolve, reject })));
  creates = vi.fn((_blob: Blob | MediaSource) => 'blob:U-only-' + creates.mock.calls.length); revokes = vi.fn((_url: string) => undefined); vi.stubGlobal('URL', class extends BaseURL { static createObjectURL = creates; static revokeObjectURL = revokes; });
});
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); document.body.replaceChildren(); });
// U-only controlled RPC promises/SVG and blob allocator; actual renderer+native
// RPC/pixels are independently required by packaged A, never claimed here.
describe('X10 diagram renderer lifecycle', () => {
  it('returns idempotent cleanup that cancels the original pending request once', () => { const f = mount(); expect(typeof f.dispose).toBe('function'); expect(bridge.diagram).toHaveBeenCalledWith(buffer.file.ref, expect.objectContaining({ source: 'flowchart LR\n A-->B', theme: 'light' })); f.dispose(); f.dispose(); expect(bridge.cancelDiagram).toHaveBeenCalledOnce(); });
  it('shares abort and returned cleanup without a double cancel', () => { const f = mount(); f.abort.abort(); f.dispose(); expect(bridge.cancelDiagram).toHaveBeenCalledOnce(); });
  it('revokes a settled image exactly once on cleanup', async () => { const f = mount(); pending[0].resolve('<svg>U-only fixture</svg>'); await tick(); expect(creates).toHaveBeenCalledOnce(); f.dispose(); f.abort.abort(); expect(revokes).toHaveBeenCalledOnce(); expect(bridge.cancelDiagram).not.toHaveBeenCalled(); });
  it('does not allocate or write DOM for an original success delivered after cleanup', async () => { const f = mount(); f.dispose(); const before = f.element.outerHTML; pending[0].resolve('<svg>U-only late fixture</svg>'); await tick(); expect(f.element.outerHTML).toBe(before); expect(creates).not.toHaveBeenCalled(); });
  it('handles active errors readably and ignores original late rejection after disposal', async () => { const active = mount(); pending[0].reject(new Error('U-only render failure')); await tick(); expect(active.element.textContent).toContain('U-only render failure'); const late = mount(); late.dispose(); const before = late.element.outerHTML; pending[1].reject(new Error('U-only late failure')); await tick(); expect(late.element.outerHTML).toBe(before); });
  it('ignores results for a detached element even before the owner abort arrives', async () => { const f = mount(); f.element.remove(); const before = f.element.outerHTML; pending[0].resolve('<svg>U-only detached fixture</svg>'); await tick(); expect(f.element.outerHTML).toBe(before); expect(creates).not.toHaveBeenCalled(); });
  it('cancels obsolete theme work and revokes both superseded and final resources', async () => { const f = mount(); pending[0].resolve('<svg>U-only light</svg>'); await tick(); const first = f.element.querySelector('img')!.src; document.documentElement.classList.add('ydark'); await tick(); expect(revokes).toHaveBeenCalledWith(first); expect(pending).toHaveLength(2); document.documentElement.classList.remove('ydark'); await tick(); expect(pending).toHaveLength(3); pending[1].resolve('<svg>U-only old dark</svg>'); await tick(); expect(creates).toHaveBeenCalledOnce(); pending[2].resolve('<svg>U-only current light</svg>'); await tick(); expect(creates).toHaveBeenCalledTimes(2); f.dispose(); expect(revokes).toHaveBeenCalledTimes(2); expect(bridge.cancelDiagram).toHaveBeenCalledOnce(); });
});

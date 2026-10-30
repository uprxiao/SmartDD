import { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';

export function loadMarkdownDiagram(buffer: FileBuffer, element: HTMLElement, source: string, signal: AbortSignal): () => void {
  if (signal.aborted) return () => undefined;
  const image = document.createElement('img'), status = document.createElement('span'), reveal = document.createElement('button');
  image.alt = 'Mermaid 图表'; image.hidden = true; reveal.type = 'button'; reveal.dataset.mdReveal = ''; reveal.textContent = '显示图表源码';
  element.append(image, status, reveal);
  let epoch = 0, id = '', url = '', disposed = false;
  const cancel = () => { if (id) void rpc.files.cancelDiagram(id).catch(() => undefined); id = ''; if (url) URL.revokeObjectURL(url); url = ''; };
  const render = () => {
    cancel(); if (disposed || signal.aborted) return;
    const own = ++epoch; id = crypto.randomUUID(); status.textContent = '正在渲染图表…'; image.hidden = true;
    void rpc.files.diagram(buffer.file.ref, { id, source, theme: document.documentElement.classList.contains('ydark') ? 'dark' : 'light' }).then((svg) => {
      if (own !== epoch || disposed || signal.aborted || !element.isConnected) return;
      id = ''; url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); image.src = url; image.hidden = false; status.textContent = '';
    }).catch((error) => { if (own === epoch && !disposed && !signal.aborted && element.isConnected) { id = ''; status.textContent = error instanceof Error ? error.message : '图表渲染失败'; } });
  };
  const themes = new MutationObserver(render); themes.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const dispose = () => { if (disposed) return; disposed = true; epoch++; themes.disconnect(); cancel(); };
  signal.addEventListener('abort', dispose, { once: true });
  render();
  return () => { signal.removeEventListener('abort', dispose); dispose(); };
}

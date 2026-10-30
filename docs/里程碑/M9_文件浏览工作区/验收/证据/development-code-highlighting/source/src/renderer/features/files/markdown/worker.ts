import { analyze, renderWindow } from './model.mjs';

let cached: unknown = null, revision = -1;
self.addEventListener('message', ({ data }: MessageEvent) => {
  const { id, rev, type } = data;
  try {
    if (type === 'parse') {
      if (typeof data.source !== 'string' || data.source.length > 20 * 1024 * 1024) throw new Error('Markdown 输入超过 20 MiB 解析预算');
      const result = analyze(data.source); cached = result.parsed; revision = rev;
      self.postMessage({ type: 'result', id, rev, index: result.index }, { transfer: [result.index.buffer] });
    } else if (type === 'window') {
      if (!cached || revision !== rev) throw new Error('Markdown 源码版本已改变');
      self.postMessage({ type: 'window', id, rev, items: renderWindow(cached, data.start, 60, data.readOnly === true) });
    }
  } catch (error) { self.postMessage({ type: 'failure', id, rev, error: error instanceof Error ? error.message : String(error) }); }
});

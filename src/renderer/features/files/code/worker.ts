import { highlightRanges, highlightWindow } from './model';
let tokens: Uint32Array<ArrayBufferLike> = new Uint32Array(), revision = -1;
self.addEventListener('message', ({ data }: MessageEvent) => {
  try {
    if (data.type === 'parse') {
      tokens = highlightRanges(data.source, data.filename); revision = data.revision;
      self.postMessage({ type: 'ready', revision });
    } else if (data.type === 'window' && data.revision === revision) {
      const result = highlightWindow(tokens, data.from, data.to);
      self.postMessage({ type: 'window', revision, request: data.request, tokens: result }, { transfer: [result.buffer] });
    }
  } catch (failure) { self.postMessage({ type: 'error', revision: data.revision, message: failure instanceof Error ? failure.message : String(failure) }); }
});

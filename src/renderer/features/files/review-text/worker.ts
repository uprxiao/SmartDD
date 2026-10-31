import { ReviewTextModel } from './model.mjs';
let model: ReviewTextModel | null = null;
self.addEventListener('message', ({ data }: MessageEvent) => {
  const { id, method, args } = data;
  try {
    if (method === 'open') {
      model = null; model = new ReviewTextModel(new Uint8Array(args[0]));
      self.postMessage({ id, result: model.info });
    } else if (method === 'window' && model) self.postMessage({ id, result: model.window(args[0]) });
    else throw new Error('[INVALID_INPUT] 文本预览已关闭');
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});

import { NotebookModel } from './model';
import { safeSvg } from './sanitize';
let model: NotebookModel | null = null;
addEventListener('message', (event: MessageEvent) => {
  const { id, method, args } = event.data;
  try {
    let result: unknown;
    switch (method) {
      case 'open': model = new NotebookModel(new Uint8Array(args[0]), args[1]); result = model.info; break;
      case 'window': if (!model) throw new Error('Notebook 尚未打开'); result = model.window(args[0], args[1], args[2]); break;
      case 'chunk': if (!model) throw new Error('Notebook 尚未打开'); result = model.chunk(args[0], args[1]); break;
      case 'asset': if (!model) throw new Error('Notebook 尚未打开'); result = model.asset(args[0]); break;
      case 'svg': result = safeSvg(args[0]); break;
      default: throw new Error('未知 Notebook 请求');
    }
    postMessage({ id, result });
  } catch (error) { postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});

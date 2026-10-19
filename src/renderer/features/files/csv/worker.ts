import { CsvModel } from './model';
let model: CsvModel | null = null;
addEventListener('message', (event: MessageEvent) => {
  const { id, method, args } = event.data;
  try {
    let result: unknown;
    if (method === 'open') { model = new CsvModel(args[0], args[1]); result = model.info; }
    else if (!model) throw new Error('表格尚未打开');
    else if (method === 'window') result = model.window(args[0], args[1], args[2], args[3]);
    else if (method === 'cell') result = model.cell(args[0], args[1], args[2]);
    else throw new Error('未知表格请求');
    postMessage({ id, result });
  } catch (error) { postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});

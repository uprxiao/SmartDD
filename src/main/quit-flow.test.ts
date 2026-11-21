import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { expect, it } from 'vitest';

// 复核 1620 CR05：编译 index.ts 中实际注册的 before-quit 回调（不启动 App），确认取消退出时不关闭新任务的 Agent。
it('取消退出保留运行，确认后等 Agent、手动终端和文件监听收尾', async () => {
  const source = ts.createSourceFile('index.ts', readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const callbacks: string[] = [];
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(source) === 'app.on' && n.arguments[0]?.getText(source) === "'before-quit'") callbacks.push(n.arguments[1].getText(source)); ts.forEachChild(n, visit); };
  visit(source);
  expect(callbacks).toHaveLength(1);
  const operations: string[] = [];
  let onQuit!: () => void;
  const quit = new Promise<void>(resolve => { onQuit = resolve; });
  let finishWatcher!: () => void;
  let watcherStarted!: () => void;
  const watcherDisposing = new Promise<void>(resolve => { watcherStarted = resolve; });
  const app = Object.assign(new EventEmitter(), { quit: () => { operations.push('quit'); onQuit(); } });
  let confirm = false, prevented = false;
  const context = {
    app,
    agentWorkspace: { closeAll: async () => { operations.push('agent'); }, tasks: { list: () => [{ status: 'working' }] } },
    ptys: { count: 1, killAll: () => operations.push('shell') },
    files: { watcher: { dispose: () => {
      operations.push('file watcher');
      return new Promise<void>(resolve => { finishWatcher = resolve; watcherStarted(); });
    } } },
    dialog: { showMessageBoxSync: () => confirm ? 0 : 1 },
    quitConfirmed: false, quitPending: false,
    getMainWindow: () => null, managedTasks: undefined, applications: undefined, markAppQuitting: () => {},
  };
  const js = ts.transpileModule(`const cb = ${callbacks[0]};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  app.on('before-quit', new Function(...Object.keys(context), `${js}; return cb;`)(...Object.values(context)));
  app.emit('before-quit', { preventDefault() { prevented = true; } });
  expect(prevented).toBe(true);
  expect(operations).toEqual([]);
  confirm = true;
  app.emit('before-quit', { preventDefault() {} });
  await watcherDisposing;
  expect(operations).toEqual(['agent', 'shell', 'file watcher']);
  finishWatcher();
  await quit;
  expect(operations).toEqual(['agent', 'shell', 'file watcher', 'quit']);
});

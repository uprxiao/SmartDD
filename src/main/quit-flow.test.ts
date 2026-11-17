import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { expect, it } from 'vitest';

// 复核 1620 CR05：编译 index.ts 中实际注册的 before-quit 回调（不启动 App），确认取消退出时不关闭新任务的 Agent。
it('取消退出不关闭 Agent 运行与手动终端；关闭只在确认之后的退出流程里', () => {
  const source = ts.createSourceFile('index.ts', readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const callbacks: string[] = [];
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(source) === 'app.on' && n.arguments[0]?.getText(source) === "'before-quit'") callbacks.push(n.arguments[1].getText(source)); ts.forEachChild(n, visit); };
  visit(source);
  expect(callbacks).toHaveLength(1);
  const app = new EventEmitter(); let closes = 0, prevented = false;
  const context = { app, agentWorkspace: { closeAll: async () => { closes++; }, tasks: { list: () => [{ status: 'working' }] } }, ptys: { count: 0 }, dialog: { showMessageBoxSync: () => 1 }, quitConfirmed: false, quitPending: false };
  const js = ts.transpileModule(`const cb = ${callbacks[0]};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  app.on('before-quit', new Function(...Object.keys(context), `${js}; return cb;`)(...Object.values(context)));
  app.emit('before-quit', { preventDefault() { prevented = true; } });
  expect(prevented).toBe(true);
  expect(closes).toBe(0);
  expect(callbacks[0]).toMatch(/await agentWorkspace\.closeAll\(\)[\s\S]*tasks\.dispose\(\)/);
});

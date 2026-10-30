// Own-App original node-pty observation; no replacement input or mode output.
function install() {
 const createRequire = process.getBuiltinModule('module').createRequire, electron = createRequire(process.cwd() + '/package.json')('electron'), req = createRequire(electron.app.getAppPath() + '/package.json'), mod = req('node-pty'), hash = value => req('node:crypto').createHash('sha256').update(value).digest('hex');
 const s = { mod, original: mod.spawn, terminals: [] }; globalThis.__ptyWriteObserver = s;
 mod.spawn = function (...args) {
  const terminal = s.original.apply(this, args), original = terminal.write, row = { pid: terminal.pid, file: args[0], args: args[1], writes: [], output: '', exited: false }; s.terminals.push(row);
  terminal.write = function (data, ...rest) { const entry = { at: Date.now(), hex: Buffer.from(data).toString('hex'), before: hash(data) }; row.writes.push(entry); try { const result = original.call(this, data, ...rest); entry.returned = true; entry.after = hash(data); if (entry.before !== entry.after) throw Error('Original PTY bytes changed'); return result; } catch (error) { entry.error = String(error); throw error; } };
  row.restore = () => { terminal.write = original; return terminal.write === original; };
  const output = terminal.onData(data => { row.output = (row.output + data).slice(-65536); }), exit = terminal.onExit(value => { row.exited = true; row.exit = value; }); row.dispose = () => { output.dispose(); exit.dispose(); };
  return terminal;
 };
 return true;
}
export const installPtyWriteObserver = app => app.mainEvaluate('(' + install.toString() + ')()');
export const observePtyWrites = app => app.mainEvaluate('globalThis.__ptyWriteObserver.terminals.map(({restore,dispose,...row})=>row)');
export const restorePtyWriteObserver = app => app.mainEvaluate('(()=>{const s=globalThis.__ptyWriteObserver,result={terminals:s.terminals.map(row=>{const ok=row.restore();row.dispose();return ok})};s.mod.spawn=s.original;result.spawn=s.mod.spawn===s.original;delete globalThis.__ptyWriteObserver;return result})()');

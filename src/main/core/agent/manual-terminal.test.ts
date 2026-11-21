import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PtyManager, type InteractiveShellOptions } from '../../pty-manager';
import { AgentManualTerminals } from './manual-terminal';

// M14-A52 手动终端（服务层）：任务目录、每任务一个、与 Agent 运行分离。
class Ptys extends EventEmitter {
  spawned: InteractiveShellOptions[] = []; alive = new Set<string>(); written: string[] = []; bracketed = true;
  writeControlled(_id: string, d: string) { this.written.push(d); }
  async bracketedPaste() { return this.bracketed; }
  spawnInteractiveShell(o: InteractiveShellOptions) { const id = `p${this.spawned.length + 1}`; this.spawned.push(o); this.alive.add(id); return id; }
  has(id: string) { return this.alive.has(id); }
  kill(id: string) { this.alive.delete(id); this.emit('exit', id, 0); }
}
describe('手动终端', () => {
  it.skipIf(process.platform === 'win32')('A61 uses a real interactive shell in the selected directory after legacy task removal', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-a61-shell-')));
    const previousShell = process.env.SHELL;
    process.env.SHELL = '/bin/sh';
    const ptys = new PtyManager();
    const terminals = new AgentManualTerminals({
      ptys, baseEnv: () => ({ HOME: cwd, PATH: '/usr/bin:/bin', SHELL: '/bin/sh', ENV: '/dev/null' }),
      taskCwd: () => cwd, taskProject: () => 'fixture-project',
    });
    const marker = 'A61_SHELL_READY';
    try {
      const { ptyId } = terminals.open('manual-only');
      let transcript = '';
      const output = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('手动 shell 未回报工作目录')), 5000);
        ptys.on('data', (id, text) => {
          if (id !== ptyId) return;
          transcript += text;
          if (transcript.includes(marker + ':' + cwd)) { clearTimeout(timer); resolve(); }
        });
      });
      expect(terminals.project('manual-only')).toBe('fixture-project');
      ptys.write(ptyId, `printf '%s:%s\\n' '${marker}' "$PWD"\r`);
      await output;
      const closed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('手动 shell 未退出')), 5000);
        ptys.on('exit', id => { if (id === ptyId) { clearTimeout(timer); resolve(); } });
      });
      ptys.write(ptyId, 'exit\r');
      await closed;
      expect(terminals.activePty('manual-only')).toBeNull();
    } finally {
      terminals.closeAll();
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 12_000);

  it('在任务目录起登录 shell，重复打开复用，退出或关闭后可重开', () => {
    const ptys = new Ptys();
    const t = new AgentManualTerminals({ ptys, baseEnv: () => ({ PATH: '/bin' }), taskCwd: id => `/w/${id}` });
    const a = t.open('t1', { cols: 80, rows: 10 });
    expect(ptys.spawned[0]).toMatchObject({ cwd: '/w/t1', env: { PATH: '/bin', TERM: 'xterm-256color' }, cols: 80, rows: 10 });
    expect(t.open('t1')).toEqual(a);
    expect(t.activePty('t2')).toBeNull();
    ptys.kill(a.ptyId);
    expect(t.activePty('t1')).toBeNull();
    const b = t.open('t1');
    expect(b.ptyId).not.toBe(a.ptyId);
    t.close('t1');
    expect(ptys.has(b.ptyId)).toBe(false);
  });
  it('代码块送入终端输入行：括号粘贴整段送入、不带回车；未开启括号粘贴时拒绝多行', async () => {
    const ptys = new Ptys();
    const t = new AgentManualTerminals({ ptys, baseEnv: () => ({}), taskCwd: () => '/w' });
    await t.paste('t1', 'ls -la\npwd\n');
    expect(ptys.written).toEqual(['\x1b[200~ls -la\npwd\x1b[201~']);
    await t.paste('t1', 'echo hi\r\x1b[201~\x03');
    expect(ptys.written[1]).toBe('\x1b[200~echo hi\n[201~\x1b[201~');
    ptys.bracketed = false;
    await t.paste('t1', 'echo one');
    expect(ptys.written[2]).toBe('echo one');
    await expect(t.paste('t1', 'a\nb')).rejects.toThrow('未开启括号粘贴');
  }, 10_000);
});

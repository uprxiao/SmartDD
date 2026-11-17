import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { AgentManualTerminals } from './manual-terminal';

// M14-A52 手动终端（服务层）：任务目录、每任务一个、与 Agent 运行分离。
class Ptys extends EventEmitter {
  spawned: any[] = []; alive = new Set<string>();
  spawn(o: any) { const id = `p${this.spawned.length + 1}`; this.spawned.push(o); this.alive.add(id); return id; }
  has(id: string) { return this.alive.has(id); }
  kill(id: string) { this.alive.delete(id); this.emit('exit', id, 0); }
}
describe('手动终端', () => {
  it('在任务目录起登录 shell，重复打开复用，退出或关闭后可重开', () => {
    const ptys = new Ptys();
    const t = new AgentManualTerminals({ ptys, baseEnv: () => ({ PATH: '/bin' }), taskCwd: id => `/w/${id}` });
    const a = t.open('t1', { cols: 80, rows: 10 });
    expect(ptys.spawned[0]).toMatchObject({ args: ['-i'], cwd: '/w/t1', env: { PATH: '/bin', TERM: 'xterm-256color' }, cols: 80, rows: 10 });
    expect(t.open('t1')).toEqual(a);
    expect(t.activePty('t2')).toBeNull();
    ptys.kill(a.ptyId);
    expect(t.activePty('t1')).toBeNull();
    const b = t.open('t1');
    expect(b.ptyId).not.toBe(a.ptyId);
    t.close('t1');
    expect(ptys.has(b.ptyId)).toBe(false);
  });
});

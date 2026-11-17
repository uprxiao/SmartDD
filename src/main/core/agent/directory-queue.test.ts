import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { DirectoryQueue, directoryIdentity } from './directory-queue';
it('A31/A32: physical aliases/overlap share FIFO, canceled entries do not block, and incomplete drain cannot release', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-queue-'))), db = new Database(':memory:'); runBundledMigrations(db);
  try {
    const inner = join(root, 'inner'), alias = join(root, 'alias'); mkdirSync(inner); symlinkSync(inner, alias);
    const a = directoryIdentity(inner, [root, inner]), b = directoryIdentity(alias, [root, alias]); expect(a.identity).toBe(b.identity);
    expect(() => directoryIdentity(inner, ['/not-registered'])).toThrow('已登记');
    const store = new AgentStore(db), queue = new DirectoryQueue(store);
    const task = () => store.createTask({ projectId: null, dirId: null, title: 'queue', cwd: inner, selection: { driverId: 'codex-app-server', profileId: 'p', tier: 'ask' } });
    const p = queue.enter(task(), a.identity), c1 = queue.enter(task(), b.identity), c2 = queue.enter(task(), a.identity);
    expect(queue.acquire(p.queue_id)).toBe(true); expect(queue.acquire(c2.queue_id)).toBe(false); expect(queue.acquire(c1.queue_id)).toBe(false);
    expect(() => queue.release(p.queue_id, { nativeExited: true, descendantsDrained: false, businessDrained: true, admissionFrozen: true })).toThrow('保留');
    expect(queue.get(p.queue_id)?.state).toBe('active');
    queue.cancel(c1.task_id); queue.release(p.queue_id, { nativeExited: true, descendantsDrained: true, businessDrained: true, admissionFrozen: true });
    expect(queue.acquire(c2.queue_id)).toBe(true);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
it('A33: a complete host read policy can run beside a writer; a fresh queue instance preserves active ownership', () => {
  const db = new Database(':memory:'); runBundledMigrations(db); const s = new AgentStore(db), q = new DirectoryQueue(s);
  try {
    const task = () => s.createTask({ projectId: null, dirId: null, cwd: '/fixture', title: 'q', selection: { driverId: 'codex-app-server', profileId: 'p', tier: 'ask' } });
    const write = q.enter(task(), 'physical-root'), read = q.enter(task(), 'physical-root', true), later = q.enter(task(), 'physical-root');
    expect(q.acquire(write.queue_id)).toBe(true); expect(q.acquire(read.queue_id)).toBe(true);
    expect(new DirectoryQueue(s).acquire(later.queue_id)).toBe(false);
  } finally { db.close(); }
});
it('A31: adding an outer registered root cannot open a second writer over an existing inner root; overlap keeps FIFO',()=>{
 const db=new Database(':memory:');runBundledMigrations(db);const store=new AgentStore(db),q=new DirectoryQueue(store),task=()=>store.createTask({projectId:null,dirId:null,cwd:'/fixture',title:'root',selection:{driverId:'codex-app-server',profileId:'p',tier:'ask'}});
 try{const inner=q.enter(task(),'/physical/inner:1:2');expect(q.acquire(inner.queue_id)).toBe(true);const outer=q.enter(task(),'/physical:1:1'),later=q.enter(task(),'/physical/inner:1:2');expect(q.acquire(outer.queue_id)).toBe(false);expect(q.acquire(later.queue_id)).toBe(false);expect(q.hasQueuedCompetitor(inner.task_id)).toBe(true);q.release(inner.queue_id,{nativeExited:true,descendantsDrained:true,businessDrained:true,admissionFrozen:true});expect(q.acquire(later.queue_id)).toBe(false);expect(q.acquire(outer.queue_id)).toBe(true);}finally{db.close();}
});

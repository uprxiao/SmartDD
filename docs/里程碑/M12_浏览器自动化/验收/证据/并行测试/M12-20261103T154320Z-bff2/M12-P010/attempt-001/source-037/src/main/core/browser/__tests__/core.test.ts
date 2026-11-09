import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { BrowserArtifacts, browserDigest } from '../artifacts';
import { BrowserOperations } from '../operations';
import { BrowserPageQueue } from '../queue';
import { helperError } from '../errors';

describe('S1 operation receipts', () => {
  const create = () => { const db = new Database(':memory:'); db.exec(readFileSync('drizzle/0030_browser_operations.sql', 'utf8')); return { db, store: new BrowserOperations(db) }; };
  it('keeps progress, scopes lookup to the run, and never re-dispatches the same request', () => {
    const { db, store } = create();
    try {
      expect(store.begin('run-a','req','task','page','type').replay).toBe(false);
      store.update('run-a','req','running','unknown',{ progress: { confirmedChars: 2000, inFlight: { offset: 2000, length: 2000 } } });
      expect(store.begin('run-a','req','task','page','type')).toMatchObject({ replay: true, operation: { state: 'running' } });
      expect(store.get('run-b','req')).toBeNull();
      expect(JSON.parse(store.get('run-a','req')!.progress!)).toMatchObject({ confirmedChars: 2000 });
      expect(store.receipt('run-a','req')).toMatchObject({requestId:'req',state:'unknown',effectState:'unknown',progress:{confirmedChars:2000,inFlight:{offset:2000,length:2000}}});
      expect(store.receipt('run-b','req')).toEqual({state:'not-found'});
      expect(() => store.begin('run-a','req','other-task','page','type')).toThrow();
    } finally { db.close(); }
  });
  it('recovers interrupted work as unknown and purges records older than seven days', () => {
    const { db, store } = create();
    try {
      store.begin('run','new','task','page','click'); store.begin('run','old','task','page','click');
      db.prepare('UPDATE browser_operations SET created_at=? WHERE request_id=?').run(0,'old');
      const now = Date.now(); store.recover(now);
      expect(store.get('run','old')).toBeNull();
      expect(store.get('run','new')).toMatchObject({ state: 'unknown', effect_state: 'unknown', updated_at: now });
      store.recover(now); expect(db.prepare('SELECT count(*) n FROM browser_operations').get()).toEqual({ n: 1 });
    } finally { db.close(); }
  });
  it('keeps oversized receipt summaries valid JSON without cutting UTF-8 or pretending they are complete', () => {
    const { db, store } = create();
    try {
      const summary = { value: '中'.repeat(30000) }, json = JSON.stringify(summary);
      store.begin('run','large','task','page','eval');
      store.update('run','large','succeeded','completed',{ summary });
      const saved = store.get('run','large')!.summary!;
      expect(Buffer.byteLength(saved)).toBeLessThanOrEqual(65536);
      expect(JSON.parse(saved)).toEqual({ omitted: true, bytes: Buffer.byteLength(json), sha256: browserDigest(json) });
    } finally { db.close(); }
  });
});

describe('S1 page queues', () => {
  it('serializes a page, checks admission again after queueing, and leaves other pages independent', async () => {
    const one = new BrowserPageQueue(), two = new BrowserPageQueue(), events: string[] = [];
    let finish!: () => void, paused = false;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const first = one.run(() => {}, async () => { events.push('first'); await gate; events.push('end'); });
    const second = one.run(() => { if (paused) throw Error('revoked'); }, async () => events.push('must-not-run'));
    const rejected = expect(second).rejects.toThrow('revoked');
    await two.run(() => {}, async () => events.push('other-page'));
    paused = true; finish(); await first; await rejected;
    expect(events).toEqual(['first','other-page','end']);
  });
  it('rejects aborted/closed queued commands before invoking their work', async () => {
    const queue = new BrowserPageQueue(), abort = new AbortController(); abort.abort(Error('cancelled'));
    await expect(queue.run(() => {}, async () => { throw Error('ran'); }, abort.signal)).rejects.toThrow('cancelled');
    queue.close(); await expect(queue.run(() => {}, async () => 'ran')).rejects.toMatchObject({ code: 'BROWSER_TAB_CLOSED' });
  });
  it('cancels queued work immediately and does not resurrect it when admission is restored', async () => {
    const queue = new BrowserPageQueue(), events: string[] = [];
    let finish!: () => void;
    const first = queue.run(() => {}, async () => { await new Promise<void>(resolve => { finish = resolve; }); events.push('running-write-finished'); });
    await Promise.resolve();
    const queued = queue.run(() => {}, async () => { events.push('cancelled-write-ran'); });
    const rejected = expect(queued).rejects.toThrow('paused');
    queue.cancelQueued(Error('paused'));
    await rejected; // The active write still holds the gate here.
    const afterResume = queue.run(() => {}, async () => { events.push('new-write'); });
    finish(); await first; await afterResume;
    expect(events).toEqual(['running-write-finished','new-write']);
  });
  it('aborts a pending caller without waiting for the active command to finish', async () => {
    const queue = new BrowserPageQueue(), controller = new AbortController();
    let finish!: () => void;
    const first = queue.run(() => {}, () => new Promise<void>(resolve => { finish = resolve; }));
    await Promise.resolve();
    let ran = false;
    const queued = queue.run(() => {}, async () => { ran = true; }, controller.signal);
    const rejected = expect(queued).rejects.toThrow('caller gone');
    controller.abort(Error('caller gone')); await rejected;
    finish(); await first; await queue.settled(); expect(ran).toBe(false);
  });
});

describe('S1 artifacts and helper errors', () => {
  it('writes complete files with verifiable hashes while keeping a bounded UTF-8 preview', async () => {
    const root = await mkdtemp(join(tmpdir(),'wy-browser-artifacts-'));
    try {
      const store = new BrowserArtifacts(root), data = { text: '中'.repeat(300000) };
      const result = await store.result('task-1','snapshot',data) as { file: { path: string; bytes: number; sha256: string }; truncatedPreview: string };
      const bytes = await readFile(result.file.path);
      expect(JSON.parse(bytes.toString())).toEqual(data); expect(result.file.sha256).toBe(browserDigest(bytes));
      expect(result.file.bytes).toBe(bytes.length); expect(Buffer.byteLength(result.truncatedPreview)).toBeLessThanOrEqual(4096);
      expect(result.truncatedPreview).not.toContain('\uFFFD');
      await store.write('task-1','screenshot','png',Buffer.from('second file'));
      expect(await store.result('task-1','snapshot',{ text: 'small' })).toEqual({ text: 'small' });
      await symlink(root,join(root,'task-link'));
      await expect(store.write('task-link','snapshot','txt',Buffer.from('x'))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
      await expect(store.write('../foreign','snapshot','txt',Buffer.from('x'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    } finally { await rm(root,{recursive:true,force:true}); }
  });
  it.each(['unknown ref @e4','ref not found','element not found: @e4','Could not locate element with role=button and name=Old'])('maps fixed-version stale-ref error %s', message => {
    expect(helperError(message).code).toBe('BROWSER_STALE_REF');
  });
});

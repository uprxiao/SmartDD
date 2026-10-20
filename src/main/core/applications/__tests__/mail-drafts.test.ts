import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApplicationError } from '@shared/applications';
import type { MailActor, MailDraftContent } from '@shared/mail-drafts';
import * as schema from '../../../db/schema';
import { runBundledMigrations } from '../../../db/migrations';
import { SecretsStore } from '../../../secrets';
import { ResourceStore } from '../resource-store';
import { ApplicationSelectionService } from '../selection-service';
import { ApplicationConnectionService } from '../connection-service';
import { MailBlobStore, type MailPolicy } from '../mail-blob-store';
import { MailDraftService } from '../mail-draft-service';
let root: string, sqlite: Database.Database, store: ResourceStore, selection: ApplicationSelectionService, policy: MailPolicy, blobs: MailBlobStore, drafts: MailDraftService;
const claude: MailActor = { projectId: 'p1',taskId: 'fixture-claude-task' },codex: MailActor = { projectId: 'p1',taskId: 'fixture-codex-task' },other: MailActor = { projectId: 'p2',taskId: null };
const content = (over: Partial<MailDraftContent> = {}): MailDraftContent => ({ mode: 'new',sourceMessageRef: null,senderConnectionId: null,to: [],cc: [],bcc: [],subject: '',text: '',html: null,inReplyTo: null,references: [],attachmentIds: [],...over });
const create = (body = content()) => ({ operationId: randomUUID(),content: body });
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(),'willyou-m10-drafts-')); sqlite = new Database(join(root,'business.sqlite')); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite);
  for (const id of ['p1','p2']) sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run(id,'same display name');
  store = new ResourceStore(sqlite,join(root,'capabilities')); const db = drizzle(sqlite,{ schema });
  const secrets = new SecretsStore(db,{ isAvailable: () => true,encrypt: s => Buffer.from(s),decrypt: b => b.toString() });
  const connections = new ApplicationConnectionService(store,secrets,{ verify: async () => { throw new Error('no provider should be called by draft operations'); } });
  selection = new ApplicationSelectionService(store,connections,{ requireProject: id => { if (!sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) throw new ApplicationError('NOT_FOUND','missing project'); },stopProjectRuns: async () => true,runningInProject: () => 0 });
  await selection.setAdded('mail',true,0);
  for (const projectId of ['p1','p2']) await selection.select({ projectId,appId: 'mail',enabled: true,expectedRevision: 0,connections: { foxmail: null,smtp: null } });
  // Actor labels are host-supplied unit fixtures, not real CLI loading evidence.
  policy = { requireDrafts: actor => { selection.requireEnabled(actor.projectId,'mail'); } };
  blobs = new MailBlobStore(store,join(root,'app-data','mail'),policy); drafts = new MailDraftService(store,blobs,policy);
});
afterEach(() => { sqlite.close(); rmSync(root,{ recursive: true,force: true }); });
describe('persistent drafts with empty bindings, immutable revisions and stable business attachments', () => {
  it('saves incomplete drafts without any SMTP or reading source and reopens the same ID after database restart', async () => {
    const saved = await drafts.create(claude,create(content({ subject: 'durable fixture',text: 'saved across agents' })));
    expect(saved).toMatchObject({ revision: 1,state: 'draft',sourceTaskId: claude.taskId,content: { senderConnectionId: null } });
    expect(selection.projectSettings('p1','mail').connections).toEqual({ foxmail: null,smtp: null }); sqlite.close(); sqlite = new Database(join(root,'business.sqlite')); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite);
    const reopened = new ResourceStore(sqlite,join(root,'capabilities'));
    const secrets = new SecretsStore(drizzle(sqlite,{ schema }),{ isAvailable: () => true,encrypt: s => Buffer.from(s),decrypt: b => b.toString() });
    selection = new ApplicationSelectionService(reopened,new ApplicationConnectionService(reopened,secrets,{ verify: async () => { throw new Error('no provider'); } }),{ requireProject: id => { if (!sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) throw new ApplicationError('NOT_FOUND','missing project'); },stopProjectRuns: async () => true,runningInProject: () => 0 });
    const nextBlobs = new MailBlobStore(reopened,join(root,'app-data','mail'),policy);
    expect(new MailDraftService(reopened,nextBlobs,policy).get(codex,saved.id)).toEqual(saved);
  });
  it('deduplicates the same mutation ID and refuses reusing it for changed content', async () => {
    const input = create(), a = await drafts.create(claude,input), b = await drafts.create(codex,input); expect(b).toEqual(a);
    await expect(drafts.create(claude,{ ...input,content: content({ subject: 'different' }) })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' }); expect(drafts.list(claude).items).toHaveLength(1);
  });
  it('allows two supported actor contexts to continue one draft while rejecting a stale concurrent update', async () => {
    const saved = await drafts.create(claude,create(content({ text: 'revision one' })));
    const results = await Promise.allSettled([drafts.update(claude,{ operationId: randomUUID(),draftId: saved.id,expectedRevision: 1,content: content({ text: 'A' }) }),drafts.update(codex,{ operationId: randomUUID(),draftId: saved.id,expectedRevision: 1,content: content({ text: 'B' }) })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult; expect(failed.reason).toMatchObject({ code: 'REVISION_CONFLICT' }); expect(failed.reason.message).toContain('2');
    expect(drafts.get(codex,saved.id).revision).toBe(2); expect(drafts.get(codex,saved.id,1).content.text).toBe('revision one');
  });
  it('returns the original update receipt on retry without creating an extra revision', async () => {
    const saved = await drafts.create(claude,create()), input = { operationId: randomUUID(),draftId: saved.id,expectedRevision: 1,content: content({ subject: 'one mutation' }) };
    const updated = await drafts.update(codex,input); expect(await drafts.update(claude,input)).toEqual(updated);
    expect(sqlite.prepare('SELECT count(*) AS n FROM mail_draft_revisions').get()).toEqual({ n: 2 });
  });
  it('enforces project identity and current application policy for bodies, mutations and attachments', async () => {
    const saved = await drafts.create(claude,create()); expect(() => drafts.get(other,saved.id)).toThrow(/当前项目/);
    await expect(drafts.update(other,{ operationId: randomUUID(),draftId: saved.id,expectedRevision: 1,content: content() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(drafts.copyAsNew(other,saved.id,1,randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' }); expect(drafts.list(other).items).toEqual([]);
    const binding = selection.projectSettings('p1','mail'); await selection.select({ projectId: 'p1',appId: 'mail',enabled: false,expectedRevision: binding.revision,connections: { foxmail: null,smtp: null } });
    expect(() => drafts.get(claude,saved.id)).toThrow(); await expect(drafts.create(claude,create())).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });
  it('keeps a stable attachment copy after its original source and unrelated rebuildable cache are removed', async () => {
    const original = join(root,'user-source.txt'); writeFileSync(original,'stable attachment fixture');
    const attachment = await blobs.save(claude,{ operationId: randomUUID(),filename: 'source.txt',contentType: 'text/plain' },readFileSync(original));
    const saved = await drafts.create(claude,create(content({ attachmentIds: [attachment.id] }))); rmSync(original);
    const cache = join(root,'cache','mail'); mkdirSync(cache,{ recursive: true }); writeFileSync(join(cache,'rebuildable.tmp'),'discard'); rmSync(cache,{ recursive: true });
    expect(blobs.read(codex,attachment.id).toString()).toBe('stable attachment fixture'); expect(drafts.get(codex,saved.id).attachments[0]).toEqual(attachment); expect(readdirSync(join(blobs.root,'staging'))).toEqual([]);
  });
  it('deduplicates identical bytes without granting another project access to an attachment ID', async () => {
    const a = await blobs.save(claude,{ operationId: randomUUID(),filename: 'a.txt',contentType: 'text/plain' },Buffer.from('shared bytes'));
    const b = await blobs.save(other,{ operationId: randomUUID(),filename: 'b.txt',contentType: 'text/plain' },Buffer.from('shared bytes'));
    expect(a.contentHash).toBe(b.contentHash); expect(a.id).not.toBe(b.id); expect(readdirSync(join(blobs.root,'blobs'))).toHaveLength(1); expect(readdirSync(join(blobs.root,'staging'))).toEqual([]);
    expect(() => blobs.read(other,a.id)).toThrow(/当前项目/); expect(blobs.read(other,b.id).toString()).toBe('shared bytes');
    await expect(drafts.create(other,create(content({ attachmentIds: [a.id] })))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('refuses corrupt attachment bytes before saving a draft or displaying them as usable', async () => {
    const a = await blobs.save(claude,{ operationId: randomUUID(),filename: 'a.txt',contentType: 'text/plain' },Buffer.from('original')); writeFileSync(join(blobs.root,'blobs',a.contentHash),'tampered');
    expect(() => blobs.read(claude,a.id)).toThrow(/损坏/); await expect(drafts.create(claude,create(content({ attachmentIds: [a.id] })))).rejects.toMatchObject({ code: 'HASH_MISMATCH' }); expect(drafts.list(claude).items).toEqual([]);
  });
  it.each(['staged','published'] as const)('recovers a private blob interrupted after %s without inventing a saved draft', async phase => {
    const failing = new MailBlobStore(store,blobs.root,policy,at => { if (at === phase) throw new Error('synthetic interruption'); });
    const input = { operationId: randomUUID(),filename: 'recover.txt',contentType: 'text/plain' };
    await expect(failing.save(claude,input,Buffer.from('recoverable fixture'))).rejects.toThrow('synthetic interruption');
    expect(sqlite.prepare('SELECT * FROM mail_attachment_objects').all()).toHaveLength(0); expect(drafts.list(claude).items).toEqual([]);
    expect(await blobs.recover()).toEqual({ recovered: [input.operationId],pending: [] }); const saved = await blobs.save(claude,input,Buffer.from('recoverable fixture')); expect(blobs.read(codex,saved.id).toString()).toBe('recoverable fixture');
  });
  it('keeps sent, sending and unknown revisions immutable and copies content to a new draft ID', async () => {
    const saved = await drafts.create(claude,create(content({ subject: 'original revision' })));
    // State setup only; this test does not claim an SMTP execution happened.
    for (const state of ['sending','sent','unknown']) {
      sqlite.prepare('UPDATE mail_drafts SET state=? WHERE id=?').run(state,saved.id);
      await expect(drafts.update(codex,{ operationId: randomUUID(),draftId: saved.id,expectedRevision: 1,content: content({ text: 'mutate sent content' }) })).rejects.toMatchObject({ code: 'DRAFT_LOCKED' });
      const copy = await drafts.copyAsNew(codex,saved.id,1,randomUUID()); expect(copy.id).not.toBe(saved.id); expect(copy).toMatchObject({ copiedFromDraftId: saved.id,state: 'draft',revision: 1,contentHash: saved.contentHash });
    }
    expect(drafts.get(claude,saved.id).content).toEqual(saved.content);
  });
  it('paginates light summaries without bodies and rejects extra authority/state fields', async () => {
    for (let i = 0; i < 3; i++) await drafts.create(claude,create(content({ subject: 'fixture ' + i,text: 'not in list response' })));
    const first = drafts.list(claude,2); expect(first.items).toHaveLength(2); expect(first.nextCursor).toBeTruthy(); const second = drafts.list(claude,2,first.nextCursor!); expect(second.items).toHaveLength(1); expect(new Set([...first.items,...second.items].map(r => r.id)).size).toBe(3); expect(JSON.stringify(first)).not.toContain('not in list response');
    await expect(drafts.create(claude,{ ...create(),approved: true,state: 'sent' } as unknown as Parameters<MailDraftService['create']>[1])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(() => drafts.list(claude,201)).toThrow();
  });
});

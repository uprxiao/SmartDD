import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Socket } from 'node:net';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '@shared/applications';
import type { ConnectionConfig, ApplicationConnection } from '@shared/application-connections';
import type { MailDraftContent } from '@shared/mail-drafts';
import type { MailSendActor, MailSendIntent, VerifiedMailUserAction } from '@shared/mail-execution';
import * as schema from '../../../db/schema';
import { runBundledMigrations } from '../../../db/migrations';
import { SecretsStore } from '../../../secrets';
import { ResourceStore } from '../resource-store';
import { ApplicationConnectionService } from '../connection-service';
import { ApplicationSelectionService } from '../selection-service';
import { MailBlobStore } from '../mail-blob-store';
import { MailDraftService } from '../mail-draft-service';
import { MailExecutionService, type MailSendPolicy, type MailExecutionOptions } from '../mail-execution-service';
import { submitSmtp,verifySmtp } from '../providers/smtp';
let root: string,sqlite: Database.Database,store: ResourceStore,connections: ApplicationConnectionService,selections: ApplicationSelectionService,drafts: MailDraftService,blobs: MailBlobStore,service: MailExecutionService,smtp: ApplicationConnection,policy: MailSendPolicy;
let submit: ReturnType<typeof vi.fn<typeof submitSmtp>>, owner: 'running' | 'stopped' | 'unknown';
const fixtures: (() => Promise<void>)[] = [];
const events = new Map<string,VerifiedMailUserAction>(), live = new Set<string>(), services: MailExecutionService[] = [];
const actor: MailSendActor = { projectId: 'p1',taskId: 'fixture-task-1',runId: 'fixture-run-1' };
const config = (): Extract<ConnectionConfig,{ kind: 'smtp' }> => ({ kind: 'smtp',host: 'smtp-fixture.example.test',port: 2525,username: 'sender@example.test',fromAddress: 'sender@example.test',authMode: 'password',mode: 'plain' });
const body = (over: Partial<MailDraftContent> = {}): MailDraftContent => ({ mode: 'new',sourceMessageRef: null,senderConnectionId: null,to: ['receiver@example.test'],cc: [],bcc: ['private@example.test'],subject: 'isolated execution fixture',text: 'exact body',html: null,inReplyTo: null,references: [],attachmentIds: [],...over });
function make(options: MailExecutionOptions = {},resource = store) { const s = new MailExecutionService(resource,drafts,connections,selections,policy,{ submit,...options }); services.push(s); return s; }
async function prepare(over: Partial<MailDraftContent> = {},target = service) {
  const draft = await drafts.create(actor,{ operationId: randomUUID(),content: body(over) });
  const input = { operationId: randomUUID(),draftId: draft.id,expectedRevision: draft.revision,expectedContentHash: draft.contentHash };
  return { draft,input,intent: await target.prepare(actor,input) };
}
function event(intent: MailSendIntent,over: Partial<VerifiedMailUserAction> = {}): string {
  const id = randomUUID(),now = Date.now();
  const value: VerifiedMailUserAction = { id,source: 'renderer-confirmation',sourceHash: 'a'.repeat(64),intentId: intent.id,reviewHash: intent.reviewHash!,projectId: actor.projectId,taskId: actor.taskId,runId: actor.runId,createdAt: new Date(now).toISOString(),expiresAt: new Date(now + 600000).toISOString(),reviewedUnknownExecutionIds: [],...over };
  events.set(id,value); return id;
}
async function authorize(intent: MailSendIntent,target = service,over: Partial<VerifiedMailUserAction> = {}) { const ref = event(intent,over); await target.authorize(actor,intent.id,ref); return ref; }
beforeEach(async () => {
  events.clear(); live.clear(); live.add(actor.runId!); owner = 'unknown'; root = mkdtempSync(join(tmpdir(),'willyou-m10-send-')); sqlite = new Database(join(root,'state.sqlite')); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite);
  for (const id of ['p1','p2']) sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run(id,'same visible name');
  store = new ResourceStore(sqlite,join(root,'capabilities'));
  // A fake cipher/verifier isolates orchestration; transport is tested separately with real local servers.
  const secrets = new SecretsStore(drizzle(sqlite,{ schema }),{ isAvailable: () => true,encrypt: s => Buffer.from([...s].reverse().join('')),decrypt: b => [...b.toString()].reverse().join('') });
  connections = new ApplicationConnectionService(store,secrets,{ verify: async (c,secret,signal) => c.kind === 'smtp' && c.host === '127.0.0.1' ? verifySmtp(c,secret,signal) : ({ providerId: c.kind,serviceId: 'smtp-fixture-service',accountId: c.kind === 'foxmail' ? c.account : c.username,contractMajor: 1 }) });
  smtp = await connections.save({ expectedRevision: 0,name: 'isolated SMTP',config: config(),secret: 'fixture-first-secret' });
  selections = new ApplicationSelectionService(store,connections,{ requireProject: id => { if (!sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) throw new ApplicationError('NOT_FOUND','fixture project'); },stopProjectRuns: async () => true,runningInProject: () => 0 });
  await selections.setAdded('mail',true,0);
  for (const projectId of ['p1','p2']) await selections.select({ projectId,appId: 'mail',enabled: true,expectedRevision: 0,connections: { foxmail: null,smtp: smtp.id } });
  policy = { authenticate:(_actor,connection)=>connections.authentication(connection.id,connection),requireDrafts: a => { selections.requireApplicationEnabled(a.projectId,'mail'); },requireSend: a => { selections.requireApplicationEnabled(a.projectId,'mail'); if (a.runId && !live.has(a.runId)) throw new ApplicationError('SCOPE_DENIED','fixture run stopped'); },verifyUserAction: (_actor,ref) => { const proof = events.get(ref); if (!proof) throw new Error('no trusted fixture event'); return proof; },ownerState: () => owner };
  blobs = new MailBlobStore(store,join(root,'app-data','mail'),policy); drafts = new MailDraftService(store,blobs,policy);
  submit = vi.fn(async (_config,_secret,frozen) => ({ state: 'server-accepted',complete: true,accepted: [...frozen.envelope.to],rejected: [],errorCode: null,smtpCode: 250,messageId: frozen.messageId })); service = make();
});
afterEach(async () => { for (const s of services.splice(0)) await s.dispose(); for (const close of fixtures.splice(0)) await close(); vi.restoreAllMocks(); sqlite.close(); rmSync(root,{ recursive: true,force: true }); });
async function localSmtp(loseReceipt: boolean) {
  const sockets = new Set<Socket>(),messages: Buffer[] = []; let authentications = 0;
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error',() => {}); socket.once('close',() => sockets.delete(socket)); socket.write('220 isolated execution SMTP\r\n'); let buffer = '',data = false,lines: string[] = [];
    socket.on('data',chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const at = buffer.indexOf('\r\n'),line = buffer.slice(0,at); buffer = buffer.slice(at + 2);
        if (data) { if (line === '.') { messages.push(Buffer.from(lines.join('\r\n') + '\r\n')); lines = []; data = false; if (loseReceipt) socket.destroy(); else socket.write('250 accepted isolated fixture\r\n'); } else lines.push(line.startsWith('..') ? line.slice(1) : line); continue; }
        if (line.startsWith('EHLO')) socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH PLAIN ')) { const auth = Buffer.from(line.slice(11),'base64').toString().split('\0'); if (auth.at(-2) === 'sender@example.test' && auth.at(-1) === 'fixture-live-password') { authentications++; socket.write('235 authenticated\r\n'); } else socket.write('535 rejected fixture\r\n'); }
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) socket.write('250 ok\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 data\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n'); else socket.write('500 unsupported\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('local fixture');
  fixtures.push(async () => { for (const s of sockets) s.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { port: address.port,messages,authentications: () => authentications };
}
describe('durable specific mail intents and one-attempt execution', () => {
  it('freezes BCC/content/attachments with no send and rejects a model approval assertion', async () => {
    const attachment = await blobs.save(actor,{ operationId: randomUUID(),filename: 'proof.txt',contentType: 'text/plain' },Buffer.from('stable attachment'));
    const { intent,draft,input } = await prepare({ attachmentIds: [attachment.id] });
    expect(intent).toMatchObject({ state: 'awaiting-authorization',authorized: false,review: { draftId: draft.id,draftRevision: 1,fromAddress: config().fromAddress,content: { bcc: ['private@example.test'] },attachments: [{ contentHash: attachment.contentHash }] } });
    expect(submit).not.toHaveBeenCalled(); await expect(service.execute(actor,intent.id)).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
    await expect(service.authorize(actor,intent.id,'approved=true')).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
    await expect(service.prepare(actor,{ ...input,approved: true } as unknown as typeof input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(drafts.update(actor,{ operationId: randomUUID(),draftId: draft.id,expectedRevision: 1,content: body({ text: 'changed' }) })).rejects.toMatchObject({ code: 'DRAFT_LOCKED' });
    const rawId = (sqlite.prepare('SELECT raw_object_id FROM mail_send_intents WHERE id=?').get(intent.id) as { raw_object_id: string }).raw_object_id;
    expect(() => blobs.read(actor,rawId)).toThrow(/当前项目/); expect(blobs.readMessage(actor,rawId).toString()).not.toMatch(/^Bcc:/mi);
  });
  it('returns one preparation identity on duplicate requests and releases invalid incomplete preparation', async () => {
    const { intent,input } = await prepare(); expect((await service.prepare(actor,input)).id).toBe(intent.id);
    await expect(service.prepare(actor,{ ...input,expectedContentHash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const incomplete = await drafts.create(actor,{ operationId: randomUUID(),content: body({ to: [],bcc: [] }) });
    await expect(service.prepare(actor,{ operationId: randomUUID(),draftId: incomplete.id,expectedRevision: 1,expectedContentHash: incomplete.contentHash })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(drafts.get(actor,incomplete.id).activeIntentId).toBeNull(); expect(submit).not.toHaveBeenCalled();
  });
  it('persists the claim and consumes the exact proof before invoking the provider exactly once', async () => {
    const { intent,draft } = await prepare(); await authorize(intent);
    submit.mockImplementationOnce(async (_c,secret,frozen) => {
      expect(secret).toBe('fixture-first-secret'); expect(sqlite.prepare('SELECT state FROM mail_send_executions').get()).toEqual({ state: 'executing' }); expect(sqlite.prepare('SELECT state FROM mail_send_grants').get()).toEqual({ state: 'used' }); expect(drafts.get(actor,draft.id).state).toBe('sending');
      return { state: 'server-accepted',complete: true,accepted: [...frozen.envelope.to],rejected: [],errorCode: null,smtpCode: 250,messageId: frozen.messageId };
    });
    const result = await service.execute(actor,intent.id); expect(result).toMatchObject({ state: 'server-accepted',result: { complete: true } }); expect(submit).toHaveBeenCalledTimes(1); expect(await service.execute(actor,intent.id)).toEqual(result); expect(submit).toHaveBeenCalledTimes(1);
    expect(drafts.get(actor,draft.id)).toMatchObject({ state: 'sent',activeIntentId: null,lastExecutionId: result.executionId });
    const persisted = JSON.stringify(sqlite.prepare('SELECT * FROM mail_send_intents').all()) + JSON.stringify(sqlite.prepare('SELECT * FROM mail_send_grants').all()) + JSON.stringify(sqlite.prepare('SELECT * FROM mail_send_executions').all()) + JSON.stringify(result);
    expect(persisted).not.toContain('fixture-first-secret'); expect(persisted).not.toContain('secret_ref');
  });
  it('does not submit a second request while the first execution is still pending', async () => {
    const { intent } = await prepare(); await authorize(intent); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    submit.mockImplementationOnce(async (_c,_s,frozen) => { await gate; return { state: 'server-accepted',complete: true,accepted: frozen.envelope.to,rejected: [],errorCode: null,smtpCode: 250,messageId: frozen.messageId }; });
    const first = service.execute(actor,intent.id); await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(await service.execute(actor,intent.id)).toMatchObject({ state: 'executing',result: null }); release(); expect((await first).state).toBe('server-accepted'); expect(submit).toHaveBeenCalledTimes(1);
  });
  it('uses a newly rotated secret for the same verified identity without changing the frozen review', async () => {
    const { intent } = await prepare(); await authorize(intent);
    const changed = await connections.save({ id: smtp.id,expectedRevision: smtp.revision,name: smtp.name,config: smtp.config,secret: 'fixture-rotated-secret' });
    expect(changed.configRevision).toBe(smtp.configRevision); expect(changed.identityRevision).toBe(smtp.identityRevision);
    expect((await service.execute(actor,intent.id)).state).toBe('server-accepted'); expect(submit.mock.calls[0][1]).toBe('fixture-rotated-secret'); expect(service.get(actor,intent.id).reviewHash).toBe(intent.reviewHash);
  });
  it.each(['config','binding','disable-enable','disconnect'] as const)('invalidates an approved intent after %s changes without submitting', async kind => {
    const { intent } = await prepare(); await authorize(intent);
    if (kind === 'config') await connections.save({ id: smtp.id,expectedRevision: smtp.revision,name: smtp.name,config: { ...config(),fromAddress: 'other-sender@example.test' } });
    else if (kind === 'binding') { const b = selections.projectSettings('p1','mail'); await selections.select({ projectId: 'p1',appId: 'mail',expectedRevision: b.revision,enabled: true,connections: { foxmail: null,smtp: null } }); }
    else if (kind === 'disable-enable') { const disabled = await connections.setEnabled(smtp.id,false,smtp.revision); await connections.setEnabled(smtp.id,true,disabled.revision); }
    else await connections.disconnect(smtp.id,smtp.revision);
    await expect(service.execute(actor,intent.id)).rejects.toMatchObject({ code: 'INTENT_STALE' }); expect(service.get(actor,intent.id).state).toBe('stale'); expect(drafts.get(actor,intent.draftId).activeIntentId).toBeNull(); expect(submit).not.toHaveBeenCalled();
  });
  it('keeps SMTP intent usable when only the independent reading slot changes or becomes unavailable', async () => {
    const { intent } = await prepare(); await authorize(intent); const before = selections.connectionSlot('p1','mail','smtp');
    const source = await connections.save({ expectedRevision: 0,name: 'fixture local source',config: { kind: 'foxmail',sourcePath: join(root,'synthetic-account'),account: 'mailbox-fixture',queryDays: 30 } });
    const binding = selections.projectSettings('p1','mail'); await selections.select({ projectId: 'p1',appId: 'mail',enabled: true,expectedRevision: binding.revision,connections: { foxmail: source.id,smtp: smtp.id } });
    expect(selections.connectionSlot('p1','mail','smtp').revision).toBe(before.revision); expect(selections.connectionSlot('p1','mail','foxmail').revision).toBeGreaterThan(0);
    // Inject a read-slot identity fault. It must not grant read access or break local drafts/SMTP.
    sqlite.prepare('UPDATE application_connections SET identity_revision=identity_revision+1 WHERE id=?').run(source.id);
    expect(() => selections.connectionSlot('p1','mail','foxmail')).toThrow(/身份/); expect(drafts.get(actor,intent.draftId).id).toBe(intent.draftId);
    expect((await service.execute(actor,intent.id)).state).toBe('server-accepted'); expect(submit).toHaveBeenCalledTimes(1);
  });
  it.each(['clear-reselect','global-disable-enable'] as const)('does not resurrect an old grant after %s returns to the same account', async mode => {
    const { intent } = await prepare(); await authorize(intent); const old = selections.connectionSlot('p1','mail','smtp').revision;
    if (mode === 'clear-reselect') {
      let b = selections.projectSettings('p1','mail'); await selections.select({ projectId: 'p1',appId: 'mail',enabled: true,expectedRevision: b.revision,connections: { foxmail: null,smtp: null } });
      b = selections.projectSettings('p1','mail'); await selections.select({ projectId: 'p1',appId: 'mail',enabled: true,expectedRevision: b.revision,connections: { foxmail: null,smtp: smtp.id } });
    } else { const c = selections.catalogState('mail'),disabled = await selections.setGlobalEnabled('mail',false,c.revision); await selections.setGlobalEnabled('mail',true,disabled.revision); }
    expect(selections.connectionSlot('p1','mail','smtp').revision).toBeGreaterThan(old); await expect(service.execute(actor,intent.id)).rejects.toMatchObject({ code: 'INTENT_STALE' }); expect(submit).not.toHaveBeenCalled();
  });
  it('does not display or use an expired grant and does not accept a modified frozen envelope', async () => {
    const first = await prepare(); await authorize(first.intent); const now = Date.now(); vi.spyOn(Date,'now').mockReturnValue(now + 700000);
    expect(service.get(actor,first.intent.id).authorized).toBe(false); await expect(service.execute(actor,first.intent.id)).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' }); vi.restoreAllMocks();
    const second = await prepare(); await authorize(second.intent); sqlite.prepare('UPDATE mail_send_intents SET envelope_json=? WHERE id=?').run(JSON.stringify({ from: config().fromAddress,to: ['unapproved@example.test'] }),second.intent.id);
    await expect(service.execute(actor,second.intent.id)).rejects.toMatchObject({ code: 'HASH_MISMATCH' }); expect(submit).not.toHaveBeenCalled();
  });
  it.each([false,true])('runs the full connection/freeze/claim/SMTP chain with receipt loss=%s on loopback only', async loseReceipt => {
    const fixture = await localSmtp(loseReceipt),connection = await connections.save({ expectedRevision: 0,name: 'actual isolated loopback SMTP',config: { ...config(),host: '127.0.0.1',port: fixture.port },secret: 'fixture-live-password' });
    const b = selections.projectSettings('p1','mail'); await selections.select({ projectId: 'p1',appId: 'mail',enabled: true,expectedRevision: b.revision,connections: { foxmail: null,smtp: connection.id } });
    const real = make({ submit: submitSmtp }),{ intent } = await prepare({},real); await authorize(intent,real);
    const rawId = (sqlite.prepare('SELECT raw_object_id FROM mail_send_intents WHERE id=?').get(intent.id) as { raw_object_id: string }).raw_object_id,raw = blobs.readMessage(actor,rawId);
    expect(fixture.messages).toHaveLength(0); const result = await real.execute(actor,intent.id);
    expect(result.state).toBe(loseReceipt ? 'unknown' : 'server-accepted'); expect(fixture.messages).toHaveLength(1); expect(fixture.messages[0]).toEqual(raw); expect(fixture.authentications()).toBe(2);
    events.clear(); expect(await real.execute(actor,intent.id)).toEqual(result); expect(fixture.messages).toHaveLength(1); expect(submit).not.toHaveBeenCalled();
  });
  it('binds evidence to scope, revision and live provenance and prevents using one event for another intent', async () => {
    const a = await prepare(), b = await prepare(); const ref = event(a.intent);
    await expect(service.authorize(actor,b.intent.id,ref)).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
    const unstable = event(a.intent,{ id: 'different-canonical-evidence-id' }); await expect(service.authorize(actor,a.intent.id,unstable)).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
    const wrong = event(a.intent,{ projectId: 'p2' }); await expect(service.authorize(actor,a.intent.id,wrong)).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
    const expired = event(a.intent,{ expiresAt: new Date(Date.now() - 1000).toISOString() }); await expect(service.authorize(actor,a.intent.id,expired)).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
    await service.authorize(actor,a.intent.id,ref); events.delete(ref); await expect(service.execute(actor,a.intent.id)).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' }); expect(submit).not.toHaveBeenCalled();
  });
  it('does not let another run or project execute or invalidate the original run intent', async () => {
    const { intent } = await prepare(); await authorize(intent); live.add('another-run');
    await expect(service.execute({ ...actor,runId: 'another-run' },intent.id)).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(service.authorize({ ...actor,runId: 'another-run' },intent.id,'irrelevant')).rejects.toMatchObject({ code: 'SCOPE_DENIED' }); expect(service.get(actor,intent.id).state).toBe('authorized');
    expect(() => service.get({ ...actor,projectId: 'p2' },intent.id)).toThrow(/当前项目/); expect(submit).not.toHaveBeenCalled();
  });
  it('keeps a canceled intent canceled when a late confirmation or execution arrives', async () => {
    const { intent,draft } = await prepare(); const ref = event(intent); expect((await service.cancel(actor,intent.id)).state).toBe('canceled');
    await expect(service.authorize(actor,intent.id,ref)).rejects.toMatchObject({ code: 'INTENT_STALE' }); await expect(service.execute(actor,intent.id)).rejects.toMatchObject({ code: 'INTENT_STALE' });
    expect(service.get(actor,intent.id).state).toBe('canceled'); expect(drafts.get(actor,draft.id).activeIntentId).toBeNull(); expect(submit).not.toHaveBeenCalled();
  });
  it('preserves partial recipient results and never retries a definitively failed attempt automatically', async () => {
    const a = await prepare(); await authorize(a.intent);
    submit.mockResolvedValueOnce({ state: 'server-accepted',complete: true,accepted: ['receiver@example.test'],rejected: ['private@example.test'],errorCode: null,smtpCode: 250,messageId: a.intent.review!.messageId });
    expect(await service.execute(actor,a.intent.id)).toMatchObject({ state: 'server-accepted',result: { complete: false,rejected: ['private@example.test'] } });
    const b = await prepare(); await authorize(b.intent); submit.mockResolvedValueOnce({ state: 'failed',complete: false,accepted: [],rejected: [],errorCode: 'EAUTH',smtpCode: 535,messageId: b.intent.review!.messageId });
    expect((await service.execute(actor,b.intent.id)).state).toBe('failed'); await expect(service.prepare(actor,{ ...b.input,operationId: randomUUID() })).rejects.toMatchObject({ code: 'EXECUTION_ALREADY_ATTEMPTED' }); expect(submit).toHaveBeenCalledTimes(2);
  });
  it('requires explicit verification provenance for copied unknown content and never repeats the original attempt', async () => {
    const a = await prepare(); await authorize(a.intent); submit.mockResolvedValueOnce({ state: 'unknown',complete: false,accepted: [],rejected: [],errorCode: 'RECEIPT_LOST',smtpCode: null,messageId: a.intent.review!.messageId });
    const result = await service.execute(actor,a.intent.id); expect(result.state).toBe('unknown'); expect(await service.execute(actor,a.intent.id)).toEqual(result); expect(submit).toHaveBeenCalledTimes(1);
    const copy = await drafts.copyAsNew(actor,a.draft.id,1,randomUUID()), intent = await service.prepare(actor,{ operationId: randomUUID(),draftId: copy.id,expectedRevision: 1,expectedContentHash: copy.contentHash }); expect(intent.review!.priorUnknownExecutionIds).toEqual([result.executionId]);
    await expect(service.authorize(actor,intent.id,event(intent))).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' }); expect(submit).toHaveBeenCalledTimes(1);
    // This is trusted-verifier provenance, not a model boolean or a real verification of an external server.
    await authorize(intent,service,{ reviewedUnknownExecutionIds: [result.executionId!] }); expect(service.get(actor,intent.id).state).toBe('authorized');
  });
  it('aborts an in-flight operation when its run ends and retains unknown when the provider ignores cancellation', async () => {
    const { intent } = await prepare(); await authorize(intent); let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
    submit.mockImplementationOnce(async (_c,_s,frozen) => { await gate; return { state: 'server-accepted',complete: true,accepted: frozen.envelope.to,rejected: [],errorCode: null,smtpCode: 250,messageId: frozen.messageId }; });
    const pending = service.execute(actor,intent.id); await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1)); live.delete(actor.runId!); await service.invalidateRun(actor.runId!); expect((await pending).state).toBe('unknown');
    finish(); await Promise.resolve(); expect(service.get(actor,intent.id).state).toBe('unknown'); expect(submit).toHaveBeenCalledTimes(1);
  });
  it('bounds a provider that never finishes and keeps an interrupted claimed attempt unknown on recovery', async () => {
    const bounded = make({ submissionTimeoutMs: 20 }), first = await prepare({},bounded); await authorize(first.intent,bounded); let finish!:()=>void;const held=new Promise<void>(resolve=>finish=resolve);submit.mockImplementationOnce(async()=>{await held;throw new Error('private late provider completion');});
    try{expect((await bounded.execute(actor,first.intent.id)).state).toBe('unknown');}finally{finish();} expect(submit).toHaveBeenCalledTimes(1);
    const interrupted = make({ checkpoint: phase => { if (phase === 'claimed') throw new Error('synthetic host exit before submission'); } }), second = await prepare({},interrupted); await authorize(second.intent,interrupted);
    await expect(interrupted.execute(actor,second.intent.id)).rejects.toThrow('synthetic host exit'); expect(service.get(actor,second.intent.id).state).toBe('executing');
    const next = make({},new ResourceStore(sqlite,join(root,'capabilities'))); expect(await next.recover()).toEqual({ recovered: [],pending: [second.intent.id] }); owner = 'stopped'; expect(await next.recover()).toEqual({ recovered: [second.intent.id],pending: [] });
    expect((await next.execute(actor,second.intent.id)).state).toBe('unknown'); expect(submit).toHaveBeenCalledTimes(1);
  });
  it('retains an interrupted accepted submission as unknown without resubmitting and rejects forged receipts', async () => {
    const interrupted = make({ checkpoint: phase => { if (phase === 'submitted') throw new Error('synthetic exit after provider receipt'); } }), first = await prepare({},interrupted); await authorize(first.intent,interrupted);
    await expect(interrupted.execute(actor,first.intent.id)).rejects.toThrow('synthetic exit'); expect(submit).toHaveBeenCalledTimes(1); owner = 'stopped'; await service.recover(); expect(service.get(actor,first.intent.id).state).toBe('unknown'); await service.execute(actor,first.intent.id); expect(submit).toHaveBeenCalledTimes(1);
    const second = await prepare(); await authorize(second.intent); submit.mockResolvedValueOnce({ state: 'server-accepted',complete: true,accepted: ['outside@example.test'],rejected: [],errorCode: null,smtpCode: 250,messageId: second.intent.review!.messageId });
    expect(await service.execute(actor,second.intent.id)).toMatchObject({ state: 'unknown',result: { errorCode: 'INVALID_RECEIPT' } });
  });
  it('expires abandoned waiting grants only after an outside-lock process proof and preserves unknown owners',async()=>{
    const {intent}=await prepare();await authorize(intent);const original=policy.ownerState;policy.ownerState=()=>{expect(sqlite.inTransaction).toBe(false);expect(existsSync(join(store.root,'locks/resource.lock'))).toBe(false);return owner;};
    const next=make();expect(await next.recover()).toEqual({recovered:[],pending:[intent.id]});expect(next.get(actor,intent.id).authorized).toBe(true);owner='stopped';expect(await next.recover()).toEqual({recovered:[intent.id],pending:[]});expect(next.get(actor,intent.id)).toMatchObject({state:'stale',authorized:false,errorCode:'HOST_INTERRUPTED'});expect(drafts.get(actor,intent.draftId).activeIntentId).toBeNull();expect(sqlite.prepare('SELECT state FROM mail_send_grants').get()).toEqual({state:'revoked'});policy.ownerState=original;expect(submit).not.toHaveBeenCalled();
  });
  it('keeps live prepared work through same-service recovery and revokes its grant on graceful close',async()=>{
    const {intent}=await prepare();await authorize(intent);owner='running';expect(await service.recover()).toEqual({recovered:[],pending:[intent.id]});expect(service.get(actor,intent.id).authorized).toBe(true);await service.dispose();expect(service.get(actor,intent.id)).toMatchObject({state:'stale',authorized:false,errorCode:'HOST_CLOSED'});expect(drafts.get(actor,intent.draftId).activeIntentId).toBeNull();expect(submit).not.toHaveBeenCalled();
  });
  it('cleans a stopped terminal producer lease by exact PID/start identity without rewriting an unknown result',async()=>{
    const {intent}=await prepare();await authorize(intent);submit.mockResolvedValueOnce({state:'unknown',complete:false,accepted:[],rejected:[],errorCode:'PRIVATE_LOST_RECEIPT',smtpCode:null,messageId:intent.review!.messageId});await service.execute(actor,intent.id);
    const row=sqlite.prepare('SELECT owner_pid,owner_started_at FROM mail_send_intents WHERE id=?').get(intent.id) as {owner_pid:number;owner_started_at:string};
    sqlite.exec("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,state,generation,integrity) VALUES('retained-mail-package','application-package','hash','store','C','apps/mail/fixture','ready',1,'valid')");
    const put=sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,'retained-mail-package','mail-send',?,'old-host',?,?,'active','now')");put.run('exact',intent.id,row.owner_pid,row.owner_started_at);put.run('different-birth',intent.id,row.owner_pid,'different process birth');
    const next=make();expect(await next.recover()).toEqual({recovered:[],pending:[intent.id]});owner='stopped';expect(await next.recover()).toEqual({recovered:[intent.id],pending:[]});expect(sqlite.prepare('SELECT lease_id,state FROM capability_resource_leases ORDER BY lease_id').all()).toEqual([{lease_id:'different-birth',state:'active'},{lease_id:'exact',state:'released'}]);expect(next.get(actor,intent.id)).toMatchObject({state:'unknown',result:{errorCode:'PRIVATE_LOST_RECEIPT'}});expect(submit).toHaveBeenCalledOnce();
  });
  it('rejects modified frozen bytes before claiming and closes active operations before disposal returns', async () => {
    const first = await prepare(); await authorize(first.intent); const hash = (sqlite.prepare('SELECT raw_hash FROM mail_send_intents WHERE id=?').get(first.intent.id) as { raw_hash: string }).raw_hash; writeFileSync(join(blobs.root,'blobs',hash),'tampered');
    await expect(service.execute(actor,first.intent.id)).rejects.toMatchObject({ code: 'HASH_MISMATCH' }); expect(sqlite.prepare('SELECT * FROM mail_send_executions').all()).toHaveLength(0);
    const next = await prepare(); await authorize(next.intent); let finish!:()=>void;const held=new Promise<void>(resolve=>finish=resolve);submit.mockImplementationOnce(async()=>{await held;throw new Error('private late provider completion');});const pending = service.execute(actor,next.intent.id); await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    let closed=false;const closing=service.dispose().then(()=>{closed=true;});expect((await pending).state).toBe('unknown');try{expect(closed).toBe(false);}finally{finish();}await closing; await expect(service.execute(actor,next.intent.id)).rejects.toMatchObject({ code: 'CANCELED' });
  });
});

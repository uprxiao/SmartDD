import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it,vi } from 'vitest';
import type { ConnectionConfig, VerifiedConnectionIdentity } from '@shared/application-connections';
import { MailWorkerClient } from '../providers/mail-worker-client';
import type { Worker } from 'node:worker_threads';
import { MacProcessIdentityReader } from '../process-identity';
import { localMailRange } from '../providers/foxmail-source';
let build: string, root: string, worker: string, native: string, client: MailWorkerClient, identityReader:MacProcessIdentityReader, db: Database.Database;
let config: Extract<ConnectionConfig,{ kind: 'foxmail' }>, identity: VerifiedConnectionIdentity;
const now = new Date(2026,9,20,12), signal = () => new AbortController().signal;
const schema = 'CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER)';
function add(id: number,date: Date,body = 'synthetic body',withAttachment = false) {
  const head = `Date: ${date.toUTCString()}\r\nFrom: Sender <sender@example.test>\r\nTo: receiver@example.test\r\nSubject: fixture ${id}\r\nMessage-ID: <fixture-${id}@example.test>\r\nMIME-Version: 1.0\r\n`;
  const raw = withAttachment ? head + `Content-Type: multipart/mixed; boundary="fixture-boundary"\r\n\r\n--fixture-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n--fixture-boundary\r\nContent-Type: text/plain; name="sample.txt"\r\nContent-Disposition: attachment; filename="sample.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('stable fixture attachment').toString('base64')}\r\n--fixture-boundary--\r\n` : head + 'Content-Type: text/plain; charset=utf-8\r\n\r\n' + body;
  writeFileSync(join(root,'Mail','Inbox',id + '.mail'),raw); db.prepare('INSERT INTO mailinfo VALUES(?,?,?,?,?,?,?,?,?)').run(id,'fixture ' + id,'sender@example.test','receiver@example.test','<fixture-' + id + '@example.test>',0,0,1,withAttachment ? 1 : 0);
}
function sourceHashes(folder: string): Record<string,string> { const values: Record<string,string> = {}; for (const e of readdirSync(folder,{ withFileTypes: true })) { const path = join(folder,e.name); if (e.isDirectory()) Object.assign(values,sourceHashes(path)); else values[path] = createHash('sha256').update(readFileSync(path)).digest('hex'); } return values; }
describe.skipIf(process.platform !== 'darwin')('actual mail Worker, native metadata reader and MIME parser', () => {
  beforeAll(() => {
    build = mkdtempSync(join(tmpdir(),'willyou-m10-mail-build-')); native = join(build,'foxmail'); worker = join(build,'mail.cjs');
    execFileSync('xcrun',['clang++','-std=c++17','-fobjc-arc','-O2','-mmacosx-version-min=12.0','-framework','Foundation','-lsqlite3',resolve('native/applications/foxmail.mm'),'-o',native]);
    execFileSync('xcrun',['clang++','-std=c++17','-O2',resolve('native/applications/process-identity.cc'),'-o',join(build,'process-identity')]);identityReader=new MacProcessIdentityReader(join(build,'process-identity'));
    const require = createRequire(import.meta.url), esbuild = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({ entryPoints: [resolve('src/main/core/applications/providers/mail-worker.ts')],bundle: true,platform: 'node',format: 'cjs',outfile: worker,alias: { '@shared': resolve('src/shared') } });
  });
  afterAll(() => rmSync(build,{ recursive: true,force: true }));
  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-mail-source-'))); mkdirSync(join(root,'Mail','Inbox'),{ recursive: true });
    db = new Database(join(root,'messages.db')); db.exec(schema);
    config = { kind: 'foxmail',sourcePath: root,account: 'selected-fixture-mailbox',queryDays: 30 }; client = new MailWorkerClient(worker,native);
    identity = await client.verify(config,signal());
  });
  afterEach(async() => { await client.close(); db.close(); rmSync(root,{ recursive: true,force: true }); });
  it('uses local natural dates and rejects invalid windows without expanding scope', () => {
    expect(localMailRange(1,now)).toMatchObject({ days: 1,startDate: '2026-10-20',endDate: '2026-10-20' });
    expect(localMailRange(100,now).startDate).toBe('2026-07-13'); expect(() => localMailRange(101,now)).toThrow(); expect(() => localMailRange(1.5,now)).toThrow();
  });
  it('reads in-range headers/body, reuses unchanged headers and leaves every source byte unchanged', async () => {
    add(1,now,'body-only-needle'); add(2,new Date(2026,8,1,12),'outside'); const before = sourceHashes(root);
    const result = await client.query(config,{ text: 'body-only-needle',limit: 50 },identity,signal(),now);
    expect(result).toMatchObject({ complete: true,matched: 1,readHeaders: 2,reusedHeaders: 0 }); expect(result.records.map(r => r.id)).toEqual(['1']);
    const again = await client.query(config,{ text: '',limit: 50 },identity,signal(),now); expect(again).toMatchObject({ complete: true,reusedHeaders: 2,readHeaders: 0 });
    expect(sourceHashes(root)).toEqual(before);
  });
  it('has a confirmed empty result, explicit limited output and exact 100-day boundaries', async () => {
    add(1,now); add(2,new Date(2026,6,13,0)); add(3,new Date(2026,6,12,23,59));
    const expanded = { ...config,queryDays: 100 };
    expect(await client.query(expanded,{ text: '',limit: 1 },identity,signal(),now)).toMatchObject({ complete: true,matched: 2,truncated: true,records: [{ id: '1' }] });
    expect(await client.query(config,{ text: 'no such fixture',limit: 50 },identity,signal(),now)).toMatchObject({ complete: true,matched: 0,records: [] });
    await expect(client.read(config,'2',identity,signal(),now)).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });
  it('returns bounded decoded attachments by content hash and rejects a stale attachment reference', async () => {
    add(1,now,'attachment fixture',true); const content = await client.read(config,'1',identity,signal(),now);
    expect(content).toMatchObject({ complete: true,attachments: [{ filename: 'sample.txt',size: 25 }] });
    const attachment = content.attachments[0], bytes = await client.attachment(config,'1',attachment.id,attachment.contentHash,identity,signal(),now);
    expect(Buffer.from(bytes).toString()).toBe('stable fixture attachment');
    await expect(client.attachment(config,'1',attachment.id,'0'.repeat(64),identity,signal(),now)).rejects.toMatchObject({ code: 'RESOURCE_STATE_CHANGED' });
  });
  it('reports missing bodies and invalid dates as incomplete, and source deletion as unavailable', async () => {
    add(1,now); add(2,now); rmSync(join(root,'Mail','Inbox','2.mail'));
    const partial = await client.query(config,{ text: '',limit: 50 },identity,signal(),now); expect(partial.complete).toBe(false); expect(partial.records.map(r => r.id)).toEqual(['1']); expect(partial.problems).toContainEqual({ id: '2',code: 'INCOMPLETE_RESULT' });
    db.prepare('DELETE FROM mailinfo WHERE mailid=1').run(); await expect(client.read(config,'1',identity,signal(),now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    writeFileSync(join(root,'Mail','Inbox','2.mail'),'Date: invalid\r\nSubject: fixture\r\n\r\nbody');
    expect((await client.query(config,{ text: '',limit: 50 },identity,signal(),now)).complete).toBe(false);
  });
  it('never declares a body search complete when the local body or declared attachment is missing', async () => {
    add(1,now,''); db.prepare('UPDATE mailinfo SET attachment=1 WHERE mailid=1').run();
    const content = await client.read(config,'1',identity,signal(),now); expect(content.complete).toBe(false); expect(content.missing).toContain('attachments-not-downloaded');
    const query = await client.query(config,{ text: 'body-needed',limit: 50 },identity,signal(),now); expect(query.complete).toBe(false); expect(query.records).toEqual([]);
  });
  it('checks identity for every operation and refuses duplicate or linked source files', async () => {
    add(1,now);
    await expect(client.query(config,{ text: '',limit: 50 },{ ...identity,accountId: 'another-mailbox' },signal(),now)).rejects.toMatchObject({ code: 'IDENTITY_CHANGE_REQUIRES_SELECTION' });
    mkdirSync(join(root,'Mail','other')); writeFileSync(join(root,'Mail','other','1.mail'),'duplicate');
    await expect(client.query(config,{ text: '',limit: 50 },identity,signal(),now)).rejects.toMatchObject({ code: 'INCOMPLETE_RESULT' });
    rmSync(join(root,'Mail','other','1.mail')); symlinkSync(join(root,'Mail','Inbox','1.mail'),join(root,'Mail','other','linked.mail'));
    await expect(client.query(config,{ text: '',limit: 50 },identity,signal(),now)).rejects.toMatchObject({ code: 'INCOMPLETE_RESULT' });
  });
  it('rejects a replacement database at the same path and accepts only its newly verified identity',async()=>{
    add(1,now,'original source body');db.close();
    const path=join(root,'messages.db'),retained=join(root,'original-database.fixture');renameSync(path,retained);
    db=new Database(path);db.exec(schema);add(1,now,'replacement source body');
    const before=sourceHashes(root);
    await expect(client.query(config,{text:'',limit:50},identity,signal(),now)).rejects.toMatchObject({code:'IDENTITY_CHANGE_REQUIRES_SELECTION'});
    await expect(client.read(config,'1',identity,signal(),now)).rejects.toMatchObject({code:'IDENTITY_CHANGE_REQUIRES_SELECTION'});
    const replacement=await client.verify(config,signal());expect(replacement.serviceId).not.toBe(identity.serviceId);expect(replacement.accountId).toBe(identity.accountId);
    expect(await client.query(config,{text:'replacement source body',limit:50},replacement,signal(),now)).toMatchObject({complete:true,matched:1});
    expect(sourceHashes(root)).toEqual(before);
  });
  it('binds scan batches to the original configuration and rejects mutations before declaring a snapshot complete',async()=>{
    add(1,now,'body-only-needle');const scan=await client.beginScan(config,identity,signal(),now),entries=await client.scanEntries(config,scan.id,0,50,signal());expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({id:'1',fingerprint:expect.stringMatching(/^[a-f0-9]{64}$/)});
    await expect(client.scanEntries({...config,queryDays:100},scan.id,0,50,signal())).rejects.toMatchObject({code:'SCOPE_DENIED'});
    const batch=await client.scanBatch(config,scan.id,0,50,'body-only-needle',signal());expect(batch).toMatchObject({done:true,readHeaders:1,indexed:[{id:'1',searchText:expect.stringContaining('body-only-needle')}]});
    writeFileSync(join(root,'Mail/Inbox/1.mail'),readFileSync(join(root,'Mail/Inbox/1.mail'),'utf8')+' changed');await expect(client.finishScan(config,scan.id,signal())).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
  });
  it('terminates a hung Worker within its budget and rejects cancellation without late results', async () => {
    const hung = join(build,'hung.cjs'); writeFileSync(hung,'while(true) {}'); const other = new MailWorkerClient(hung,native,100);
    try { await expect(other.verify(config,signal())).rejects.toMatchObject({ code: 'TIMEOUT' }); } finally { await other.close(); }
    const abort = new AbortController(), pending = client.verify(config,abort.signal); abort.abort(); await expect(pending).rejects.toMatchObject({ code: 'CANCELED' });
  });
  it('waits for actual Worker and owned native child exit before rejecting cancellation or completing close',async()=>{
    const holdSource=join(build,'hold-reader.cc'),holdNative=join(build,'hold-reader'),holdWorker=join(build,'hold-worker.cjs');
    writeFileSync(holdSource,'#include <unistd.h>\n#include <signal.h>\n#include <fstream>\n#include <string>\nint main(int argc,char**argv){std::ofstream out(std::string(argv[1])+".fixture-pid");out<<getpid();out.close();signal(SIGTERM,SIG_IGN);for(;;)pause();}');
    execFileSync('xcrun',['clang++','-std=c++17',holdSource,'-o',holdNative]);
    writeFileSync(holdWorker,'const{parentPort}=require("node:worker_threads");parentPort.on("message",m=>parentPort.postMessage({type:"metadata",id:m.id,metadataId:1,path:require("node:path").join(m.config.sourcePath,"messages.db")}));');
    const other=new MailWorkerClient(holdWorker,holdNative),abort=new AbortController(),reading=other.verify(config,abort.signal);void reading.catch(()=>{});
    try{
      let pid=0;await vi.waitFor(()=>{pid=Number(readFileSync(join(root,'messages.db.fixture-pid'),'utf8'));expect(pid).toBeGreaterThan(0);},{timeout:2000});
      const nativeIdentity=identityReader.read(pid)!;expect(identityReader.state(nativeIdentity)).toBe('running');expect((other as unknown as {worker:Worker}).worker.threadId).toBeGreaterThan(0);
      abort.abort();const closing=other.close();expect(other.close()).toBe(closing);await expect(reading).rejects.toMatchObject({code:'CANCELED'});await closing;
      expect(identityReader.state(nativeIdentity)).toBe('stopped');expect((other as unknown as {worker:Worker}).worker.threadId).toBe(-1);
    }finally{await other.close();}
  });

});

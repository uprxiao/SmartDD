import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, realpathSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { IpcMainInvokeEvent } from 'electron';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { registerRPCRouter } from '@shared/ipc/rpc';
import type { TerminalInsertionInput } from '@shared/file-terminal';
import { PtyAccess } from '../../pty-access';
import { PtyManager } from '../../pty-manager';
import { NativeFileBroker } from './native-broker';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
import { FileService } from './file-service';
import { FileTerminalService } from './terminal-context';
import { createFileController } from './controller';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const observations: Record<string, unknown>[] = [], cleanups: (() => Promise<void>)[] = [];
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const until = async (ready: () => boolean) => { const end = Date.now() + 6000; while (!ready()) { if (Date.now() > end) throw new Error('Isolated terminal fixture timeout'); await delay(5); } };
async function fixture(native = false) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-terminal-context-'))), project = join(base, 'project'), userdata = join(base, 'userdata'); mkdirSync(project); mkdirSync(userdata);
  const relativePath = '中文 空格🙂\'\"();`$().txt', path = join(project, relativePath); writeFileSync(path, 'source bytes unchanged\n');
  const executable = join(process.env.SMARTDD_TERMINAL_APP!, 'Contents/Resources/native/willyou-files'), broker = new NativeFileBroker(executable);
  const taskId = randomUUID(), projectId = randomUUID(), taskRoots = new Map<string, string>([[taskId, project]]), resolver = { sources: (scope: { kind: string; taskId?: string }) => [{ kind: 'project-directory' as const, id: 'root', path: scope.taskId ? taskRoots.get(scope.taskId) ?? project : project, label: 'Isolated terminal context', projectId }] };
  const roots = new FileRootsService(resolver, broker), files = new FileService(roots, broker, new FileRecoveryStore(broker, userdata, resolver));
  const ptys = new PtyManager(), active = new Map<string, string>([[taskId, 'fixture-pty']]), alive = new Set(['fixture-pty']), writes: { id: string; data: string }[] = [];
  const sender = Object.assign(new EventEmitter(), { id: 410, mainFrame: { processId: 50, routingId: 1 }, isDestroyed: (): boolean => false });
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent; let trusted = true;
  const access = new PtyAccess({ trusted: value => trusted && value.sender === event.sender, activePty: id => active.get(id) ?? null, alive: id => native ? ptys.has(id) : alive.has(id), write: (id, data) => writes.push({ id, data }), resize: vi.fn(), killTask: vi.fn() });
  let pause: (() => Promise<void>) | null = null, failWrite = false, providerPath: string | undefined;
  const terminal = new FileTerminalService({ roots, access, taskProject: () => projectId,
    source: async (owner, target, identity) => { const source = await files.terminalSource(owner, target, identity); return { ...source, ...(providerPath !== undefined ? { absolutePath: providerPath } : {}), inspect: async () => { const wait = pause; pause = null; if (wait) await wait(); return source.inspect(); } }; },
    bracketedPaste: id => native ? ptys.bracketedPaste(id) : Promise.resolve(false), write: (id, data) => { if (native) ptys.writeControlled(id, data); writes.push({ id, data }); if (failWrite) throw new Error('native partial write'); },
  });
  const handlers = new Map<string, Function>(); registerRPCRouter({ files: createFileController(files, incoming => trusted && incoming.sender === event.sender, undefined, terminal) }, { handle: (name: string, fn: Function) => handlers.set(name, fn) } as never);
  const invoke = (method: string, ...args: unknown[]): any => handlers.get(`files.${method}`)!(event, ...args);
  const root = (await invoke('roots', { kind: 'task', taskId })).roots[0], target = { kind: 'path' as const, path: { lease: root.lease, generation: root.generation, relativePath }, directory: false };
  const setup = async (ptyId = 'fixture-pty') => { const binding = await invoke('terminalBind', { taskId, ptyId, root: { lease: root.lease, generation: root.generation } }); const source = await invoke('terminalPrepare', { bindingId: binding.id, target }); return { binding, source }; };
  const f = { base, project, path, relativePath, root, taskId, taskRoots, files, active, alive, writes, sender, event, invoke, handlers, ptys, target, setup, setTrusted: (value: boolean) => { trusted = value; },
    setProviderPath: (value: string) => { providerPath = value; },
    failNextWrite: () => { failWrite = true; },
    pauseNextInspect: () => { let release!: () => void, entered!: () => void; const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; }); pause = () => { entered(); return gate; }; return { release, reached }; },
  };
  cleanups.push(async () => { sender.emit('destroyed'); ptys.killAll(); await until(() => broker.activeProcesses === 0); await files.watcher.dispose(); broker.dispose(); rmSync(base, { force: true, recursive: true }); });
  return f;
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
afterAll(() => { if (process.env.SMARTDD_TERMINAL_EVIDENCE) writeFileSync(process.env.SMARTDD_TERMINAL_EVIDENCE, JSON.stringify({ finishedAt: new Date().toISOString(), level: 'production scoped RPC handlers / FileService / packaged native broker; real PTY in designated rows; synthetic Electron sender metadata, no App GUI or model calls', observations }, null, 2)); });
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_TERMINAL_APP)('DEV045 controlled file-to-terminal service integration', () => {
  it('returns an original explicit failure when the source inode is replaced during pending validation', async () => {
    const f = await fixture(), { binding, source } = await f.setup(), input = { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: source.id }, gate = f.pauseNextInspect();
    const pending = f.invoke('terminalInsert', input); await gate.reached; writeFileSync(f.path + '.replacement', 'new physical source'); renameSync(f.path + '.replacement', f.path); gate.release();
    const receipt = await pending; expect(receipt).toMatchObject({ operationId: input.operationId, state: 'failed' }); expect(receipt.message).toContain('替换');
    expect(await f.invoke('terminalInsert', input)).toEqual(receipt); expect(f.writes).toEqual([]); observations.push({ scenario: 'DEV108 original changed-inode refusal before write', receipt, writes: 0 });
  });
  it('returns an explicit failure for a captured document closed while original validation is pending', async () => {
    const f = await fixture(), document = await f.invoke('open', f.target.path), { binding } = await f.setup();
    const source = await f.invoke('terminalPrepare', { bindingId: binding.id, target: { kind: 'document', ref: document.ref }, identity: { device: document.revision.device, inode: document.revision.inode } });
    const input = { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: source.id }, gate = f.pauseNextInspect(), pending = f.invoke('terminalInsert', input); await gate.reached;
    await f.invoke('closeDocument', document.ref); gate.release(); const receipt = await pending; expect(receipt.state).toBe('failed'); expect(f.writes).toEqual([]);
    observations.push({ scenario: 'DEV108 actual document revocation before write', receipt, writes: 0 });
  });
  it.each([7999, 8000, 8001])('validates total %i against the real prepared source before any write', async total => {
    const f = await fixture(), { binding, source } = await f.setup(), instruction = 'i'.repeat(total - f.relativePath.length - 2);
    const receipt = await f.invoke('terminalInsert', { kind: 'context', bindingId: binding.id, operationId: randomUUID(), references: [{ sourceId: source.id, kind: 'file' }], includeText: false, style: 'plain', instruction });
    expect(receipt.state).toBe(total > 8000 ? 'failed' : 'inserted'); expect(f.writes).toHaveLength(total > 8000 ? 0 : 1);
    if (total <= 8000) { expect(receipt.characters).toBe(total); expect(f.writes[0].data).toBe(f.relativePath + ' ' + instruction); }
    observations.push({ scenario: 'DEV108 actual native source aggregate limit', total, receipt, writes: f.writes.length });
  });
  it.each([7999, 8000, 8001])('Y35 controlled source provider returns total path payload %i without truncation or fallback', async total => {
    const f = await fixture(), path = '/' + 'x'.repeat(total - 2); f.setProviderPath(path);
    const { binding, source } = await f.setup(), input = { kind:'path', bindingId:binding.id, operationId:randomUUID(), sourceId:source.id }, receipt = await f.invoke('terminalInsert', input);
    expect(receipt.state).toBe(total > 8000 ? 'failed' : 'inserted'); expect(f.writes).toEqual(total > 8000 ? [] : [{id:'fixture-pty',data:path+' '}]);
    if(total > 8000) expect(receipt.message).toContain('8001'); else expect(receipt.characters).toBe(total);
    expect(readFileSync(f.path,'utf8')).toBe('source bytes unchanged\n');
    observations.push({scenario:'Y35 controlled absolute source path length',total,path,receipt,writes:f.writes,boundary:'Explicit source-provider absolutePath fault after real FileService/native source preparation; original inspect/authorization and controlled writer. No physical APFS 8k path or GUI claim.'});
  });
  it.each(['\n','\r','\t','\x1b','\x03','\x7f','\u009b','\u202e','\ud800','\udc00'])('Y35 rejects the entire provider path containing unsafe %j without sanitizing to another source', async character => {
    const f = await fixture(), path = '/synthetic/a'+character+'b.txt';f.setProviderPath(path);
    const { binding, source } = await f.setup(), receipt = await f.invoke('terminalInsert',{kind:'path',bindingId:binding.id,operationId:randomUUID(),sourceId:source.id});
    expect(receipt).toMatchObject({state:'failed',message:expect.stringContaining('不能安全')});expect(f.writes).toEqual([]);expect(readFileSync(f.path,'utf8')).toBe('source bytes unchanged\n');
    observations.push({scenario:'Y35 controlled unsafe absolute source path',path,receipt,writes:0,boundary:'Explicit controlled provider path; original native seed source inspect, original service refusal, controlled writer. Lone UTF16 cannot be a physical local filename.'});
  });
  it('Y33 original file source and terminal service preserve the same generic path for all real formats', async () => {
    const f=await fixture(),manifest=JSON.parse(execFileSync('/usr/bin/python3',[join(process.cwd(),'scripts/files/path-formats-fixtures.py'),f.project],{encoding:'utf8',timeout:30000}));
    const binding=f.invoke('terminalBind',{taskId:f.taskId,ptyId:'fixture-pty',root:{lease:f.root.lease,generation:f.root.generation}}),receipts=[];
    for(const name of manifest.names) {
      const doc=await f.invoke('open',{lease:f.root.lease,generation:f.root.generation,relativePath:name}),source=await f.invoke('terminalPrepare',{bindingId:binding.id,target:{kind:'document',ref:doc.ref},identity:{device:doc.revision.device,inode:doc.revision.inode}});
      const receipt=await f.invoke('terminalInsert',{kind:'path',bindingId:binding.id,operationId:randomUUID(),sourceId:source.id});expect(receipt).toMatchObject({state:'inserted',bracketed:false,characters:join(f.project,name).length+1});receipts.push({name,document:doc,source,receipt});
      await f.invoke('closeDocument',doc.ref);expect(sha(readFileSync(join(f.project,name)))).toBe(manifest.files[name].sha256);
    }
    expect(f.writes).toEqual(manifest.names.map((name:string)=>({id:'fixture-pty',data:join(f.project,name)+' '})));expect(f.writes.every(row=>!/[\r\n\x1b]/.test(row.data))).toBe(true);
    observations.push({scenario:'Y33 real multi-format native source to original terminal path service',manifest,receipts,writes:f.writes,boundary:'Original controller/FileService/native source and real format fixtures; Electron sender/PTY writer controlled I, different actual receive programs independently A.'});
  });
  it('writes an exact trusted path once, shares pending duplicate and rejects changed replay', async () => {
    const f = await fixture(), { binding, source } = await f.setup(), input: TerminalInsertionInput = { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: source.id };
    const first = f.invoke('terminalInsert', input), duplicate = f.invoke('terminalInsert', input); expect(duplicate).toBe(first);
    await expect(first).resolves.toMatchObject({ state: 'inserted', bracketed: false }); await f.invoke('terminalInsert', input); expect(f.writes).toEqual([{ id: 'fixture-pty', data: f.path + ' ' }]);
    expect(() => f.invoke('terminalInsert', { ...input, sourceId: randomUUID() })).toThrow('同一投递编号');
    await f.invoke('terminalInsert', { ...input, operationId: randomUUID() }); expect(f.writes).toHaveLength(2);
    observations.push({ scenario: 'exact path special characters / duplicate Promise / changed replay / two explicit operations', sourceSha256: sha(readFileSync(f.path)), path: f.path, writeCount: f.writes.length, pass: true });
  });
  it('caches an uncertain native write without ever writing a duplicate operation again', async () => {
    const f = await fixture(), { binding, source } = await f.setup(), input = { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: source.id };
    f.failNextWrite(); const first = f.invoke('terminalInsert', input); expect(f.invoke('terminalInsert', input)).toBe(first);
    await expect(first).resolves.toMatchObject({ state: 'unknown', operationId: input.operationId });
    await expect(f.invoke('terminalInsert', input)).resolves.toMatchObject({ state: 'unknown' }); expect(f.writes).toHaveLength(1);
    observations.push({ scenario: 'write exception after possible partial acceptance is cached unknown', writeAttempts: 1, duplicateRetries: 0, pass: true });
  });
  it('rejects foreign window/subframe/destroyed/navigated sender and wrong/old/stopped PTY without writes', async () => {
    const f = await fixture(), { binding, source } = await f.setup(), input = { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: source.id };
    const invoke = f.handlers.get('files.terminalInsert')!;
    const other = Object.assign(new EventEmitter(), { id: 999, mainFrame: {}, isDestroyed: () => false });
    for (const event of [{ ...f.event, senderFrame: {} }, { sender: other, senderFrame: other.mainFrame }]) expect(() => invoke(event, input)).toThrow();
    f.sender.isDestroyed = () => true; expect(() => invoke(f.event, input)).toThrow(); f.sender.isDestroyed = () => false;
    f.setTrusted(false); expect(() => invoke(f.event, input)).toThrow(); f.setTrusted(true);
    expect(() => f.invoke('terminalBind', { taskId: randomUUID(), ptyId: 'fixture-pty', root: { lease: f.root.lease, generation: f.root.generation } })).toThrow('TERMINAL_TARGET_DENIED');
    expect(() => f.invoke('terminalBind', { taskId: f.taskId, ptyId: 'nonexistent', root: { lease: f.root.lease, generation: f.root.generation } })).toThrow('TERMINAL_TARGET_DENIED');
    f.active.set(f.taskId, 'new-pty'); expect(() => f.invoke('terminalInsert', input)).toThrow('TERMINAL_TARGET_DENIED'); f.active.set(f.taskId, 'fixture-pty');
    f.alive.clear(); expect(() => f.invoke('terminalInsert', input)).toThrow('TERMINAL_TARGET_DENIED'); f.alive.add('fixture-pty');
    f.sender.emit('did-start-navigation', {}, 'about:blank', false, true); expect(() => f.invoke('terminalInsert', input)).toThrow(); expect(f.writes).toEqual([]);
    observations.push({ scenario: 'trusted sender + ownership rejection matrix', rejected: ['foreign-window', 'subframe', 'destroyed', 'untrusted-document', 'wrong-task', 'old-pty', 'dead-pty', 'navigated-document'], writes: 0, pass: true });
  });
  it('refuses source substitution, directories, malformed/empty/oversize body and stale root capability', async () => {
    const f = await fixture(), { binding, source } = await f.setup();
    await expect(f.invoke('terminalPrepare', { bindingId: binding.id, target: { ...f.target, directory: true } })).rejects.toThrow();
    expect(() => f.invoke('terminalInsert', { kind: 'context', bindingId: binding.id, operationId: randomUUID(), references: [], includeText: true, style: 'plain' })).toThrow();
    await expect(f.invoke('terminalInsert', { kind: 'context', bindingId: binding.id, operationId: randomUUID(), references: [{ kind: 'file', sourceId: source.id }], includeText: true, style: 'plain', instruction: 'x'.repeat(8000) })).resolves.toMatchObject({ state: 'failed', message: expect.stringContaining('超过') });
    const replacement = join(f.project, 'new.txt'); writeFileSync(replacement, 'replacement'); renameSync(replacement, f.path);
    await expect(f.invoke('terminalInsert', { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: source.id })).resolves.toMatchObject({ state: 'failed', message: expect.stringContaining('替换') });
    const newSource = await f.invoke('terminalPrepare', { bindingId: binding.id, target: f.target }); unlinkSync(f.path);
    await expect(f.invoke('terminalInsert', { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: newSource.id })).resolves.toMatchObject({ state: 'failed' });
    await f.invoke('closeScope', { kind: 'task', taskId: f.taskId }); expect(() => f.invoke('terminalInsert', { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: source.id })).toThrow();
    expect(f.writes).toEqual([]); expect(existsSync(f.path)).toBe(false); observations.push({ scenario: 'identity substitution / missing / directory / empty / aggregate limit / revoked root', pass: true, writes: 0 });
  });
  it('Y39 rejects forged URL/virtual/document/root/host identities and a real directory before any write', async () => {
    const f = await fixture(), { binding } = await f.setup(), folder = 'directory'; mkdirSync(join(f.project, folder));
    const invalid = [
      {kind:'path',path:{...f.target.path,relativePath:folder},directory:true},
      {kind:'path',path:{...f.target.path,relativePath:folder},directory:false},
      {kind:'document',ref:{id:randomUUID(),lease:f.root.lease,generation:f.root.generation}},
      {kind:'path',path:{...f.target.path,lease:randomUUID()} ,directory:false},
      ...['https://invalid.example/image.png','data:image/png;base64,AA==','blob:synthetic-image'].map(url=>({kind:'url',url})),
      {kind:'path',path:{...f.target.path,relativePath:'virtual-not-on-disk.png'},directory:false},
      {kind:'path',path:{...f.target.path},directory:false,hostId:'ssh:other-host'},
      {kind:'document',ref:{id:randomUUID(),lease:randomUUID(),generation:1},path:f.path},
    ];
    const rejected=[];
    for (const target of invalid) { await expect(Promise.resolve().then(()=>f.invoke('terminalPrepare',{bindingId:binding.id,target}))).rejects.toThrow(); rejected.push(target); }
    const receipt = await f.invoke('terminalInsert',{kind:'path',bindingId:binding.id,operationId:randomUUID(),sourceId:randomUUID()});expect(receipt.state).toBe('failed');expect(f.writes).toEqual([]);
    observations.push({scenario:'Y39 trusted source rejection matrix',rejected,receipt,writes:0,boundary:'Original controller/FileService/native broker; synthetic sender/controlled PTY writer, not GUI'});
  });
  it('cancels validation in flight when binding changes and never redirects to the next target', async () => {
    const f = await fixture(), { binding, source } = await f.setup(), gate = f.pauseNextInspect();
    const operation = f.invoke('terminalInsert', { kind: 'path', bindingId: binding.id, operationId: randomUUID(), sourceId: source.id });
    await gate.reached; f.invoke('terminalRelease', binding.id); await f.setup(); gate.release();
    await expect(operation).resolves.toMatchObject({ state: 'failed', message: expect.stringContaining('已切换') }); expect(f.writes).toEqual([]); observations.push({ scenario: 'late validation after explicit context replacement', writes: 0, pass: true });
  });
  it.each(['task', 'root', 'pty'] as const)('Y38 original pending validation across %s replacement never writes into the new binding', async boundary => {
    const f = await fixture(), { binding, source } = await f.setup(), input = { kind: 'path' as const, bindingId: binding.id, operationId: randomUUID(), sourceId: source.id }, gate = f.pauseNextInspect();
    const old = f.invoke('terminalInsert', input); await gate.reached;
    const nextTask = boundary === 'task' ? randomUUID() : f.taskId, nextPty = boundary === 'pty' ? 'replacement-pty' : 'fixture-pty';
    let nextRoot = f.root;
    if (boundary === 'task' || boundary === 'root') {
      const other = join(f.base, 'other'); mkdirSync(other); writeFileSync(join(other, f.relativePath), 'ROOT B SOURCE'); f.taskRoots.set(nextTask, other);
      if (boundary === 'root') await f.invoke('closeScope', { kind: 'task', taskId: f.taskId });
      nextRoot = (await f.invoke('roots', { kind: 'task', taskId: nextTask })).roots[0];
    }
    f.active.set(nextTask, nextPty); f.alive.add(nextPty);
    const nextBinding = f.invoke('terminalBind', { taskId: nextTask, ptyId: nextPty, root: { lease: nextRoot.lease, generation: nextRoot.generation } }), nextSource = await f.invoke('terminalPrepare', { bindingId: nextBinding.id, target: { kind: 'path', path: { lease: nextRoot.lease, generation: nextRoot.generation, relativePath: f.relativePath }, directory: false } });
    const receipt = await f.invoke('terminalInsert', { kind: 'path', bindingId: nextBinding.id, operationId: randomUUID(), sourceId: nextSource.id }); expect(receipt.state).toBe('inserted');
    const writes = [...f.writes]; gate.release(); await expect(old).resolves.toMatchObject({ state: 'failed' }); expect(f.writes).toEqual(writes); expect(f.writes).toEqual([{ id: nextPty, data: join(nextRoot.path, f.relativePath) + ' ' }]);
    observations.push({ scenario: 'Y38 real source/controller validation after ' + boundary, oldBinding: binding, nextBinding, oldSource: source, nextSource, receipt, writes: f.writes, boundary: 'Original service/native source and scoped controller; Electron sender and PTY write sink controlled I, not App A' });
  });
  it.each([false, true])('delivers sanitized large CJK payload byte-for-byte to isolated raw PTY; bracketed=%s', async bracketed => {
    const f = await fixture(true), capture = join(f.base, 'received.bin'), program = join(f.base, 'receiver.py');
    writeFileSync(program, `import os,sys,tty\ntty.setraw(0)\nos.write(1,b'\\x1b[?2004${bracketed ? 'h' : 'l'}READY')\nwhile True:\n data=os.read(0,65536)\n if not data: break\n with open(sys.argv[1],'ab') as out: out.write(data)\n`);
    let ready = false; f.ptys.on('data', (_id, text) => { if (text.includes('READY')) ready = true; });
    const ptyId = f.ptys.spawn({ command: '/usr/bin/python3', args: [program, capture], cwd: f.base, env: { PATH: '/usr/bin:/bin', HOME: f.base, ZDOTDIR: f.base, LC_ALL: 'en_US.UTF-8', TERM: 'xterm-256color' } }); f.active.set(f.taskId, ptyId); await until(() => ready);
    const { binding, source } = await f.setup(ptyId), instruction = ('中文🙂'.repeat(1970) + '\n\x1b[201~\x03\x04\u009b\u202e\ud800').slice(0, 7900);
    const references = [{ kind: 'file' as const, sourceId: source.id }];
    // Independent expected payload: do not call the production formatter or
    // sanitizer to decide whether its own control/surrogate output is correct.
    const expectedText = f.relativePath + '\n\n' + '中文🙂'.repeat(1970) + '\n[201~�';
    const receipt = await f.invoke('terminalInsert', { kind: 'context', bindingId: binding.id, operationId: randomUUID(), references, instruction, includeText: false, style: 'plain' });
    const expected = Buffer.from(bracketed ? '\x1b[200~' + expectedText.replace(/\n/g, '\r') + '\x1b[201~' : expectedText.replace(/\n+/g, ' ').trimEnd()); await until(() => existsSync(capture) && readFileSync(capture).length >= expected.length);
    expect(readFileSync(capture)).toEqual(expected); expect(receipt.bracketed).toBe(bracketed); expect(f.ptys.has(ptyId)).toBe(true); expect(expected.at(-1)).not.toBe(13); expect(expected.at(-1)).not.toBe(10);
    expect(receipt.removed).toBe(5); expect(receipt.replaced).toBe(1);
    expect(readFileSync(f.path, 'utf8')).toBe('source bytes unchanged\n'); observations.push({ scenario: 'real raw PTY sanitized CJK bytes', bracketed, characters: expectedText.length, bytes: expected.length, receivedSha256: sha(readFileSync(capture)), expectedSha256: sha(expected), independentOracle: true, removed: receipt.removed, replaced: receipt.replaced, sourceUnchanged: true, pass: true });
  });
  it.each(['zsh', 'sh'])('does not submit any line to a real isolated %s input loop', async shell => {
    const f = await fixture(true), capture = join(f.base, 'submitted.log'), canary = join(f.base, 'must-not-execute'); let output = '';
    f.ptys.on('data', (_id, data) => { output = (output + data).slice(-20000); });
    const args = shell === 'zsh' ? ['-f'] : ['-c', 'printf "\\033[?2004lREADY"; while IFS= read -r line; do printf "%s\\n" "$line" >> "$1"; done', 'receiver', capture];
    const ptyId = f.ptys.spawn({ command: `/bin/${shell}`, args, cwd: f.base, env: { PATH: '/usr/bin:/bin', HOME: f.base, ZDOTDIR: f.base, LC_ALL: 'en_US.UTF-8', TERM: 'xterm-256color', PS1: 'CTX_READY> ', PROMPT: 'CTX_READY> ' } }); f.active.set(f.taskId, ptyId);
    await until(() => output.includes(shell === 'zsh' ? 'CTX_READY>' : 'READY'));
    expect(await f.ptys.bracketedPaste(ptyId)).toBe(shell === 'zsh');
    const { binding, source } = await f.setup(ptyId), instruction = `\x1b[201~\x03\x04\nprintf executed > ${canary}\nprintf second`;
    const receipt = await f.invoke('terminalInsert', { kind: 'context', bindingId: binding.id, operationId: randomUUID(), references: [{ sourceId: source.id, kind: 'file' }], instruction, includeText: false, style: 'plain' });
    await delay(300); expect(existsSync(capture)).toBe(false); expect(existsSync(canary)).toBe(false); expect(f.ptys.has(ptyId)).toBe(true); expect(f.writes).toHaveLength(1);
    const bytes = Buffer.from(f.writes[0].data); expect(bytes.at(-1)).not.toBe(13); expect(bytes.at(-1)).not.toBe(10);
    observations.push({ scenario: `real ${shell} input remains unsubmitted`, bracketed: receipt.bracketed, canaryCreated: false, linesSubmitted: 0, processAlive: true, controlledWriteCount: 1, payloadSha256: sha(bytes), pass: true });
  });
});

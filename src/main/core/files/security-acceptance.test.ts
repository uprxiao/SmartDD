import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRPCClient, registerRPCRouter } from '@shared/ipc/rpc';
import type { FileApplications, FileDocument, FileRoots } from '@shared/files';
import type { GitBlame, GitStatus } from '@shared/file-git';
import { createFileController } from './controller';
import { FileService } from './file-service';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
import { NativeFileBroker } from './native-broker';
import { FileGitMetadata } from './git-metadata';

const boundary = vi.hoisted(() => ({ spawn: vi.fn(), web: vi.fn() }));
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => { boundary.spawn(...args); return actual.spawn(...args); } };
});
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: { openExternal: boundary.web } }));

const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const root = resolve('.'), rows: Record<string, unknown>[] = [];
let artifacts = '', fixture = '', capture = '', openerBroker = '', broker: NativeFileBroker, files: FileService;
const scope = { kind: 'project' as const, projectId: 'security-fixture' };
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
function rpc(service: FileService) {
  const handlers = new Map<string, Handler>();
  const sender = Object.assign(new EventEmitter(), { id: 91, mainFrame: { processId: 910, routingId: 911 }, isDestroyed: () => false, send: vi.fn() });
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
  registerRPCRouter({ files: createFileController(service, candidate => candidate.sender === event.sender) }, { handle: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as IpcMain);
  const invoke = async <T>(method: string, ...args: unknown[]): Promise<T> => {
    const handler = handlers.get(`files.${method}`); if (!handler) throw new Error(`Unregistered method: files.${method}`);
    return await handler(event, ...args) as T;
  };
  const client = createRPCClient<any>(async (channel, ...args) => {
    const handler = handlers.get(channel); if (!handler) throw new Error(`Unregistered method: ${channel}`);
    return handler(event, ...args);
  });
  return { handlers, event, invoke, client };
}
function service(executable: string) {
  broker = new NativeFileBroker(executable);
  const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'project', path: join(fixture, 'project'), label: 'Isolated project', projectId: scope.projectId }] };
  const preferences = { get: vi.fn(() => ({ path: null, bundleId: null })), set: vi.fn(async () => undefined) };
  files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(fixture, 'userdata'), resolver), undefined, preferences);
  return { ...rpc(files), preferences };
}
function snapshot(path: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const walk = (prefix: string) => { for (const name of readdirSync(join(path, prefix)).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name, file = join(path, relative), info = statSync(file, { bigint: true });
    if (info.isDirectory()) walk(relative);
    else result[relative] = { hash: sha(readFileSync(file)), size: String(info.size), mtimeNs: String(info.mtimeNs), inode: String(info.ino) };
  } }; walk(''); return result;
}
function git(...args: string[]): string {
  return execFileSync('/Library/Developer/CommandLineTools/usr/bin/git', ['-C', join(fixture, 'project'), ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: fixture, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } });
}
function gitFixture(): void {
  git('init', '-q'); git('config', 'user.name', 'M9 Security Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(fixture, 'project/tracked.txt'), 'line one\nline two\n');
  writeFileSync(join(fixture, 'project/generated.js'), 'before\n');
  writeFileSync(join(fixture, 'project/.gitattributes'), 'generated.js linguist-generated=true\n');
  git('add', '.'); git('commit', '-qm', 'Isolated security fixture');
  writeFileSync(join(fixture, 'project/generated.js'), 'after\n');
}

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_SECURITY_BROKER)('M9-T-M12 / S10 production file authority integration', () => {
  beforeAll(() => {
    artifacts = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-security-artifacts-'))); capture = join(artifacts, 'opener-arguments.ndjson'); openerBroker = join(artifacts, 'opener-capture');
    // Only the NSWorkspace dispatch is replaced. The production native source,
    // path/identity validation and FileService/RPC path remain unchanged.
    execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-O2', '-Wno-deprecated-declarations', '-mmacosx-version-min=12.0', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-framework', 'CoreText', '-I', join(root, 'native/files'), `-DM12_CAPTURE_PATH=${JSON.stringify(capture)}`, join(root, 'src/main/core/files/fixtures/opener-capture.mm'), '-o', openerBroker], { encoding: 'utf8' });
  }, 120_000);
  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-security-fixture-'))); mkdirSync(join(fixture, 'project')); mkdirSync(join(fixture, 'userdata'));
    boundary.spawn.mockClear(); boundary.web.mockClear();
  });
  afterEach(async () => { files?.closeOwner('91:910:911'); await files?.watcher.dispose(); broker?.dispose(); rmSync(fixture, { recursive: true, force: true }); });
  afterAll(() => {
    if (process.env.SMARTDD_SECURITY_EVIDENCE) writeFileSync(process.env.SMARTDD_SECURITY_EVIDENCE, JSON.stringify({ recordedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, packagedBroker: process.env.SMARTDD_SECURITY_BROKER, packagedBrokerSha256: sha(readFileSync(process.env.SMARTDD_SECURITY_BROKER!)), openerProbe: openerBroker, openerProbeSha256: existsSync(openerBroker) ? sha(readFileSync(openerBroker)) : null, capturedOpenerArguments: existsSync(capture) ? readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [], rows }, null, 2) + '\n');
  });

  it('M12: preserves quotes, semicolons, backticks, substitution syntax and newline as exact OS opener arguments', async () => {
    const names = ['single\'quote.txt', 'double"quote.txt', 'semi;printf M12_SEMICOLON;.txt', '`printf M12_BACKTICK`.txt', '$(printf M12_SUBSTITUTION).txt', 'line\nnext 中文🙂.txt'];
    for (const name of names) writeFileSync(join(fixture, 'project', name), 'Synthetic only\n');
    const before = snapshot(join(fixture, 'project')), f = service(openerBroker), roots = await f.invoke<FileRoots>('roots', scope), selected = roots.roots[0];
    expect(roots.unavailable).toEqual([]);
    for (const name of names) {
      const document = await f.invoke<FileDocument>('open', { lease: selected.lease, generation: selected.generation, relativePath: name });
      const applications = await f.invoke<FileApplications>('applications', { kind: 'document', ref: document.ref });
      expect(applications.apps.length).toBeGreaterThan(0); const app = applications.apps.find(item => item.bundleId === 'com.apple.TextEdit') ?? applications.apps[0];
      expect(await f.invoke('openExternal', { listId: applications.id, appId: app.id, remember: false })).toEqual({ state: 'opened', name: app.name });
      const records = readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line)), recorded = records.at(-1);
      expect(recorded.paths).toEqual([join(fixture, 'project', name)]); expect(recorded.fileReferences).toEqual([true]);
      expect(recorded).toMatchObject({ applicationIsFileURL: true, promptsUserIfNeeded: false, allowsSubstitution: false, externalApplicationLaunched: false });
      rows.push({ case: 'M9-T-M12', filename: name, documentAbsolutePath: document.absolutePath, actualOSArguments: recorded, passed: true });
      await f.invoke('closeDocument', document.ref);
    }
    expect(f.preferences.set).not.toHaveBeenCalled(); expect(snapshot(join(fixture, 'project'))).toEqual(before);
    for (const [command, args, options] of boundary.spawn.mock.calls) { expect(command).toBe(openerBroker); expect(args).toEqual([]); expect(options.shell).not.toBe(true); }
    expect(boundary.web).not.toHaveBeenCalled();
    rows.push({ case: 'M9-T-M12', noShellInBrokerLaunch: true, allFilenamesReachOSBoundaryLiterally: true, sourceBytesAndMetadataUnchanged: true, filenameExecutionBasis: 'Exact file-reference URL arguments retain all metacharacters; broker launched only as a fixed executable with no argv/shell. Only final OS open is captured, not executed. No shell expansion or filename command output is involved.' });
  });

  it('M12: rejects unsupported protocols and forged external application choices before OS dispatch', async () => {
    const f = service(openerBroker), before = existsSync(capture) ? readFileSync(capture, 'utf8') : '';
    for (const href of ['file:///tmp/data', 'javascript:alert(1)', 'ssh://host/path', 'smb://host/share', 'data:text/plain,fixture']) await expect(f.invoke('openWebLink', href)).rejects.toThrow('HTTP');
    await expect(f.invoke('openExternal', { listId: randomUUID(), appId: randomUUID(), remember: false })).rejects.toThrow('UNTRUSTED');
    await expect(f.invoke('openExternal', { listId: randomUUID(), appId: randomUUID(), remember: false, path: '/bin/sh' })).rejects.toThrow();
    expect(boundary.web).not.toHaveBeenCalled(); expect(existsSync(capture) ? readFileSync(capture, 'utf8') : '').toBe(before);
    rows.push({ case: 'M9-T-M12', unsupportedProtocolsRejected: ['file', 'javascript', 'ssh', 'smb', 'data'], unissuedAndForgedApplicationsRejected: true, externalCalls: 0 });
  });

  it('S10: serves real status/generated/blame read routes with unchanged worktree and Git metadata', async () => {
    gitFixture(); const before = snapshot(join(fixture, 'project')), f = service(process.env.SMARTDD_SECURITY_BROKER!), roots = await f.invoke<FileRoots>('roots', scope), selected = roots.roots[0];
    const status = await f.invoke<GitStatus>('gitStatus', { id: randomUUID(), root: { lease: selected.lease, generation: selected.generation } });
    expect(status.state).toBe('ready'); if (status.state !== 'ready') throw new Error(status.reason);
    expect(status.entries).toEqual([expect.objectContaining({ relativePath: 'generated.js', status: 'modified', generated: true })]);
    const document = await f.invoke<FileDocument>('open', { lease: selected.lease, generation: selected.generation, relativePath: 'tracked.txt' });
    const blame = await f.invoke<GitBlame>('gitBlame', { id: randomUUID(), ref: document.ref, baseHash: document.revision.hash, lineStart: 1, lineEnd: 2 });
    expect(blame.state).toBe('ready'); if (blame.state !== 'ready') throw new Error(blame.reason);
    expect(blame.lines.map(line => line.line)).toEqual([1, 2]); expect(snapshot(join(fixture, 'project'))).toEqual(before);
    rows.push({ case: 'M9-T-S10', status, blame, unchangedFileCount: Object.keys(before).length, beforeAndAfter: before, realRegisteredRPC: true, generatedProvider: 'read-only git check-attr', lspProvider: 'No LSP RPC/provider registered; absence is audited, not claimed as working LSP.' });
  });

  it('S10: rejects Git writes, arbitrary commands and read-capability escalation at RPC/schema/native boundaries', async () => {
    gitFixture(); const before = snapshot(join(fixture, 'project')), f = service(process.env.SMARTDD_SECURITY_BROKER!), roots = await f.invoke<FileRoots>('roots', scope), selected = roots.roots[0];
    const request = { id: randomUUID(), root: { lease: selected.lease, generation: selected.generation } }, nativeRequest = vi.spyOn(broker, 'request');
    const rejected = ['gitCommit', 'gitCheckout', 'gitMerge', 'gitAdd', 'gitReset', 'gitPush', 'gitRun', 'gitExec', 'lspExecuteCommand', 'lspApplyEdit'];
    for (const method of rejected) await expect(f.client.files[method]({ command: 'commit', args: ['--allow-empty'] })).rejects.toThrow('Unregistered method');
    expect(nativeRequest).not.toHaveBeenCalled();
    for (const injected of [{ command: 'commit' }, { args: ['checkout', '--force'] }, { operation: 'save', base64: 'ZXZpbA==' }]) await expect(f.invoke('gitStatus', { ...request, ...injected })).rejects.toThrow();
    await expect(f.invoke('save', { ref: request.root, opId: randomUUID(), bufferVersion: 1, baseHash: 'a'.repeat(64), base64: 'ZXZpbA==' })).rejects.toThrow();
    expect(nativeRequest).not.toHaveBeenCalled();
    const descriptor = { path: selected.canonicalPath, identity: selected.identity };
    for (const operation of ['git-commit', 'git-checkout', 'git-merge', 'git-add', 'git-reset', 'git-push', 'git-run']) await expect(broker.request({ operation, root: descriptor })).rejects.toThrow('Unknown operation');
    expect(Object.getOwnPropertyNames(FileGitMetadata.prototype).sort()).toEqual(['blame', 'cancel', 'closeOwner', 'constructor', 'request', 'status']);
    expect(snapshot(join(fixture, 'project'))).toEqual(before);
    rows.push({ case: 'M9-T-S10', rejectedRPCMethods: rejected, registeredGitRoutes: [...f.handlers.keys()].filter(name => /git/i.test(name)), allRegisteredRoutes: [...f.handlers.keys()].sort(), extraSchemaKeysRejectedBeforeNative: true, rootLeaseCannotBeSaveDocumentRef: true, unknownNativeGitOperationsRejected: true, worktreeAndGitMetadataUnchanged: true });
  });
});

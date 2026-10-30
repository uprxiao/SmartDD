import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync, openSync, closeSync, writeSync, unlinkSync, truncateSync, linkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NativeFileBroker, type NativeFileResult, type RootDescriptor } from './native-broker';
import { FILE_LIMITS, type FileEntry, type FileRoot, type FileSaveReceipt, type FileWatchUpdate, type FileRasterPreview } from '@shared/files';
import { FileRootsService, type RootSource } from './roots';
import { FileRecoveryStore, recoveryProjectKey } from './recovery-store';
import { FileService } from './file-service';
import { FileWatchService } from './watch-service';
import { parseGitBlame, parseGitStatus } from './git-metadata';
import { MEDIA_LIMIT } from '@shared/file-media';
import { buildHtmlResources } from './html/resources';
import { documentReferences } from './html/references';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const descriptor = (path: string): RootDescriptor => {
  const s = statSync(path, { bigint: true }); return { path: realpathSync(path), identity: { device: String(s.dev), inode: String(s.ino) } };
};
let buildDir: string, fixture: string, project: string, userData: string, broker: NativeFileBroker;
describe.skipIf(process.platform !== 'darwin')('native file boundary (real macOS filesystem)', () => {
  beforeAll(() => {
    buildDir = mkdtempSync(join(tmpdir(), 'willyou-files-test-build-'));
    // Selected tests that do not use suspension failpoints can validate the
    // actual packaged production helper without compiling another executable.
    const executable = process.env.SMARTDD_M9_FILE_BROKER ?? join(buildDir, 'willyou-files-test');
    if (!process.env.SMARTDD_M9_FILE_BROKER) execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-O1', '-Wno-deprecated-declarations', '-DWILLYOU_FILE_BROKER_TEST=1', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-framework', 'CoreText', resolve('native/files/broker.mm'), '-o', executable]);
    broker = new NativeFileBroker(executable);
  });
  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-files-test-')));
    project = join(fixture, 'project'); userData = join(fixture, 'user-data');
    mkdirSync(project); mkdirSync(userData); writeFileSync(join(project, 'a.txt'), 'BASE\r\n');
  });
  afterEach(() => { broker.dispose(); rmSync(fixture, { recursive: true, force: true }); });
  afterAll(() => rmSync(buildDir, { recursive: true, force: true }));
  const read = (relativePath: string, extra = {}) => broker.request<NativeFileResult>({ operation: 'read', root: descriptor(project), relativePath, ...extra });
  const saveRequest = async (extra = {}) => {
    const recoveryRoot = await broker.request<RootDescriptor>({ operation: 'initialize-recovery', path: userData });
    return { operation: 'save', root: descriptor(project), recoveryRoot, relativePath: 'a.txt', projectKey: 'project-test', opId: randomUUID(), installationId: 'test-installation', fingerprint: hash('payload'), source: { kind: 'project-directory', id: 'dir-id', scope: { kind: 'project', projectId: 'project-id' } }, baseHash: hash('BASE\r\n'), draftHash: hash('EDIT\n'), base64: Buffer.from('EDIT\n').toString('base64'), bufferVersion: 1, ...extra };
  };
  const makeService = (sources: RootSource[] = [{ kind: 'project-directory', id: 'dir-1', path: project, label: 'Project', projectId: 'project-1' }]) => {
    const resolver = { sources: () => sources };
    return new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userData, resolver));
  };
  const rootOf = async (service: FileService, owner = 'frame-1') => (await service.openScope(owner, { kind: 'project', projectId: 'project-1' })).roots[0];
  it('persists and recovers an Office draft beyond the text budget without weakening text limits',async()=>{
    writeFileSync(join(project,'large.xlsx'),'synthetic office source');
    const service=makeService(),root=await rootOf(service),file=await service.open('frame-1',{lease:root.lease,generation:root.generation,relativePath:'large.xlsx'});
    const bytes=Buffer.alloc(21*1024*1024,23),draftId=randomUUID(),request={ref:file.ref,draftId,bufferVersion:1,baseHash:file.revision.hash,base64:bytes.toString('base64'),encoding:'ooxml-draft' as const,bom:false};
    try {
      // Office source writes must use the fidelity-checked document service.
      // Check the native recovery budget separately, without opening that route.
      await expect(service.checkpoint('frame-1',request)).rejects.toThrow('保真校验');
      await service.recovery.ready();
      const {scope,descriptor:nativeRoot}=service.roots.require('frame-1',root),projectKey=recoveryProjectKey('project-1');
      const checkpoint={operation:'checkpoint',root:nativeRoot,relativePath:'large.xlsx',recoveryRoot:service.recovery.descriptor(),source:{kind:'project-directory',id:'dir-1',scope},projectKey,fingerprint:hash(JSON.stringify({root:nativeRoot,path:'large.xlsx',scope})),draftId,bufferVersion:request.bufferVersion,baseHash:request.baseHash,base64:request.base64,encoding:request.encoding,bom:request.bom};
      const receipt=await broker.request<{draftId:string;bufferVersion:number;hash:string}>(checkpoint);
      expect(await broker.request(checkpoint)).toEqual(receipt);
      await service.recovery.refreshRecord(projectKey,draftId);
      const text=await service.open('frame-1',{lease:root.lease,generation:root.generation,relativePath:'a.txt'});
      await expect(service.checkpoint('frame-1',{...request,ref:text.ref,draftId:randomUUID(),encoding:'utf-8'})).rejects.toThrow('上限');
      const recovered=await service.readDraft('frame-1',file.ref,draftId); expect(Buffer.from(recovered.base64,'base64').equals(bytes)).toBe(true); expect(recovered.encoding).toBe('ooxml-draft');
      await expect(service.save('frame-1',{ref:file.ref,opId:randomUUID(),bufferVersion:1,baseHash:file.revision.hash,base64:Buffer.from('unaudited candidate').toString('base64')})).rejects.toThrow('保真校验');
      expect(readFileSync(join(project,'large.xlsx'),'utf8')).toBe('synthetic office source');
      expect(await service.resolveDraft('frame-1',{ref:file.ref,draftId,bufferVersion:1,hash:receipt.hash,action:'discard'})).toEqual({resolved:true});
      expect(service.drafts('frame-1',file.ref)).toEqual([]);
    } finally {service.closeOwner('frame-1');}
  },20_000);
  it('maps HTML resources through the real root FD, denies foreign owners and escaping links, and revokes on source changes', async () => {
    writeFileSync(join(project, 'index.html'), '<link rel="stylesheet" href="style.css"><img src="outside.png"><script src="app.js"></script>');
    writeFileSync(join(project, 'style.css'), 'p { color: teal; }'); writeFileSync(join(project, 'app.js'), 'document.title="fixture";');
    const outside = join(fixture, 'outside.png'); writeFileSync(outside, 'outside-data'); symlinkSync(outside, join(project, 'outside.png'));
    const service = makeService(), root = await rootOf(service), file = await service.open('frame-1', { lease: root.lease, generation: root.generation, relativePath: 'index.html' });
    expect(() => service.htmlSource('foreign', file.ref)).toThrow('UNTRUSTED');
    const source = service.htmlSource('frame-1', file.ref), graph = await buildHtmlResources(source, 'a'.repeat(64), documentReferences, new AbortController().signal);
    expect([...graph.resources.values()].map((item) => item.path).sort()).toEqual(['app.js', 'index.html', 'style.css']); expect(graph.warnings).toContain('本地资源不可读取');
    await expect(source.read('../outside.png', 1024, new AbortController().signal)).rejects.toThrow();
    await expect(source.read('style.css', 2, new AbortController().signal)).rejects.toThrow('TOO_LARGE');
    writeFileSync(join(project, 'index.html'), '<p>changed</p>'); await service.refresh('frame-1', file.ref); expect(() => source.assert()).toThrow('CHANGED');
    const current = service.htmlSource('frame-1', file.ref); service.closeScope('frame-1', { kind: 'project', projectId: 'project-1' }); expect(current.signal.aborted).toBe(true); expect(() => current.assert()).toThrow();
    service.closeOwner('frame-1');
  });
  it('classifies only the authorized revision sample and preserves the complete original bytes', async () => {
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8192, 65)]);
    writeFileSync(join(project, 'misleading.txt'), png);
    const result = await broker.request<NativeFileResult>({ operation: 'stat', root: descriptor(project), relativePath: 'misleading.txt' });
    expect(Buffer.from(result.sampleBase64!, 'base64')).toEqual(png.subarray(0, 4096));
    expect(result.base64).toBeUndefined();
    const service = makeService(), root = await rootOf(service), file = await service.open('frame-1', { lease: root.lease, generation: root.generation, relativePath: 'misleading.txt' });
    expect(file.content).toMatchObject({ kind: 'image', mime: 'image/png', basis: 'signature' });
    expect(readFileSync(join(project, 'misleading.txt'))).toEqual(png);
    writeFileSync(join(project, 'misleading.txt'), 'now text');
    expect((await service.refresh('frame-1', file.ref)).content?.kind).toBe('text');
    service.closeOwner('frame-1');
  });
  const at = (root: FileRoot, relativePath: string) => ({ lease: root.lease, generation: root.generation, relativePath });
  it('enforces the media budget in native IO and both transport capabilities at 128MiB -1/equal/+1', async () => {
    const service = makeService(), root = await rootOf(service);
    for (const size of [MEDIA_LIMIT - 1, MEDIA_LIMIT, MEDIA_LIMIT + 1]) {
      const name = `boundary-${size}.mp4`, path = join(project, name); writeFileSync(path, 'synthetic'); truncateSync(path, size);
      const file = await service.open('frame-1', at(root, name));
      for (const protocol of [false, true]) {
        service.media.setProtocolAvailable(protocol);
        const input = { id: randomUUID(), ref: file.ref, baseHash: file.revision.hash };
        if (size > MEDIA_LIMIT) await expect(service.media.open('frame-1', input)).rejects.toThrow('TOO_LARGE');
        else {
          const source = await service.media.open('frame-1', input); expect(source.transport).toBe(protocol ? 'protocol' : 'binary');
          expect(Buffer.from(await service.media.chunk('frame-1', input.id, size - 1, 1), 'base64')).toEqual(Buffer.from([0]));
          service.media.release('frame-1', input.id);
        }
      }
      if (size > MEDIA_LIMIT) await expect(broker.request({ operation: 'chunk', root: descriptor(project), relativePath: name, offset: 0, length: 1, expectedRevision: file.revision, resourceLimit: MEDIA_LIMIT })).rejects.toThrow('TOO_LARGE');
    }
    service.closeOwner('frame-1');
  }, 30_000);
  it('invalidates media streams on replacement, cross-window access, document close and root replacement', async () => {
    const service = makeService(), root = await rootOf(service); service.media.setProtocolAvailable(true);
    writeFileSync(join(project, 'clip.wav'), Buffer.alloc(2 * FILE_LIMITS.chunk, 1));
    const file = await service.open('frame-1', at(root, 'clip.wav'));
    const input = { id: randomUUID(), ref: file.ref, baseHash: file.revision.hash }, source = await service.media.open('frame-1', input);
    await expect(service.media.open('other', { ...input, id: randomUUID() })).rejects.toThrow('UNTRUSTED');
    const response = await service.media.handle(new Request(source.url!)), reader = response.body!.getReader();
    expect((await reader.read()).value?.length).toBe(FILE_LIMITS.chunk);
    writeFileSync(join(project, 'clip.wav'), Buffer.alloc(2 * FILE_LIMITS.chunk, 2));
    await expect(reader.read()).rejects.toThrow('CHANGED');
    service.closeDocument('frame-1', file.ref); expect(service.media.allows('frame-1', source.url!)).toBe(false);
    const fresh = await service.open('frame-1', at(root, 'clip.wav')), freshSource = await service.media.open('frame-1', { id: randomUUID(), ref: fresh.ref, baseHash: fresh.revision.hash });
    renameSync(project, project + '-old'); mkdirSync(project);
    const stale = await service.media.handle(new Request(freshSource.url!)); expect(stale.status).toBe(410);
    service.closeOwner('frame-1');
  });
  const git = (...args: string[]) => execFileSync('/Library/Developer/CommandLineTools/usr/bin/git', ['-C', project, ...args], { env: { PATH: '/usr/bin:/bin', HOME: fixture, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8' });
  const gitFixture = () => {
    git('init', '-q'); git('config', 'user.name', 'M9 Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(project, 'tracked.txt'), 'first\nsecond 中文🙂\nthird\n'); writeFileSync(join(project, '.gitattributes'), 'generated.js linguist-generated=true\nmanual.js -linguist-generated\n');
    writeFileSync(join(project, 'generated.js'), 'original\n'); writeFileSync(join(project, 'manual.js'), 'original\n'); writeFileSync(join(project, 'deleted.txt'), 'remove me\n');
    git('add', '.'); git('commit', '-qm', 'Synthetic initial commit');
  };
  it('reads real Git states/attributes within a nested root without writing the index', async () => {
    gitFixture(); const indexBefore = readFileSync(join(project, '.git/index'));
    writeFileSync(join(project, 'generated.js'), 'changed\n'); writeFileSync(join(project, 'manual.js'), 'changed\n'); unlinkSync(join(project, 'deleted.txt')); writeFileSync(join(project, 'untracked 中文🙂.txt'), 'new\n');
    const result = await broker.request<any>({ operation: 'git-status', root: descriptor(project) });
    const entries = parseGitStatus(result); expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'generated.js', status: 'modified', generated: true }), expect.objectContaining({ relativePath: 'manual.js', generated: false }), expect.objectContaining({ relativePath: 'deleted.txt', status: 'deleted' }), expect.objectContaining({ relativePath: 'untracked 中文🙂.txt', status: 'untracked', generated: null }),
    ])); expect(readFileSync(join(project, '.git/index'))).toEqual(indexBefore);
    mkdirSync(join(project, 'nested')); writeFileSync(join(project, 'nested/inside.txt'), 'inside');
    const nested = await broker.request<any>({ operation: 'git-status', root: descriptor(join(project, 'nested')) });
    expect(parseGitStatus(nested).map((entry) => entry.relativePath)).toEqual(['inside.txt']);
  });
  it('returns exact real blame lines and rejects modified contents or a replaced root', async () => {
    gitFixture(); const file = await read('tracked.txt');
    const input = { operation: 'git-blame', root: descriptor(project), relativePath: 'tracked.txt', expectedIdentity: { device: file.revision.device, inode: file.revision.inode }, baseHash: file.revision.hash, lineStart: 1, lineEnd: 3 };
    const result = await broker.request<any>(input); expect(parseGitBlame(result.blameBase64, 1, 3)).toEqual([1, 2, 3].map((line) => expect.objectContaining({ line, author: 'M9 Fixture', summary: 'Synthetic initial commit' })));
    await expect(broker.request({ ...input, testStopAt: 'git-read' }, { onTestStop: (_, child) => { writeFileSync(join(project, 'tracked.txt'), 'replaced\n'); child.kill('SIGCONT'); } })).rejects.toThrow('CHANGED');
    const changed = await read('tracked.txt'); expect(await broker.request({ ...input, expectedIdentity: { device: changed.revision.device, inode: changed.revision.inode }, baseHash: changed.revision.hash, lineEnd: 1 })).toMatchObject({ state: 'unavailable' });
    await expect(broker.request({ operation: 'git-status', root: descriptor(project), testStopAt: 'git-finished' }, { onTestStop: (_, child) => { renameSync(project, `${project}-old`); mkdirSync(project); child.kill('SIGCONT'); } })).rejects.toThrow('STALE_ROOT');
  });
  it('keeps hostile filter/fsmonitor helpers from running and makes their failure explicit', async () => {
    gitFixture(); const marker = join(fixture, 'helper-ran'), script = join(fixture, 'helper'); writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o700 });
    git('config', 'core.fsmonitor', script); git('config', 'filter.hostile.clean', script); git('config', 'filter.hostile.required', 'true');
    // A different byte length can let Git report "modified" without invoking
    // conversion. Same-size changed contents force the clean-filter path.
    writeFileSync(join(project, '.gitattributes'), '* filter=hostile\n'); writeFileSync(join(project, 'tracked.txt'), Buffer.alloc(readFileSync(join(project, 'tracked.txt')).length, 88));
    const index = readFileSync(join(project, '.git/index'));
    await expect(broker.request({ operation: 'git-status', root: descriptor(project) })).rejects.toThrow('external filters'); expect(existsSync(marker)).toBe(false); expect(readFileSync(join(project, '.git/index'))).toEqual(index);
    // Benign own-fixture control: no fsmonitor, so this marker proves the
    // clean helper is executable and requested when sandboxing is absent.
    git('-c', 'core.fsmonitor=false', 'status', '--porcelain'); expect(existsSync(marker)).toBe(true);
  });
  it('binds Git queries to the owning scope and does not expose arbitrary commands', async () => {
    gitFixture(); const service = makeService(), lease = await rootOf(service), root = { lease: lease.lease, generation: lease.generation };
    expect((await service.git.status('frame-1', { id: randomUUID(), root })).state).toBe('ready');
    await expect(service.git.status('frame-2', { id: randomUUID(), root })).rejects.toThrow('UNTRUSTED');
    const cancelled = randomUUID(); service.git.cancel('frame-1', cancelled); await expect(service.git.status('frame-1', { id: cancelled, root })).rejects.toThrow('CANCELLED');
    await expect(broker.request({ operation: 'git-commit', root: descriptor(project) })).rejects.toThrow('Unknown operation');
    service.closeOwner('frame-1'); await expect(service.git.status('frame-1', { id: randomUUID(), root })).rejects.toThrow('UNTRUSTED');
  });
  it('supports worktree metadata outside the file root and reports a non-Git directory', async () => {
    expect(await broker.request({ operation: 'git-status', root: descriptor(project) })).toMatchObject({ state: 'unavailable' });
    gitFixture(); const worktree = join(fixture, 'worktree'); git('worktree', 'add', '-qb', 'fixture-worktree', worktree);
    writeFileSync(join(worktree, 'tracked.txt'), 'worktree edit\n');
    const result = await broker.request<any>({ operation: 'git-status', root: descriptor(worktree) }); expect(parseGitStatus(result)).toEqual([expect.objectContaining({ relativePath: 'tracked.txt', status: 'modified' })]);
  });
  const rootRef = (root: FileRoot) => ({ lease: root.lease, generation: root.generation });

  const copyRequest = async (path = join(fixture, '副本 空格🙂.txt'), extra = {}) => ({
    ...await saveRequest(), operation: 'copy', expectedRevision: (await read('a.txt')).revision,
    destination: await broker.request({ operation: 'inspect-copy-target', path }), ...extra,
  });
  it('creates an exact independent copy and preserves an existing destination in its journal', async () => {
    const destination = join(fixture, '副本 空格🙂.txt'), input = await copyRequest(destination);
    const result = await broker.request<FileSaveReceipt>(input);
    expect(result.state).toBe('saved'); expect(result.revision?.hash).toBe(hash('BASE\r\n'));
    expect(readFileSync(destination, 'utf8')).toBe('BASE\r\n'); expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
    expect(statSync(destination).ino).not.toBe(statSync(join(project, 'a.txt')).ino);
    writeFileSync(destination, 'previous destination');
    const overwrite = await copyRequest(destination); expect((await broker.request<FileSaveReceipt>(overwrite)).state).toBe('saved');
    expect(readFileSync(join(fixture, `.willyou-recovery-test-installation-${overwrite.opId}`, 'candidate'), 'utf8')).toBe('previous destination');
    const journal = JSON.parse(readFileSync(join(overwrite.recoveryRoot.path, overwrite.projectKey, overwrite.opId, 'journal.json'), 'utf8'));
    expect(journal.kind).toBe('copy'); expect(journal.copySourceRoot.identity).toEqual(descriptor(project).identity);
  });
  it('rejects source aliases, symlink destinations and modified source bytes without writing a copy', async () => {
    const hardlink = join(fixture, 'source-link.txt'); linkSync(join(project, 'a.txt'), hardlink);
    await expect(broker.request(await copyRequest(hardlink))).rejects.toThrow('cannot overwrite its source');
    const symlink = join(fixture, 'source-symlink.txt'); symlinkSync(join(project, 'a.txt'), symlink);
    await expect(copyRequest(symlink)).rejects.toThrow('OUTSIDE_ROOT');
    const destination = join(fixture, 'new.txt'), input = await copyRequest(destination); writeFileSync(join(project, 'a.txt'), 'new source');
    await expect(broker.request(input)).rejects.toThrow('CHANGED'); expect(existsSync(destination)).toBe(false);
  });
  it('does not clobber a destination created between the native dialog and atomic creation', async () => {
    const destination = join(fixture, 'racing.txt'), input = await copyRequest(destination, { testStopAt: 'copy-prepared' });
    const result = await broker.request<FileSaveReceipt>(input, { onTestStop: (_, child) => { writeFileSync(destination, 'external winner'); child.kill('SIGCONT'); } });
    expect(result.state).toBe('conflict'); expect(readFileSync(destination, 'utf8')).toBe('external winner');
    expect(readFileSync(join(input.recoveryRoot.path, input.projectKey, input.opId, 'draft'), 'utf8')).toBe('BASE\r\n');
  });
  it('preserves a post-install external writer and reports the copy as a conflict', async () => {
    const destination = join(fixture, 'racing.txt'), input = await copyRequest(destination, { testStopAt: 'copy-installed' });
    const result = await broker.request<FileSaveReceipt>(input, { onTestStop: (_, child) => { writeFileSync(destination, 'external after install'); child.kill('SIGCONT'); } });
    expect(result.state).toBe('conflict'); expect(readFileSync(destination, 'utf8')).toBe('external after install');
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
  });
  it('rejects replaced save-dialog parents and changed overwrite targets', async () => {
    const parent = join(fixture, 'out'); mkdirSync(parent);
    const input = await copyRequest(join(parent, 'out.txt')); renameSync(parent, `${parent}-old`); mkdirSync(parent);
    await expect(broker.request(input)).rejects.toThrow('STALE_ROOT'); expect(readdirSync(parent)).toEqual([]);
    const destination = join(fixture, 'existing.txt'); writeFileSync(destination, 'old'); const overwrite = await copyRequest(destination);
    writeFileSync(destination, 'new'); await expect(broker.request(overwrite)).rejects.toThrow('CONFLICT'); expect(readFileSync(destination, 'utf8')).toBe('new');
  });
  it('binds copy dialogs to the owning document and protects their transaction after restart', async () => {
    const service = makeService(), root = await rootOf(service), file = await service.open('frame-1', at(root, 'a.txt'));
    const target = { kind: 'document' as const, ref: file.ref };
    await expect(service.actions.prepareCopy('frame-2', { target })).rejects.toThrow('UNTRUSTED');
    const selection = await service.actions.prepareCopy('frame-1', { target, draftBase64: Buffer.from('UNSAVED\r\n').toString('base64') });
    const destination = join(project, 'copy.txt'), receipt = await service.actions.copyTo('frame-1', selection, destination);
    expect(receipt).toMatchObject({ state: 'saved', hash: hash('UNSAVED\r\n') }); expect(readFileSync(destination, 'utf8')).toBe('UNSAVED\r\n'); expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
    await expect(service.actions.copyTo('frame-1', selection, join(project, 'again.txt'))).rejects.toThrow('UNTRUSTED');
    const fresh = makeService(), freshRoot = await rootOf(fresh), names = (await fresh.list('frame-1', at(freshRoot, ''))).map((e) => e.name);
    expect(names.sort()).toEqual(['a.txt', 'copy.txt']); expect(fresh.recovery.items().some((item) => item.state === 'invalid')).toBe(false);
    const pending = await fresh.actions.prepareCopy('frame-1', { target: { kind: 'path', path: at(freshRoot, 'a.txt'), directory: false } });
    fresh.closeOwner('frame-1'); await expect(fresh.actions.copyTo('frame-1', pending, join(project, 'stale.txt'))).rejects.toThrow('UNTRUSTED');
    service.closeOwner('frame-1');
  });
  it.each(['copy-prepared', 'copy-installed'])('blocks a copy destination after a killed transaction at %s and restart', async (phase) => {
    const destination = join(fixture, 'interrupted.txt');
    const input = await copyRequest(destination, { testStopAt: phase, projectKey: recoveryProjectKey('project-1'), source: { kind: 'project-directory', id: 'dir-1', scope: { kind: 'project', projectId: 'project-1' } } });
    await expect(broker.request(input, { onTestStop: (_, child) => child.kill('SIGKILL') })).rejects.toThrow('broker 意外退出');
    expect(existsSync(destination)).toBe(phase === 'copy-installed');
    const service = makeService(), root = await rootOf(service);
    const selection = await service.actions.prepareCopy('frame-1', { target: { kind: 'path', path: at(root, 'a.txt'), directory: false } });
    expect(service.recovery.items().find((item) => item.id === input.opId)?.state).toBe('needs-inspection');
    await expect(service.actions.copyTo('frame-1', selection, destination)).rejects.toThrow('结果未确认');
    expect(readFileSync(join(input.recoveryRoot.path, input.projectKey, input.opId, 'draft'), 'utf8')).toBe('BASE\r\n'); service.closeOwner('frame-1');
  });

  it('decodes oversized embedded rasters into bounded previews in the native child', async () => {
    const width = 6000, height = 2000;
    const crc32 = (data: Buffer) => { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
    const chunk = (name: string, data: Buffer) => { const size = Buffer.alloc(4), body = Buffer.concat([Buffer.from(name), data]), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]); };
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    const pixels = Buffer.alloc((width * 4 + 1) * height, 255); for (let row = 0; row < height; row++) pixels[row * (width * 4 + 1)] = 0;
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
    const result = await broker.request<FileRasterPreview>({ operation: 'raster-preview', mime: 'image/png', base64: png.toString('base64') });
    expect(result.originalWidth).toBe(width); expect(result.originalHeight).toBe(height); expect(result.downscaled).toBe(true);
    expect(result.width * result.height).toBeLessThanOrEqual(4 * 1024 * 1024); expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(4096);
    const actual = Buffer.from(result.base64, 'base64'); expect(actual.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); expect(actual.readUInt32BE(16)).toBe(result.width); expect(actual.readUInt32BE(20)).toBe(result.height);
    await expect(broker.request({ operation: 'raster-preview', mime: 'image/jpeg', base64: png.toString('base64') })).rejects.toThrow('MIME');
    await expect(broker.request({ operation: 'raster-preview', mime: 'image/png', base64: Buffer.from('not an image').toString('base64') })).rejects.toThrow();
  });
  it('binds image decoding and cancellable resource requests to the owning document', async () => {
    const service = makeService(), root = await rootOf(service), file = await service.open('frame-1', at(root, 'a.txt'));
    const request = { id: randomUUID(), baseHash: file.revision.hash, mime: 'image/png' as const, base64: 'YWJj' };
    await expect(service.raster('frame-2', file.ref, request)).rejects.toThrow('UNTRUSTED');
    await expect(service.raster('frame-1', file.ref, { ...request, baseHash: hash('stale') })).rejects.toThrow('CHANGED');
    const resourceId = randomUUID(); service.cancelResource('frame-2', resourceId);
    expect(Buffer.from(await service.chunk('frame-1', file.ref, 0, 6, file.revision.hash, resourceId), 'base64').toString()).toBe('BASE\r\n');
    service.cancelResource('frame-1', resourceId);
    await expect(service.chunk('frame-1', file.ref, 0, 6, file.revision.hash, resourceId)).rejects.toThrow('CANCELLED');
    expect(Buffer.from(await service.chunk('frame-1', file.ref, 0, 6, file.revision.hash, randomUUID()), 'base64').toString()).toBe('BASE\r\n');
    service.closeOwner('frame-1');
  });

  it('returns exact bytes and a stable content revision', async () => {
    const result = await read('a.txt');
    expect(Buffer.from(result.base64!, 'base64').toString()).toBe('BASE\r\n');
    expect(result.revision.hash).toBe(hash('BASE\r\n'));
    expect(result.revision.inode).toBe(String(statSync(join(project, 'a.txt'), { bigint: true }).ino));
  });
  it('resolves document-local references within the same trusted root', async () => {
    mkdirSync(join(project, 'docs')); writeFileSync(join(project, 'docs', 'readme.md'), '# source');
    writeFileSync(join(project, '中 文.svg'), '<svg/>');
    const service = makeService(), root = await rootOf(service), doc = await service.open('frame-1', at(root, 'docs/readme.md'));
    const image = await service.related('frame-1', doc.ref, '../%E4%B8%AD%20%E6%96%87.svg');
    expect(image.relativePath).toBe('中 文.svg');
    await expect(service.related('frame-2', doc.ref, '../a.txt')).rejects.toThrow('UNTRUSTED');
    await expect(service.related('frame-1', doc.ref, '../../outside')).rejects.toThrow();
    await expect(service.related('frame-1', doc.ref, '%2e%2e/%2e%2e/outside')).rejects.toThrow();
    await expect(service.related('frame-1', doc.ref, 'https://no-network.invalid/file')).rejects.toThrow();
    service.closeDocument('frame-1', image.ref);
  });
  it('lists dotfiles and normally excluded search directories without reading special files', async () => {
    mkdirSync(join(project, '.git')); mkdirSync(join(project, 'node_modules')); writeFileSync(join(project, '.env'), 'fixture');
    execFileSync('/usr/bin/mkfifo', [join(project, 'pipe')]);
    const result = await broker.request<{ entries: FileEntry[] }>({ operation: 'list', root: descriptor(project), relativePath: '' });
    expect(result.entries.map((e) => e.name)).toEqual(expect.arrayContaining(['.git', 'node_modules', '.env', 'pipe']));
    expect(result.entries.find((e) => e.name === 'pipe')?.kind).toBe('unavailable');
    await expect(read('pipe')).rejects.toThrow('NOT_REGULAR');
  });
  it('resolves only contained symbolic links, including nested relative aliases', async () => {
    mkdirSync(join(project, 'sub')); symlinkSync('../a.txt', join(project, 'sub', 'alias'));
    expect((await read('sub/alias')).relativePath).toBe('a.txt');
    writeFileSync(join(fixture, 'secret'), 'do not read'); symlinkSync('../secret', join(project, 'escape'));
    await expect(read('escape')).rejects.toThrow('OUTSIDE_ROOT');
    await expect(read('../secret')).rejects.toThrow('OUTSIDE_ROOT');
    symlinkSync('loop', join(project, 'loop')); await expect(read('loop')).rejects.toThrow('OUTSIDE_ROOT');
  });
  it('rejects root replacement and bounded reads before returning content', async () => {
    const original = descriptor(project); renameSync(project, `${project}-old`); mkdirSync(project); writeFileSync(join(project, 'a.txt'), 'replacement');
    await expect(broker.request({ operation: 'read', root: original, relativePath: 'a.txt' })).rejects.toThrow('STALE_ROOT');
    await expect(read('a.txt', { byteLimit: 4 })).rejects.toThrow('TOO_LARGE');
    await expect(read('a.txt', { expectedHash: hash('old') })).rejects.toThrow('CHANGED');
  });
  it('filters internal identities through aliases but keeps user lookalikes', async () => {
    const privateDir = join(project, 'private'); mkdirSync(privateDir); writeFileSync(join(privateDir, 'draft'), 'private');
    mkdirSync(join(project, '.willyou-recovery-user-file')); symlinkSync('private', join(project, 'alias'));
    const protectedIds = [descriptor(privateDir).identity];
    const result = await broker.request<{ entries: FileEntry[] }>({ operation: 'list', root: descriptor(project), relativePath: '', protected: protectedIds });
    expect(result.entries.map((e) => e.name).sort()).toEqual(['.willyou-recovery-user-file', 'a.txt'].sort());
    await expect(read('alias/draft', { protected: protectedIds })).rejects.toThrow('INTERNAL_OBJECT');
  });
  it('rejects listing an alias below a protected canonical ancestor rather than returning a false empty directory', async () => {
    const privateDir = join(project, 'private'); mkdirSync(join(privateDir, 'inner'), { recursive: true });
    writeFileSync(join(privateDir, 'inner', 'draft'), 'Private synthetic draft');
    symlinkSync('private/inner', join(project, 'inner-alias'));
    await expect(broker.request({ operation: 'list', root: descriptor(project), relativePath: 'inner-alias', protected: [descriptor(privateDir).identity] })).rejects.toThrow('INTERNAL_OBJECT');
  });
  it('rechecks protected root ancestors after a directory list even when the root inode and source path survive', async () => {
    const parent = join(project, 'registered-parent'), root = join(parent, 'root'), privateDir = join(project, 'private');
    mkdirSync(root, { recursive: true }); mkdirSync(privateDir); writeFileSync(join(root, 'file.txt'), 'Synthetic root metadata');
    const originalRoot = descriptor(root), protectedIds = [descriptor(privateDir).identity];
    await expect(broker.request({ operation: 'list', root: originalRoot, relativePath: '', protected: protectedIds, testStopAt: 'list-entries-ready' }, {
      onTestStop: (_, child) => {
        renameSync(parent, join(project, 'registered-old')); renameSync(privateDir, parent);
        renameSync(join(project, 'registered-old', 'root'), root);
        expect(descriptor(root).identity).toEqual(originalRoot.identity); child.kill('SIGCONT');
      },
    })).rejects.toThrow('INTERNAL_OBJECT');
  });
  it('saves exact bytes while retaining the independent draft and both inodes', async () => {
    chmodSync(join(project, 'a.txt'), 0o640);
    execFileSync('/usr/bin/xattr', ['-w', 'com.willyou.test', 'kept', join(project, 'a.txt')]);
    const input = await saveRequest(); const transactions: string[] = [];
    const result = await broker.request<FileSaveReceipt>(input, { onTransaction: (_, id) => transactions.push(id) });
    expect(result.state).toBe('saved'); expect(result.revision?.hash).toBe(hash('EDIT\n'));
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('EDIT\n');
    const txn = join(project, `.willyou-recovery-test-installation-${input.opId}`);
    expect(readFileSync(join(txn, 'candidate'), 'utf8')).toBe('BASE\r\n');
    expect(readFileSync(join(txn, 'materialized'), 'utf8')).toBe('EDIT\n');
    const record = join(input.recoveryRoot.path, input.projectKey, input.opId);
    expect(readFileSync(join(record, 'draft'), 'utf8')).toBe('EDIT\n');
    expect(statSync(join(record, 'draft')).ino).not.toBe(statSync(join(project, 'a.txt')).ino);
    expect(statSync(join(project, 'a.txt')).mode & 0o777).toBe(0o640);
    expect(execFileSync('/usr/bin/xattr', ['-p', 'com.willyou.test', join(project, 'a.txt')], { encoding: 'utf8' }).trim()).toBe('kept');
    expect(JSON.parse(readFileSync(join(record, 'journal.json'), 'utf8')).receipt).toEqual(result);
    expect(transactions).toEqual([input.opId]);
    writeFileSync(join(project, 'a.txt'), 'later edit');
    expect(await broker.request(input)).toEqual(result);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('later edit');
    await expect(broker.request({ ...input, fingerprint: hash('another-payload') })).rejects.toThrow('IDEMPOTENCY');
  });
  it('refuses an already changed base without creating a transaction', async () => {
    const input = await saveRequest(); writeFileSync(join(project, 'a.txt'), 'EXTERNAL');
    await expect(broker.request(input)).resolves.toMatchObject({ state: 'conflict' });
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('EXTERNAL');
    expect(readdirSync(project)).toEqual(['a.txt']);
  });
  it('rejects a same-content replacement after main preflight without creating a transaction', async () => {
    const expectedRevision = (await read('a.txt')).revision;
    const input = await saveRequest({ expectedRevision });
    writeFileSync(join(project, 'replacement.txt'), 'BASE\r\n'); renameSync(join(project, 'replacement.txt'), join(project, 'a.txt'));
    const replacement = (await read('a.txt')).revision;
    expect(replacement.hash).toBe(expectedRevision.hash); expect(replacement.inode).not.toBe(expectedRevision.inode);
    expect(await broker.request(input)).toMatchObject({ state: 'conflict' });
    expect((await read('a.txt')).revision).toEqual(replacement); expect(readdirSync(project)).toEqual(['a.txt']);
    expect(readdirSync(input.recoveryRoot.path)).toEqual([]);
  });
  it('accepts the exact preflight revision and replays its receipt after later external changes', async () => {
    const input = await saveRequest({ expectedRevision: (await read('a.txt')).revision });
    const receipt = await broker.request<FileSaveReceipt>(input); expect(receipt.state).toBe('saved');
    writeFileSync(join(project, 'a.txt'), 'external after save'); expect(await broker.request(input)).toEqual(receipt);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('external after save');
  });
  it('preserves changes made to the old open fd during exchange and never swaps back', async () => {
    const input = await saveRequest({ testStopAt: 'swapped' }); const oldFd = openSync(join(project, 'a.txt'), 'r+');
    try {
      const result = await broker.request<FileSaveReceipt>(input, { onTestStop: (_, child) => {
        writeSync(oldFd, 'EXTERNAL-OLD-FD', 0, 'utf8'); child.kill('SIGCONT');
      } });
      expect(result.state).toBe('conflict');
      expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('EDIT\n');
      expect(readFileSync(join(project, `.willyou-recovery-test-installation-${input.opId}`, 'candidate'), 'utf8')).toBe('EXTERNAL-OLD-FD');
    } finally { closeSync(oldFd); }
  });
  it('preserves a third writer at the target path after exchange', async () => {
    const input = await saveRequest({ testStopAt: 'swapped' });
    const result = await broker.request<FileSaveReceipt>(input, { onTestStop: (_, child) => {
      writeFileSync(join(project, 'replacement'), 'LATEST'); renameSync(join(project, 'replacement'), join(project, 'a.txt')); child.kill('SIGCONT');
    } });
    expect(result.state).toBe('conflict'); expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('LATEST');
    const txn = join(project, `.willyou-recovery-test-installation-${input.opId}`);
    expect(readFileSync(join(txn, 'candidate'), 'utf8')).toBe('BASE\r\n');
    expect(readFileSync(join(txn, 'materialized'), 'utf8')).toBe('EDIT\n');
  });
  it.each(['prepared', 'swapped'])('retains independently recoverable versions after SIGKILL at %s', async (phase) => {
    const input = await saveRequest({ testStopAt: phase });
    await expect(broker.request(input, { onTestStop: (_, child) => child.kill('SIGKILL') })).rejects.toThrow('broker 意外退出');
    expect(readFileSync(join(input.recoveryRoot.path, input.projectKey, input.opId, 'draft'), 'utf8')).toBe('EDIT\n');
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe(phase === 'prepared' ? 'BASE\r\n' : 'EDIT\n');
    expect(JSON.parse(readFileSync(join(input.recoveryRoot.path, input.projectKey, input.opId, 'journal.json'), 'utf8')).state).toBe('prepared');
  });
  it('aborts a pending operation and waits for process termination', async () => {
    const abort = new AbortController();
    const input = await saveRequest({ testStopAt: 'prepared' });
    await expect(broker.request(input, { signal: abort.signal, onTestStop: () => abort.abort() })).rejects.toThrow('CANCELLED');
    expect(broker.activeProcesses).toBe(0); expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
  });
  it('refuses symlinked recovery objects and preexisting transaction directories', async () => {
    const input = await saveRequest();
    symlinkSync(project, join(input.recoveryRoot.path, input.projectKey));
    await expect(broker.request(input)).rejects.toThrow();
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
  });
  it('binds leases and document handles to the issuing frame and generation', async () => {
    const service = makeService(), root = await rootOf(service);
    await expect(service.open('other-frame', at(root, 'a.txt'))).rejects.toThrow('UNTRUSTED');
    const doc = await service.open('frame-1', at(root, 'a.txt'));
    expect(Buffer.from((await service.read('frame-1', doc.ref)).base64, 'base64').toString()).toBe('BASE\r\n');
    await expect(service.read('other-frame', doc.ref)).rejects.toThrow('UNTRUSTED');
    await rootOf(service);
    await expect(service.read('frame-1', doc.ref)).rejects.toThrow('UNTRUSTED');
  });
  it('keeps task cwd independent of later project directory edits and rejects non-local sources', async () => {
    const sources: RootSource[] = [
      { kind: 'task-cwd', id: 'task-1', path: project, label: 'Snapshot', projectId: 'project-1' },
      { kind: 'project-directory', id: 'dir-1', path: project, label: 'Project', projectId: 'project-1' },
      { kind: 'project-directory', id: 'remote', path: 'ssh://example/tmp', label: 'Remote', projectId: 'project-1' },
    ];
    const service = makeService(sources), roots = await service.openScope('frame-1', { kind: 'task', taskId: 'task-1' });
    expect(roots.roots).toHaveLength(2); expect(roots.unavailable[0].sourceId).toBe('remote');
    sources[1].path = userData;
    await expect(service.list('frame-1', at(roots.roots[1], ''))).rejects.toThrow('STALE_ROOT');
    expect((await service.list('frame-1', at(roots.roots[0], ''))).map((e) => e.name)).toContain('a.txt');
  });
  it('invalidates a registered symlink root when its target changes', async () => {
    const alias = join(fixture, 'alias-root'); symlinkSync(project, alias);
    const service = makeService([{ kind: 'project-directory', id: 'alias', path: alias, label: 'Alias', projectId: 'project-1' }]);
    const root = await rootOf(service); unlinkSync(alias); symlinkSync(userData, alias);
    await expect(service.open('frame-1', at(root, 'a.txt'))).rejects.toThrow('STALE_ROOT');
  });
  it('gives aliases one physical document key and serializes competing window saves', async () => {
    symlinkSync('a.txt', join(project, 'alias.txt'));
    const service = makeService(), root = await rootOf(service), otherRoot = await rootOf(service, 'frame-2');
    const first = await service.open('frame-1', at(root, 'a.txt'));
    const alias = await service.open('frame-1', at(root, 'alias.txt'));
    expect(alias.documentKey).toBe(first.documentKey);
    const second = await service.open('frame-2', at(otherRoot, 'a.txt'));
    const request = (ref: typeof first.ref, value: string) => ({ ref, opId: randomUUID(), bufferVersion: 1, baseHash: first.revision.hash, base64: Buffer.from(value).toString('base64') });
    const a = request(first.ref, 'FIRST'), b = request(second.ref, 'SECOND');
    const results = await Promise.all([service.save('frame-1', a), service.save('frame-2', b)]);
    expect(results.map((r) => r.state)).toEqual(['saved', 'conflict']);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('FIRST');
    expect(await service.save('frame-1', a)).toEqual(results[0]);
    await expect(service.save('frame-1', { ...a, base64: Buffer.from('CHANGED REQUEST').toString('base64') })).rejects.toThrow('IDEMPOTENCY');
    expect((await service.list('frame-1', at(root, ''))).map((e) => e.name).sort()).toEqual(['a.txt', 'alias.txt']);
  });
  it('recovers idempotent receipts after restart without overwriting a newer disk file', async () => {
    const service = makeService(), root = await rootOf(service), doc = await service.open('frame-1', at(root, 'a.txt'));
    const request = { ref: doc.ref, opId: randomUUID(), bufferVersion: 3, baseHash: doc.revision.hash, base64: Buffer.from('SAVED').toString('base64') };
    const receipt = await service.save('frame-1', request); expect(receipt.state).toBe('saved');
    writeFileSync(join(project, 'a.txt'), 'EXTERNAL AFTER SAVE');
    const restarted = makeService(), newRoot = await rootOf(restarted), newDoc = await restarted.open('frame-1', at(newRoot, 'a.txt'));
    expect(await restarted.save('frame-1', { ...request, ref: newDoc.ref })).toEqual(receipt);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('EXTERNAL AFTER SAVE');
    expect((await restarted.list('frame-1', at(newRoot, ''))).map((e) => e.name)).toEqual(['a.txt']);
  });
  it('isolates corrupt recovery journals including FIFO while still reporting healthy records', async () => {
    const service = makeService(), root = await rootOf(service), doc = await service.open('frame-1', at(root, 'a.txt'));
    await service.save('frame-1', { ref: doc.ref, opId: randomUUID(), bufferVersion: 1, baseHash: doc.revision.hash, base64: Buffer.from('SAVED').toString('base64') });
    const recoveryPath = join(userData, 'file-recovery/v1', recoveryProjectKey('project-1'));
    const corrupt = join(recoveryPath, randomUUID()); mkdirSync(corrupt, { mode: 0o700 });
    execFileSync('/usr/bin/mkfifo', ['-m', '600', join(corrupt, 'journal.json')]);
    const restarted = makeService(); await restarted.recovery.ready();
    expect(restarted.recovery.items().map((r) => r.state).sort()).toEqual(['invalid', 'saved-history']);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('SAVED');
    expect(statSync(join(corrupt, 'journal.json')).isFIFO()).toBe(true);
  });
  it('rejects recovery quotas before changing disk and accounts for concurrent reservations', async () => {
    const service = makeService(); await service.recovery.ready();
    service.recovery.reserve('p1', 'op1', 0, 250 * 1024 * 1024);
    expect(() => service.recovery.reserve('p1', 'op2', 0, 10 * 1024 * 1024)).toThrow('QUOTA');
    for (let i = 2; i <= 4; i++) service.recovery.reserve(`p${i}`, `op${i}`, 0, 250 * 1024 * 1024);
    expect(() => service.recovery.reserve('p5', 'op5', 0, FILE_LIMITS.globalRecovery)).toThrow('QUOTA');
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
  });
  it('persists evolving drafts independently, retains mixed bytes and restores after restart', async () => {
    const service = makeService(), root = await rootOf(service), doc = await service.open('frame-1', at(root, 'a.txt'));
    const draftId = randomUUID();
    const request = { ref: doc.ref, draftId, bufferVersion: 1, baseHash: doc.revision.hash, base64: Buffer.from('\ufeff草稿😀\r\nA\rB\n').toString('base64'), encoding: 'utf-8' as const, bom: true };
    const first = await service.checkpoint('frame-1', request);
    expect(first.hash).toBe(hash('\ufeff草稿😀\r\nA\rB\n'));
    expect(await service.checkpoint('frame-1', request)).toEqual(first);
    for (let v = 2; v <= 5; v++) await service.checkpoint('frame-1', { ...request, bufferVersion: v, base64: Buffer.from(`草稿 ${v}\r\n`).toString('base64') });
    await expect(service.checkpoint('frame-1', request)).rejects.toThrow('CHANGED');
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
    const recordPath = join(userData, 'file-recovery/v1', recoveryProjectKey('project-1'), draftId);
    expect(readdirSync(recordPath).filter((leaf) => leaf.startsWith('draft-'))).toHaveLength(2);
    const restart = makeService(), restartRoot = await rootOf(restart), newDoc = await restart.open('frame-1', at(restartRoot, 'a.txt'));
    expect(restart.drafts('frame-1', newDoc.ref).map((d) => d.id)).toEqual([draftId]);
    const recovered = await restart.readDraft('frame-1', newDoc.ref, draftId);
    expect(recovered.bufferVersion).toBe(5); expect(recovered.baseHash).toBe(doc.revision.hash);
    expect(Buffer.from(recovered.base64, 'base64').toString()).toBe('草稿 5\r\n');
  });
  it('does not let an old save acknowledgement resolve newer input or another window draft', async () => {
    const service = makeService(), root = await rootOf(service), doc = await service.open('frame-1', at(root, 'a.txt'));
    const request = { ref: doc.ref, draftId: randomUUID(), bufferVersion: 1, baseHash: doc.revision.hash, base64: Buffer.from('FIRST').toString('base64'), encoding: 'utf-8' as const, bom: false };
    await service.checkpoint('frame-1', request);
    const save = { ref: doc.ref, opId: randomUUID(), bufferVersion: 1, baseHash: doc.revision.hash, base64: request.base64 };
    expect((await service.save('frame-1', save)).state).toBe('saved');
    const newer = service.checkpoint('frame-1', { ...request, bufferVersion: 2, base64: Buffer.from('SECOND').toString('base64') });
    const ack = service.resolveDraft('frame-1', { ref: doc.ref, draftId: request.draftId, bufferVersion: 1, hash: hash('FIRST'), action: 'saved', saveOpId: save.opId });
    await newer; expect(await ack).toEqual({ resolved: false });
    expect(Buffer.from((await service.readDraft('frame-1', doc.ref, request.draftId)).base64, 'base64').toString()).toBe('SECOND');
    const otherRoot = await rootOf(service, 'frame-2'), otherDoc = await service.open('frame-2', at(otherRoot, 'a.txt'));
    await expect(service.checkpoint('frame-2', { ...request, ref: otherDoc.ref, bufferVersion: 3 })).rejects.toThrow('UNTRUSTED');
    expect(await service.resolveDraft('frame-1', { ref: doc.ref, draftId: request.draftId, bufferVersion: 2, hash: hash('SECOND'), action: 'discard' })).toEqual({ resolved: true });
    expect(service.drafts('frame-1', doc.ref)).toEqual([]);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('FIRST');
  });
  it('keeps private drafts writable after the source lease is revoked but closes the capability with its document', async () => {
    const sources: RootSource[] = [{ kind: 'project-directory', id: 'dir-1', path: project, label: 'Project', projectId: 'project-1' }];
    const service = makeService(sources), root = await rootOf(service), doc = await service.open('frame-1', at(root, 'a.txt'));
    const request = { ref: doc.ref, draftId: randomUUID(), bufferVersion: 1, baseHash: doc.revision.hash, base64: Buffer.from('SOURCE UNAVAILABLE DRAFT').toString('base64'), encoding: 'utf-8' as const, bom: false };
    sources[0].path = userData;
    await expect(service.read('frame-1', doc.ref)).rejects.toThrow('STALE_ROOT');
    expect((await service.checkpoint('frame-1', request)).hash).toBe(hash('SOURCE UNAVAILABLE DRAFT'));
    expect(service.drafts('frame-1', doc.ref)[0]).toMatchObject({ state: 'dirty', sourceAvailable: false });
    expect(Buffer.from((await service.readDraft('frame-1', doc.ref, request.draftId)).base64, 'base64').toString()).toBe('SOURCE UNAVAILABLE DRAFT');
    await expect(service.save('frame-1', { ref: doc.ref, opId: randomUUID(), bufferVersion: 1, baseHash: doc.revision.hash, base64: request.base64 })).rejects.toThrow();
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
    service.closeDocument('frame-1', doc.ref);
    await expect(service.checkpoint('frame-1', { ...request, bufferVersion: 2 })).rejects.toThrow('UNTRUSTED');
  });
  it('refuses read-only writes and invalidates resource chunks on a disk revision change', async () => {
    const service = makeService(), root = await rootOf(service), doc = await service.open('frame-1', at(root, 'a.txt'));
    expect(Buffer.from(await service.chunk('frame-1', doc.ref, 0, 4, doc.revision.hash), 'base64').toString()).toBe('BASE');
    chmodSync(join(project, 'a.txt'), 0o444);
    const receipt = await service.save('frame-1', { ref: doc.ref, opId: randomUUID(), bufferVersion: 1, baseHash: doc.revision.hash, base64: Buffer.from('DENIED').toString('base64') });
    expect(receipt.state).toBe('failed'); expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
    await expect(service.chunk('frame-1', doc.ref, 0, 4, doc.revision.hash)).rejects.toThrow('CHANGED');
    chmodSync(join(project, 'a.txt'), 0o644);
  });
  it('allows retry after a real parent-permission failure, including an app restart', async () => {
    const service = makeService(), root = await rootOf(service), doc = await service.open('frame-1', at(root, 'a.txt'));
    const input = { ref: doc.ref, opId: randomUUID(), bufferVersion: 1, baseHash: doc.revision.hash, base64: Buffer.from('RETRY').toString('base64') };
    chmodSync(project, 0o500);
    try {
      const failed = await service.save('frame-1', input);
      expect(failed.state).toBe('failed'); expect(failed.recoveryId).toBeUndefined();
      expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('BASE\r\n');
      expect(await service.save('frame-1', input)).toEqual(failed);
    } finally { chmodSync(project, 0o700); }
    const restarted = makeService(), newRoot = await rootOf(restarted), reopened = await restarted.open('frame-1', at(newRoot, 'a.txt'));
    const retry = await restarted.save('frame-1', { ...input, opId: randomUUID(), ref: reopened.ref });
    expect(retry.state).toBe('saved'); expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('RETRY');
  });
  it('shares real native directory subscriptions and observes replacements after one consumer leaves', async () => {
    const service = makeService(), root = await rootOf(service), other = await rootOf(service, 'frame-2');
    const doc = await service.open('frame-1', at(root, 'a.txt')), second = await service.open('frame-2', at(other, 'a.txt'));
    const a: FileWatchUpdate[] = [], b: FileWatchUpdate[] = [];
    const until = async (condition: () => boolean) => { const start = Date.now(); while (!condition()) { if (Date.now() - start > 6000) throw new Error('Watch event timeout'); await new Promise((done) => setTimeout(done, 30)); } };
    try {
      const one = await service.watch('frame-1', root, [''], [doc.ref], (event) => a.push(event));
      const two = await service.watch('frame-2', other, [''], [second.ref], (event) => b.push(event));
      await until(() => a.some((e) => e.coverage === 'native' && !e.resyncRequired) && b.some((e) => e.coverage === 'native' && !e.resyncRequired));
      expect(service.watcher.resourceCounts.roots).toBe(1);
      writeFileSync(join(project, '.replacement'), 'REPLACED'); renameSync(join(project, '.replacement'), join(project, 'a.txt'));
      await until(() => a.some((e) => e.changed) && b.some((e) => e.changed));
      service.watcher.stop('frame-1', one!.id); const count = a.length, marker = b.length;
      writeFileSync(join(project, 'a.txt'), 'AFTER REPLACEMENT');
      await until(() => b.slice(marker).some((e) => e.changed));
      expect(a).toHaveLength(count); expect(service.watcher.resourceCounts.consumers).toBe(1);
      service.watcher.stop('frame-2', two!.id); await service.watcher.dispose();
      expect(service.watcher.resourceCounts).toEqual({ roots: 0, consumers: 0, timers: 0, stopping: 0 });
    } finally { await service.watcher.dispose(); }
  }, 15000);
  it('releases a native subscription that finishes after disposal and advertises polling on failure', async () => {
    const service = makeService(), root = await rootOf(service); await service.recovery.ready();
    let finish!: (value: { unsubscribe: () => Promise<void> }) => void, stopped = 0;
    const delayed = new FileWatchService(service.roots, broker, service.recovery, () => new Promise((resolve) => { finish = resolve; }));
    const lease = service.roots.require('frame-1', root);
    const started = delayed.start('frame-1', lease, [''], [], () => undefined);
    delayed.stop('frame-1', started.id);
    finish({ unsubscribe: async () => { stopped++; } });
    await new Promise((done) => setTimeout(done, 20)); await delayed.dispose();
    expect(stopped).toBe(1); expect(delayed.resourceCounts.roots).toBe(0);
    const updates: FileWatchUpdate[] = [];
    const failing = new FileWatchService(service.roots, broker, service.recovery, async () => { throw new Error('fixture native unavailable'); });
    failing.start('frame-1', lease, [''], [], (update) => updates.push(update));
    await new Promise((done) => setTimeout(done, 100));
    expect(updates.some((update) => update.coverage === 'poll' && update.message?.includes('fixture native unavailable'))).toBe(true);
    await failing.dispose(); expect(failing.resourceCounts.timers).toBe(0);
  });
  it('enumerates unexpanded real directories with fixed exclusions and no symlink traversal', async () => {
    const excluded = ['.git', '.hg', '.next', '.pnpm-store', '.svn', '.turbo', '.yarn', 'build', 'coverage', 'dist', 'node_modules'];
    for (const name of excluded) { mkdirSync(join(project, name)); writeFileSync(join(project, name, 'secret.ts'), 'needle'); }
    mkdirSync(join(project, 'nested')); writeFileSync(join(project, '.hidden'), 'needle');
    symlinkSync(userData, join(project, 'outside')); symlinkSync('nested', join(project, 'alias')); symlinkSync('.', join(project, 'loop'));
    for (let index = 0; index < 6000; index++) writeFileSync(join(project, 'nested', `file ${index}.txt`), `sample ${index}\n`);
    writeFileSync(join(project, 'nested', '引号"与\n换行.ts'), 'needle');
    const service = makeService(), root = await rootOf(service), started = Date.now();
    const result = await service.searcher.search('frame-1', { id: randomUUID(), root: rootRef(root), kind: 'name', query: 'file', mask: '' }, () => undefined);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.paths).toHaveLength(6003); expect(result.paths).toContain('nested/引号"与\n换行.ts'); expect(result.paths).toContain('.hidden');
    expect(result.paths.some((path) => excluded.some((name) => path.startsWith(`${name}/`)) || path.startsWith('alias/') || path.startsWith('outside/'))).toBe(false);
  });
  it('streams literal Unicode matches with original UTF-16 offsets and masks that cannot reinclude exclusions', async () => {
    mkdirSync(join(project, 'nested')); mkdirSync(join(project, 'node_modules'));
    const raw = '开头😀\r\n中文 needle😀 needle\rthird needle\n';
    writeFileSync(join(project, 'nested', 'sample.ts'), `\ufeff${raw}`); writeFileSync(join(project, 'nested', 'skip.js'), 'needle'); writeFileSync(join(project, 'node_modules', 'secret.ts'), 'needle');
    const service = makeService(), root = await rootOf(service), updates: string[] = [];
    const result = await service.searcher.search('frame-1', { id: randomUUID(), root: rootRef(root), kind: 'content', query: 'needle', mask: '*.ts' }, (event) => updates.push(event.row.relativePath));
    expect(result.rows.map((row) => row.line)).toEqual([2, 3]); expect(updates).toEqual(['nested/sample.ts', 'nested/sample.ts']);
    for (const row of result.rows) for (const range of row.ranges) expect(raw.slice(row.rawOffset + range.from, row.rawOffset + range.to)).toBe('needle');
    const empty = await service.searcher.search('frame-1', { id: randomUUID(), root: rootRef(root), kind: 'content', query: 'NEEDLE', mask: '*.ts' }, () => undefined);
    expect(empty.rows).toEqual([]);
  });
  it('reports invalid/binary/oversized files separately and terminates at 100 matching lines', async () => {
    writeFileSync(join(project, 'binary'), Buffer.from([0, 1, 2])); writeFileSync(join(project, 'invalid'), Buffer.from([0xff, 0xfe, 0xfd]));
    writeFileSync(join(project, 'large'), ''); truncateSync(join(project, 'large'), FILE_LIMITS.readableText + 1);
    const service = makeService(), root = await rootOf(service);
    const skipped = await service.searcher.search('frame-1', { id: randomUUID(), root: rootRef(root), kind: 'content', query: 'nothing', mask: '' }, () => undefined);
    expect(skipped.skipped).toBe(3); expect(skipped.issues).toHaveLength(3); expect(skipped.rows).toEqual([]);
    writeFileSync(join(project, 'hits.txt'), 'needle\n'.repeat(101));
    const limited = await service.searcher.search('frame-1', { id: randomUUID(), root: rootRef(root), kind: 'content', query: 'needle', mask: 'hits.txt' }, () => undefined);
    expect(limited.rows).toHaveLength(100); expect(limited.limited).toBe(true); expect(broker.activeProcesses).toBe(0);
    const id = randomUUID();
    await expect(service.searcher.search('frame-1', { id, root: rootRef(root), kind: 'content', query: 'needle', mask: 'hits.txt' }, () => service.searcher.cancel('frame-1', id))).rejects.toThrow('CANCELLED');
    expect(service.searcher.activeRequests).toBe(0); expect(broker.activeProcesses).toBe(0);
  });
  it.each([99, 100, 101])('R05 %i actual matching lines only mark limited after an extra real row, without streaming that sentinel', async total => {
    writeFileSync(join(project, 'limit.txt'), 'cap-needle\n'.repeat(total));
    const service = makeService(), root = await rootOf(service), emitted: unknown[] = [];
    try {
      const result = await service.searcher.search('frame-1', { id: randomUUID(), root: rootRef(root), kind: 'content', query: 'cap-needle', mask: 'limit.txt' }, event => emitted.push(event.row));
      expect(result.rows).toHaveLength(Math.min(100, total)); expect(emitted).toEqual(result.rows);
      expect(result.limited).toBe(total > 100); expect(result.skipped).toBe(0); expect(broker.activeProcesses).toBe(0);
    } finally { service.closeOwner('frame-1'); }
  });
  it('rejects overlong result frames and search aliases replaced after enumeration', async () => {
    writeFileSync(join(project, 'long.txt'), `needle${'x'.repeat(2 * 1024 * 1024)}`);
    const service = makeService(), root = await rootOf(service);
    await expect(service.searcher.search('frame-1', { id: randomUUID(), root: rootRef(root), kind: 'content', query: 'needle', mask: 'long.txt' }, () => undefined)).rejects.toThrow('protocol budget');
    symlinkSync('a.txt', join(project, 'alias.txt'));
    const direct = await broker.request<{ rows: unknown[]; skipped: number }>({ operation: 'search', root: descriptor(project), paths: ['alias.txt'], query: 'BASE' });
    expect(direct.rows).toEqual([]); expect(direct.skipped).toBe(1);
  });
});

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileSaveReceipt } from '@shared/files';
import { FileService } from './file-service';
import { NativeFileBroker, type BrokerOptions } from './native-broker';
import { FileRecoveryStore, recoveryProjectKey } from './recovery-store';
import { FileRootsService } from './roots';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** Observation only: every request and transaction still uses the real helper. */
class ObservedBroker extends NativeFileBroker {
  readonly saves: Record<string, unknown>[] = [];
  readonly transactions: string[] = [];
  override request<T>(request: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (request.operation === 'save') this.saves.push(request);
    return super.request<T>(request, {
      ...options,
      onTransaction: (identity, opId) => {
        this.transactions.push(opId);
        options.onTransaction?.(identity, opId);
      },
    });
  }
}

/** Independent Node filesystem observations, not service-reported revisions. */
function treeSnapshot(root: string): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  const visit = (relative: string) => {
    const absolute = join(root, relative), stat = statSync(absolute, { bigint: true });
    entries[relative || '.'] = {
      kind: stat.isDirectory() ? 'directory' : 'file', device: String(stat.dev), inode: String(stat.ino),
      size: String(stat.size), modifiedNs: String(stat.mtimeNs), changedNs: String(stat.ctimeNs),
      ...(stat.isFile() ? { sha256: sha256(readFileSync(absolute)) } : {}),
    };
    if (stat.isDirectory()) for (const name of readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name);
  };
  visit(''); return entries;
}

describe.skipIf(process.platform !== 'darwin')('M9-T-L16 production opId retry acceptance (U+I, no GUI)', () => {
  it('loses a committed reply, preserves an external revision across retries/restart, and rechecks each new opId', async () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-l16-')));
    const project = join(fixture, 'project'), userData = join(fixture, 'user-data');
    mkdirSync(project); mkdirSync(userData);
    const target = join(project, 'a.txt'); writeFileSync(target, 'BASE\r\n');
    const executable = process.env.SMARTDD_M9_FILE_BROKER ?? join(fixture, 'willyou-files');
    if (!process.env.SMARTDD_M9_FILE_BROKER) execFileSync('xcrun', [
      'clang++', '-std=c++17', '-fobjc-arc', '-O2', '-Wno-deprecated-declarations', '-mmacosx-version-min=12.0',
      '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', '-framework', 'Foundation', '-framework', 'AppKit',
      '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-framework', 'CoreText', resolve('native/files/broker.mm'), '-o', executable,
    ]);
    const broker = new ObservedBroker(executable), services: FileService[] = [];
    const makeService = () => {
      const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'dir-1', path: project, label: 'L16', projectId: 'project-1' }] };
      const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userData, resolver));
      services.push(service); return service;
    };
    const open = async (service: FileService) => {
      const root = (await service.openScope('frame-1', { kind: 'project', projectId: 'project-1' })).roots[0];
      return service.open('frame-1', { lease: root.lease, generation: root.generation, relativePath: 'a.txt' });
    };
    try {
      const service = makeService(), doc = await open(service), savedText = 'SAVED 中文😀\n';
      const request = { ref: doc.ref, opId: randomUUID(), bufferVersion: 1, baseHash: doc.revision.hash, base64: Buffer.from(savedText).toString('base64') };
      let withheldReceipt: FileSaveReceipt | undefined;
      // The failure occurs only after production save resolves, so no fake
      // successful result or broker failpoint stands in for a real commit.
      const clientSubmitWithLostReply = async () => {
        withheldReceipt = await service.save('frame-1', request);
        expect(withheldReceipt.state).toBe('saved');
        throw new Error('Injected client transport loss after durable success');
      };
      await expect(clientSubmitWithLostReply()).rejects.toThrow('Injected client transport loss');
      expect(readFileSync(target, 'utf8')).toBe(savedText);
      expect(broker.transactions).toEqual([request.opId]);
      const savedInode = String(statSync(target, { bigint: true }).ino), nativeRequest = broker.saves[0];

      const externalText = 'EXTERNAL newer bytes\r\n';
      execFileSync(process.execPath, ['-e', 'const fs=require("node:fs");fs.writeFileSync(process.argv[1]+".external",process.argv[2]);fs.renameSync(process.argv[1]+".external",process.argv[1]);', target, externalText], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      const externalInode = String(statSync(target, { bigint: true }).ino);
      expect(externalInode).not.toBe(savedInode);
      const beforeRetry = { project: treeSnapshot(project), recovery: treeSnapshot(userData) };
      const unchanged = () => {
        expect(readFileSync(target, 'utf8')).toBe(externalText);
        expect(String(statSync(target, { bigint: true }).ino)).toBe(externalInode);
        expect({ project: treeSnapshot(project), recovery: treeSnapshot(userData) }).toEqual(beforeRetry);
        expect(broker.transactions).toEqual([request.opId]);
      };
      const sameProcess = await service.save('frame-1', request);
      expect(sameProcess).toEqual(withheldReceipt); expect(broker.saves).toHaveLength(1); unchanged();

      // Also exercise native durable-journal replay rather than only JS cache.
      const nativeReplay = await broker.request<FileSaveReceipt>(nativeRequest);
      expect(nativeReplay).toEqual(withheldReceipt); expect(broker.saves).toHaveLength(2); unchanged();
      service.closeOwner('frame-1');
      const restarted = makeService(), reopened = await open(restarted);
      expect(reopened.revision.hash).toBe(sha256(externalText));
      const recovered = await restarted.save('frame-1', { ...request, ref: reopened.ref });
      expect(recovered).toEqual(withheldReceipt); expect(broker.saves).toHaveLength(2); unchanged();
      await expect(restarted.save('frame-1', { ...request, ref: reopened.ref, base64: Buffer.from('DIFFERENT PAYLOAD').toString('base64') })).rejects.toThrow('IDEMPOTENCY');
      unchanged();

      const staleOpId = randomUUID();
      const stale = await restarted.save('frame-1', { ...request, opId: staleOpId, ref: reopened.ref });
      expect(stale.state).toBe('conflict'); expect(stale.opId).toBe(staleOpId);
      expect(broker.saves).toHaveLength(2); unchanged();

      const freshOpId = randomUUID(), freshText = 'FINAL based on external revision\n';
      const fresh = await restarted.save('frame-1', { ...request, opId: freshOpId, ref: reopened.ref, bufferVersion: 2, baseHash: reopened.revision.hash, base64: Buffer.from(freshText).toString('base64') });
      expect(fresh.state).toBe('saved'); expect(fresh.revision?.hash).toBe(sha256(freshText));
      expect(readFileSync(target, 'utf8')).toBe(freshText);
      expect(String(statSync(target, { bigint: true }).ino)).not.toBe(externalInode);
      expect(broker.transactions).toEqual([request.opId, freshOpId]); expect(broker.saves).toHaveLength(3);
      const recordRoot = join(userData, 'file-recovery/v1', recoveryProjectKey('project-1'));
      expect(readdirSync(recordRoot).sort()).toEqual([request.opId, freshOpId].sort());
      const journals = [request.opId, freshOpId].map((id) => JSON.parse(readFileSync(join(recordRoot, id, 'journal.json'), 'utf8')));
      expect(journals.map((j) => j.state)).toEqual(['saved', 'saved']);
      expect(journals.map((j) => readFileSync(join(project, j.transactionLeaf, 'candidate'), 'utf8'))).toEqual(['BASE\r\n', externalText]);
      expect(journals.map((j) => readFileSync(join(recordRoot, j.opId, 'draft'), 'utf8'))).toEqual([savedText, freshText]);
      if (process.env.SMARTDD_M9_L16_EVIDENCE) writeFileSync(process.env.SMARTDD_M9_L16_EVIDENCE, JSON.stringify({
        case: 'M9-T-L16', observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
        level: 'Production FileService + packaged/native broker + real macOS filesystem (U+I); no renderer or GUI',
        fixture, executable, executableSha256: sha256(readFileSync(executable)), fault: 'Client reply withheld after production save returned durable saved receipt',
        savedInode, externalInode, withheldReceipt, sameProcess, nativeReplay, recovered, stale, fresh,
        nativeSaveRequests: broker.saves.length, transactionEvents: broker.transactions,
        unchangedAcrossRetries: beforeRetry, final: { project: treeSnapshot(project), recovery: treeSnapshot(userData) },
        assertions: ['Same-process replay', 'Native durable-journal replay', 'Service restart recovery replay', 'Changed payload rejected', 'New opId stale revision conflict before native write', 'New opId current revision commits once', 'Hash/inode/timestamps/directory entries/journal bytes unchanged on retries', 'Original and external displaced versions plus both private drafts retained'],
      }, null, 2) + '\n');
    } finally {
      for (const service of services) service.closeOwner('frame-1');
      broker.dispose(); rmSync(fixture, { recursive: true, force: true });
    }
  }, 60_000);
});

// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileContextActions } from './file-actions';

// The menu and native read authority are production implementations. Only the
// unrelated application discovery and OS clipboard sink are isolated here;
// actual system clipboard behavior belongs to the packaged App acceptance.
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: vi.fn(async () => ({ id: 'unused', apps: [], preferredUnavailable: false })) } } }));

const samples = ['中文文件.txt', 'with space.txt', 'emoji🙂.txt', '子目录/中文 space 🙂.txt'];
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const observations: unknown[] = [];
let base = '', broker: NativeFileBroker | undefined, service: FileService | undefined;

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('M9-T-E04 production context menu and real native FileService paths', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    base = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-e04-')));
    mkdirSync(join(base, 'userdata'));
    for (const root of ['one 中文', 'two space 🙂']) for (const name of samples) {
      const path = join(base, root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `READ ONLY ${root}/${name}\n`);
    }
    const resolver = { sources: () => ['one 中文', 'two space 🙂'].map((name, index) => ({ kind: 'project-directory' as const, id: String(index), label: name, path: join(base, name), projectId: 'path-copy' })) };
    broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
  });
  afterEach(async () => {
    cleanup(); service?.closeOwner('path-copy'); await service?.watcher.dispose(); broker?.dispose();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); if (base) rmSync(base, { recursive: true, force: true });
  });
  afterAll(() => {
    if (process.env.SMARTDD_M9_PATH_COPY_EVIDENCE) writeFileSync(process.env.SMARTDD_M9_PATH_COPY_EVIDENCE, JSON.stringify({
      observedAt: new Date().toISOString(),
      level: 'I: real native broker + FileRootsService/FileService + production FileContextActions/Base UI menu in jsdom. Clipboard sink isolated; not native GUI/system clipboard.',
      nativeBroker: process.env.SMARTDD_M9_FILE_BROKER,
      nativeBrokerSha256: sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)), observations,
    }, null, 2) + '\n');
  });

  it.each(samples)('copies absolute and relative %s exactly in two independent local roots', async (relativePath) => {
    const roots = await service!.openScope('path-copy', { kind: 'project', projectId: 'path-copy' });
    expect(roots.unavailable).toEqual([]); expect(roots.roots).toHaveLength(2);
    const user = userEvent.setup(), sink = vi.spyOn(navigator.clipboard, 'writeText');
    const absoluteValues: string[] = [];
    for (const root of roots.roots) {
      const absolutePath = join(root.path, relativePath), before = readFileSync(absolutePath), beforeStat = statSync(absolutePath, { bigint: true });
      const file = await service!.open('path-copy', { lease: root.lease, generation: root.generation, relativePath });
      expect(file.absolutePath).toBe(absolutePath); expect(file.relativePath).toBe(relativePath);
      const read = await service!.read('path-copy', file.ref); expect(Buffer.from(read.base64, 'base64')).toEqual(before);
      const failures: unknown[] = [];
      const view = render(<FileContextActions target={{ kind: 'document', ref: file.ref }} absolutePath={file.absolutePath} relativePath={file.relativePath} origin="breadcrumb" run={work => { void work().catch(error => failures.push(error)); }}><button>Selected fixture</button></FileContextActions>);
      for (const [label, expected] of [['复制完整路径', absolutePath], ['复制相对路径', relativePath]]) {
        fireEvent.contextMenu(screen.getByRole('button', { name: 'Selected fixture' }));
        await user.click(await screen.findByRole('menuitem', { name: label }));
        await waitFor(() => expect(sink).toHaveBeenLastCalledWith(expected));
        expect(await navigator.clipboard.readText()).toBe(expected);
        observations.push({ relativePath, root: root.path, label, clipboardBoundaryValue: expected, fileSha256: sha(before), nativeDocumentRef: file.ref.id, host: 'local' });
      }
      expect(failures).toEqual([]); expect(readFileSync(absolutePath)).toEqual(before);
      const afterStat = statSync(absolutePath, { bigint: true }); expect(afterStat.mtimeNs).toBe(beforeStat.mtimeNs); expect(afterStat.ino).toBe(beforeStat.ino);
      absoluteValues.push(file.absolutePath); view.unmount(); service!.closeDocument('path-copy', file.ref);
    }
    expect(new Set(absoluteValues).size).toBe(2); expect(sink).toHaveBeenCalledTimes(4);
  });
});

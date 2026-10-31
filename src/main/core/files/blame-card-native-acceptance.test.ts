import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { blameCardFingerprint, createBlameCardFixture } from '../../../../scripts/files/blame-card-fixtures.mjs';
import { NativeFileBroker } from './native-broker';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
import { FileService } from './file-service';
import { createFileController } from './controller';
import { registerRPCRouter } from '@shared/ipc/rpc';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: { openExternal: vi.fn() } }));
const rows: unknown[] = [];
afterAll(() => { if (process.env.WILLYOU_BLAME_CARD_EVIDENCE) writeFileSync(process.env.WILLYOU_BLAME_CARD_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), caseId: 'M9-T-S04', rows, boundary: 'Actual FileService/root/native Git/controller/public RPC,current five fields only. No external browser opened,optional account/PR source supplied or full S04 claimed.' }, null, 2) + '\n'); });
describe.skipIf(process.platform !== 'darwin' || !process.env.WILLYOU_BLAME_BROKER)('S04 actual native current five-field attribution contract', () => {
  it('preserves two actual committed authors/times/SHAs and Git-provided empty-message summary without inferring optional identities or writing any repository bytes', async () => {
    const fixture = await createBlameCardFixture(), userdata = join(fixture.scratch, 'userdata'); mkdirSync(userdata);
    rows.push({ fixture });
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'own-S04-directory', projectId: 'S04', path: fixture.project, label: 'Own S04 synthetic Git directory' }] };
    const broker = new NativeFileBroker(process.env.WILLYOU_BLAME_BROKER!);
    const files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
    const sender = Object.assign(new EventEmitter(), { id: 704, mainFrame: { processId: 7, routingId: 4 }, isDestroyed: () => false });
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerRPCRouter({ files: createFileController(files, () => true) }, { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, handler) } as never);
    const invoke = async (method: string, ...args: unknown[]) => await handlers.get('files.' + method)!(event, ...args) as any;
    try {
      const root = (await invoke('roots', { kind: 'project', projectId: 'S04' })).roots[0];
      const file = await invoke('open', { lease: root.lease, generation: root.generation, relativePath: fixture.relativePath });
      const result = await invoke('gitBlame', { id: randomUUID(), ref: file.ref, baseHash: file.revision.hash, lineStart: 1, lineEnd: 3 });
      rows.push({ actualOriginalRpc: result });
      expect(result.state).toBe('ready'); expect(result.lines).toEqual(fixture.expected);
      expect(result.repository.head).toBe(fixture.head); expect(result.repository.webBase).toBeNull();
      expect(result.lines.every((line: object) => Object.keys(line).sort().join(',') === 'at,author,commitId,line,summary')).toBe(true);
      await invoke('closeDocument', file.ref);
      expect(await blameCardFingerprint(fixture.project)).toEqual(fixture.before);
      rows.push({ result, allSourceAndGitFullStateUnchanged: true, pass: true });
    } finally { sender.emit('destroyed'); await files.watcher.dispose(); broker.dispose(); }
  }, 30000);
});

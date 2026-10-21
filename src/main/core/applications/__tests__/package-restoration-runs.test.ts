import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FixtureProcessReader, runFixture } from './run-fixture';

describe('missing-package restoration and actual run resource protection', () => {
  it.each(['preparing', 'bridge-survives-cli'] as const)('T64 waits for the complete %s consumer lifetime and preserves the fixed session', async phase => {
    const reader = new FixtureProcessReader(), f = await runFixture(reader, { application: true });
    let cliExited = false, bridgeExited = false;
    const run = await f.create();
    let bridge: Awaited<ReturnType<typeof run.reserveBridge>> | undefined;
    try {
      const application = f.application!, source = f.applicationSource!, target = join(f.store.root, application.relativePath);
      const original = await f.sessions.get(f.snapshot.taskId);
      const references = f.sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(f.snapshot.taskId);
      const generation = f.store.get(application.resourceId).generation;
      // The run lease's primary resource is deliberately not the application:
      // restoration must also consult its complete capability_lease_resources set.
      expect(f.sqlite.prepare("SELECT resource_id FROM capability_resource_leases WHERE owner_id=? AND owner_kind='run'").get(run.runId)).not.toEqual({ resource_id: application.resourceId });
      expect(f.sqlite.prepare('SELECT 1 AS protected FROM capability_lease_resources p JOIN capability_resource_leases l ON l.lease_id=p.lease_id WHERE l.owner_id=? AND p.resource_id=?').get(run.runId, application.resourceId)).toEqual({ protected: 1 });
      if (phase === 'bridge-survives-cli') {
        await run.prepare(); await run.cli.arm(); reader.identities.set(200011, 'darwin-proc-v1:200:11'); await run.cli.attach(200011);
        bridge = await run.reserveBridge(); await bridge.arm(); reader.identities.set(200012, 'darwin-proc-v1:200:12'); await bridge.attach(200012);
      }
      rmSync(target, { recursive: true });
      const expectHeld = async () => {
        await expect(f.packageRegistry.install(source)).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
        expect(existsSync(target)).toBe(false);
        expect(f.store.get(application.resourceId).generation).toBe(generation);
        expect(f.store.get(application.resourceId).state).toBe('ready');
        expect(f.sqlite.prepare("SELECT count(*) AS n FROM capability_resource_operations WHERE kind='restore-application-package'").get()).toEqual({ n: 0 });
      };
      await expectHeld();
      if (bridge) {
        reader.identities.delete(200011); await run.cli.exited(); cliExited = true;
        expect(f.runs.get(run.runId).state).toBe('stopping');
        await expectHeld();
        reader.identities.delete(200012); await bridge.exited(); bridgeExited = true;
      } else await run.stop();
      expect(f.runs.get(run.runId).state).toBe('stopped');
      expect((await f.packageRegistry.install(source)).packageHash).toBe(application.packageHash);
      expect(readFileSync(join(target, 'adapter/index.cjs'))).toEqual(source.files['adapter/index.cjs']);
      expect(f.store.get(application.resourceId).generation).toBe(generation + 1);
      expect(f.packageRegistry.active(application.appId)?.packageHash).toBe(application.packageHash);
      expect(await f.sessions.get(f.snapshot.taskId)).toEqual(original);
      expect(f.sqlite.prepare('SELECT * FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(f.snapshot.taskId)).toEqual(references);
      const resumed = await f.create();
      try { await resumed.prepare(); expect(f.runs.get(resumed.runId).snapshotHash).toBe(original.pointer.snapshotHash); }
      finally { await resumed.stop(); }
      expect(f.sqlite.prepare("SELECT count(*) AS n FROM capability_resource_leases WHERE state<>'released'").get()).toEqual({ n: 0 });
    } finally {
      if (bridge && !bridgeExited) { reader.identities.delete(200012); await bridge.exited(); }
      if (!cliExited) { reader.identities.delete(200011); await run.cli.exited(); }
      await run.stop(); await f.runs.dispose(); f.cleanup();
    }
  });
});

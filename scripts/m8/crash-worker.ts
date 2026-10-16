// Isolated process-crash harness. Not imported by the application or its package.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDbClient } from '../../src/main/db/client';
import { SecretsStore } from '../../src/main/secrets';
import { AiProfileService } from '../../src/main/core/ai/ai-profile-service';
import { ProjectService } from '../../src/main/core/projects/project-service';
import { ProjectTransferService } from '../../src/main/core/projects/transfer-service';
import { encryptProject } from '../../src/main/core/projects/transfer-format';
import { transferFixture } from '../../src/main/core/projects/transfer-fixtures';
import { initialTransferDraft } from '../../src/shared/project-transfer';

async function main() {
  const [mode, home, phase, repo] = process.argv.slice(2);
  assert(resolve(home).includes('/willyou-m8-crash-'), 'Requires isolated crash-test home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const database = join(home, 'test.db'), fresh = !existsSync(database);
  const client = openDbClient(database);
  if (fresh) {
    const journal = JSON.parse(readFileSync(join(repo, 'drizzle/meta/_journal.json'), 'utf8'));
    client.sqlite.transaction(() => {
      for (const entry of journal.entries) {
        for (const sql of readFileSync(join(repo, 'drizzle', `${entry.tag}.sql`), 'utf8').split('--> statement-breakpoint')) if (sql.trim()) client.sqlite.exec(sql);
      }
    })();
  }
  // Only synthetic values; this backend cipher does not use the user's Keychain.
  const secrets = new SecretsStore(client.db, { isAvailable: () => true, encrypt: value => Buffer.from(`crash-fixture:${value}`), decrypt: bytes => bytes.toString().slice(14) });
  const projects = new ProjectService(client.db, secrets), profiles = new AiProfileService(client.db, secrets);
  const service = new ProjectTransferService({ db: client.db, secrets, projects, profiles, userData: home, appVersion: '0.0.4', env: () => ({ PATH: '/bin:/usr/bin' }),
    checkpoint: point => { if (mode === 'import' && phase === point) { process.send?.({ phase: point }); process.kill(process.pid, 'SIGSTOP'); } },
  });
  service.recover();
  if (mode === 'import') {
    writeFileSync(join(home, 'unrelated-key'), 'keep unrelated file');
    const f = transferFixture(); f.servers[0].authType = 'key';
    f.credentials['ssh-1'] = { privateKey: { encoding: 'base64', data: Buffer.from('synthetic crash-test key').toString('base64') }, sudoPassword: 'synthetic sudo' };
    const path = join(home, 'source.willyou'); writeFileSync(path, await encryptProject(f, '12345678'));
    const file = service.choose(1, path), preview = await service.unlock(1, file.fileToken, '12345678'), draft = initialTransferDraft(preview);
    draft.name = 'Crash recovery'; const dir = join(home, 'code'); mkdirSync(dir); draft.directories[0].localPath = dir; service.allowDirectory(1, preview.token, dir);
    service.commit(1, preview.token, randomUUID(), draft);
    throw Error('Crash checkpoint was not reached');
  }
  const records = projects.listProjects(), committed = phase === 'committed';
  assert.equal(records.length, committed ? 1 : 0);
  const count = (table: string) => (client.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.equal(count('project_import_receipts'), committed ? 1 : 0);
  assert.equal(count('app_secrets'), committed ? 2 : 0);
  assert.equal(count('tasks'), 0);
  assert.equal(readFileSync(join(home, 'unrelated-key'), 'utf8'), 'keep unrelated file');
  assert.deepEqual(readdirSync(service.keys.journals), []);
  const owned = readdirSync(service.keys.root).filter(name => name !== 'journals');
  assert.equal(owned.length, committed ? 1 : 0);
  if (committed) {
    const key = projects.getProject(records[0].id).servers[0].privateKeyPath!;
    assert.equal(readFileSync(key, 'utf8'), 'synthetic crash-test key');
    assert.equal(count('imported_keys'), 1);
  }
  service.recover(); assert.equal(projects.listProjects().length, records.length);
  console.log(JSON.stringify({ phase, recovered: true, projects: records.length, unrelatedPreserved: true, journals: 0 }));
  service.disposeAll(); client.close();
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Crash harness failed'); process.exitCode = 1; });

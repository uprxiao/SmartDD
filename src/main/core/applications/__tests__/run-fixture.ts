import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { runBundledMigrations } from '../../../db/migrations';
import type { CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { ApplicationError } from '@shared/applications';
import { ResourceStore, type ResourceRecord } from '../resource-store';
import { CapabilitySessionRegistry } from '../session-registry';
import { CapabilityRunRegistry } from '../run-registry';
import { canonicalJson, digest } from '../manifest';
import { fileNames } from '../package-files';
import type { ProcessIdentity, ProcessIdentityReader } from '../process-identity';
export class FixtureProcessReader implements ProcessIdentityReader {
  readonly identities = new Map<number,string>([[process.pid,'darwin-proc-v1:100:10']]);
  readonly unknown = new Set<number>();
  read(pid: number): ProcessIdentity | null { const startedAt = this.identities.get(pid); return startedAt && !this.unknown.has(pid) ? { pid,startedAt } : null; }
  state(identity: ProcessIdentity) { if (this.unknown.has(identity.pid)) return 'unknown' as const; return this.identities.get(identity.pid) === identity.startedAt ? 'running' as const : 'stopped' as const; }
}
export async function runFixture(reader: ProcessIdentityReader = new FixtureProcessReader()) {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-runs-'))), sqlite = new Database(join(root,'state.sqlite'));
  sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite); sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p1','isolated run fixture',1,1)");
  const store = new ResourceStore(sqlite,root), entries = new Map<string,Buffer>(); let onVerify: ((resource: ResourceRecord) => void) | undefined;
  const resource = async (kind: string,version: string,dependencies: string[] = []) => {
    const bytes = Buffer.from('module.exports = ' + JSON.stringify({ kind,version }) + ';\n'), hash = digest(bytes), id = kind + ':' + (kind === 'agent-adapter' ? 'claude-code:' : '') + hash;
    const spec = { resourceId: id,kind,contentHash: hash,relativePath: 'run-fixtures/' + kind + '/' + hash,dependencies,materialize: (dir: string) => { mkdirSync(dir); writeFileSync(join(dir,'entry.cjs'),bytes); writeFileSync(join(dir,'.smartdd-owned.json'),canonicalJson({ storeId: store.storeId,hash })); },verify: (dir: string) => { if (!readFileSync(join(dir,'entry.cjs')).equals(bytes)) throw new Error('fixture bytes changed'); } };
    entries.set(id,bytes); return store.publish(spec);
  };
  const child = await resource('fixture-dependency','1'), parent = await resource('fixture-dependency','2',[child.resourceId]), adapter = await resource('agent-adapter','1',[parent.resourceId]);
  const sessions = new CapabilitySessionRegistry(store,{ assertInitialSelection: snapshot => { if (snapshot.packages.length || snapshot.adapterBinding.hash !== adapter.contentHash) throw new Error('fixture host selection'); },verifyExtraResource: (r) => { const dir = join(store.root,r.relativePath), bytes = readFileSync(join(dir,'entry.cjs')); if (!bytes.equals(entries.get(r.resourceId)!) || digest(bytes) !== r.contentHash || fileNames(dir).length !== 2 || JSON.parse(readFileSync(join(dir,'.smartdd-owned.json'),'utf8')).storeId !== store.storeId) throw new ApplicationError('HASH_MISMATCH','fixture whole tree changed'); onVerify?.(r); } });
  const home = join(root,'home'), cwd = join(root,'project'); mkdirSync(home); mkdirSync(cwd);
  const snapshot: CapabilitySessionSnapshotV2 = { schema: 2,taskId: randomUUID(),projectId: 'p1',runner: 'claude-code',createdAt: new Date().toISOString(),native: { sessionId: null,stateRoot: join(home,'.claude'),cwd },adapterBinding: { id: 'claude-code',version: '1.0.0',hash: adapter.contentHash,projectionFormatVersion: 1,nativeToolNames: {} },agentAtCreation: { version: 'controlled-fixture',adapterRevision: 1 },catalogGeneration: 'isolated-fixture',packages: [],standardSkills: [],mcp: [],provenance: 'created' };
  const session = await sessions.create(snapshot,home); let allowed = true, revocations = 0, revoke: (() => void | Promise<void>) | undefined;
  const registry = () => new CapabilityRunRegistry(store,sessions,{ processes: reader,assertCurrent: () => { if (!allowed) throw new ApplicationError('SCOPE_DENIED','fixture current policy revoked'); },revoke: async () => { revocations++; await revoke?.(); },revocationTimeoutMs: 30 });
  const runs = registry();
  return { root,sqlite,store,sessions,snapshot,session,home,reader,runs,registry,resource,adapter,parent,child,create: () => runs.reserve({ taskId: snapshot.taskId,snapshotHash: session.pointer.snapshotHash,bindings: [] }),setAllowed: (value: boolean) => { allowed = value; },setRevoke: (value: () => void | Promise<void>) => { revoke = value; },revocations: () => revocations,setVerify: (value: (r: ResourceRecord) => void) => { onVerify = value; },cleanup: () => { sqlite.close(); rmSync(root,{ recursive: true,force: true }); } };
}

import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
import {CapabilityBundleSource} from '../bundle-source';
import {RuntimeRegistry} from '../runtime-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {ApplicationService} from '../application-service';
import {CapabilityRunRegistry, type OwnedCapabilityRun} from '../run-registry';
import {ApplicationToolService} from '../tool-service';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {createApplicationRunPlan} from '../run-plan';
import {builtinApplicationModules} from '../modules';
import {applicationSkillContentHash} from '../session-registry';
import {BrowserService} from '../../browser/service';
import {applicationToolDeclarations} from '@shared/application-capabilities';
import {applicationNativeSkillName, type CapabilitySessionSnapshot} from '@shared/application-session';
import type {BridgeResponse} from '@shared/application-bridge';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import * as schema from '../../../db/schema';

const sdk = vi.hoisted(() => ({
  allocate: vi.fn((name: string): never => {throw new Error(`Native allocation forbidden in software fixture: ${name}`);}),
}));
vi.mock('electron', () => {
  class NoNativeWindow {constructor() {sdk.allocate('window');}}
  class NoNativeView {constructor() {sdk.allocate('view');}}
  return {
    app: {userAgentFallback: 'WillYou/0.1 Electron/42 Chrome/148', getPath: () => sdk.allocate('app.getPath')},
    BrowserWindow: NoNativeWindow, BaseWindow: NoNativeWindow, WebContentsView: NoNativeView,
    session: {fromPartition: () => sdk.allocate('session.fromPartition')},
    screen: {getPrimaryDisplay: () => sdk.allocate('screen')},
    nativeImage: {}, shell: {},
    safeStorage: {
      isEncryptionAvailable: () => sdk.allocate('safeStorage'),
      encryptString: () => sdk.allocate('safeStorage'),
      decryptString: () => sdk.allocate('safeStorage'),
    },
  };
});

// Software composition only: real service/facade/SQLite/RunRegistry; the
// existing process reader supplies software identities. No native page exists.
type Fixture = Awaited<ReturnType<typeof agentFixture>>;
interface StartedRun {taskId: string; run: OwnedCapabilityRun; pid: number; attached: boolean; ended: boolean}
let f: Fixture | undefined;
let app: ApplicationService | undefined;
let browser: BrowserService | undefined;
let runs: CapabilityRunRegistry | undefined;
let tools: ApplicationToolService | undefined;
let reader: FixtureProcessReader;
let started: StartedRun[];
const pending = new Set<Promise<BridgeResponse>>();

function current() {
  if (!f || !app || !browser || !runs || !tools) throw new Error('Browser facade fixture not ready');
  return {f, app, browser, runs, tools};
}
async function start(existingTaskId?: string): Promise<StartedRun> {
  const {f, app, runs} = current();
  let saved;
  if (existingTaskId) {
    saved = await f.sessions.get(existingTaskId);
  } else {
    const base = f.plan('codex');
    const selected = app.builtin.assertTrusted(app.builtin.packages.active('browser')!.packageHash);
    const manifest = selected.manifest;
    if (manifest.schema !== 'smartdd-app-package-v2') throw new Error('Browser v2 bundle required');
    const adapter = f.installedAdapters.find(a => a.metadata.agentId === 'codex' && a.metadata.version === '1.3.0');
    if (!adapter) throw new Error('Bundled Codex 1.3.0 adapter required');
    const declarations = applicationToolDeclarations(manifest);
    const snapshot: CapabilitySessionSnapshot = {
      ...base, schema: 3, standardSkills: [], mcp: [],
      agentAtCreation: {version: '0.166.0', adapterRevision: 1},
      adapterBinding: {...base.adapterBinding, version: adapter.metadata.version, hash: adapter.hash, nativeToolNames: {}},
      packages: [{
        appId: 'browser', version: manifest.version, packageHash: selected.packageHash,
        hashAlgorithm: 'app-manifest-v1', hostApi: manifest.hostApi, dataApi: manifest.dataApi,
        runtimeHash: manifest.runtime.hash, entry: 'cli', bindings: [], allowedOperations: manifest.permissions,
        toolContractMajors: Object.fromEntries(declarations.map(t => [t.name, t.contractMajor])),
        capabilityContractMajors: Object.fromEntries(manifest.capabilities.map(c => [c.id, c.contractMajor])),
        skills: manifest.skills.map(skill => {
          const name = applicationNativeSkillName('browser', skill.id, selected.packageHash);
          return {skillId: skill.id, nativeName: name, contentHash: applicationSkillContentHash(manifest, skill.path),
            sourceRelativePath: skill.path, projectionPath: join(f.home, '.agents/skills', name, 'SKILL.md')};
        }),
      }],
    };
    f.sqlite.prepare('INSERT INTO tasks(id,project_id,cwd,runner,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(snapshot.taskId, snapshot.projectId, f.cwd, 'codex', 'browser lifetime fixture', 1, 1);
    saved = await f.sessions.create(snapshot, f.home);
  }
  const run = await runs.reserve({taskId: saved.snapshot.taskId, snapshotHash: saved.pointer.snapshotHash, bindings: []});
  const value: StartedRun = {taskId: saved.snapshot.taskId, run, pid: 45100 + started.length, attached: false, ended: false};
  started.push(value);
  await run.prepare();
  await run.cli.arm();
  reader.identities.set(value.pid, `darwin-proc-v1:6:${value.pid}`);
  await run.cli.attach(value.pid);
  value.attached = true;
  return value;
}
async function end(value: StartedRun) {
  if (value.ended) return;
  if (value.attached) {
    reader.identities.delete(value.pid);
    await value.run.cli.exited();
  } else {
    await value.run.cli.cancelBeforeLaunch();
    await value.run.stop('software-fixture-cleanup');
  }
  value.ended = true;
}
function call(value: StartedRun, operation: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const result = current().tools.call(value.run.runId, randomUUID(),
    {operation, contractMajor: 2, connectionId: null, arguments: args}, signal);
  pending.add(result);
  void result.finally(() => pending.delete(result));
  return result;
}
async function request(value: StartedRun, target: StartedRun, signal?: AbortSignal) {
  const {browser} = current();
  let completed: BridgeResponse | undefined;
  const result = call(value, 'browser.access.request', {task: target.taskId, mode: 'control'}, signal);
  void result.then(response => {completed = response;});
  await vi.waitFor(() => {
    // On the unfixed facade this reports the actual SCOPE_DENIED response;
    // it does not call an unimplemented run-signal getter.
    expect(completed, 'same-project request finished before pending: ' + JSON.stringify(completed)).toBeUndefined();
    expect(browser.access.snapshot().requests.find(item => item.runId === value.run.runId && item.targetTaskId === target.taskId)).toBeDefined();
  }, {timeout: 1500, interval: 5});
  const entry = browser.access.snapshot().requests.find(item => item.runId === value.run.runId && item.targetTaskId === target.taskId)!;
  return {entry, result};
}
async function allow(value: StartedRun, target: StartedRun) {
  const {browser} = current(), requested = await request(value, target);
  // Explicit software user precondition; no fake renderer context or UI A claim.
  browser.respondAccess(requested.entry.id, true, 'control');
  expect(await requested.result).toMatchObject({status: 'ok'});
  return browser.access.snapshot().grants.find(item => item.runId === value.run.runId && item.targetTaskId === target.taskId)!;
}

beforeEach(async () => {
  sdk.allocate.mockClear(); started = []; pending.clear(); reader = new FixtureProcessReader();
  f = await agentFixture();
  const source = new CapabilityBundleSource(process.env.WILLYOU_TEST_BUNDLES ?? resolve('out/capability-bundles'));
  await new RuntimeRegistry(f.store).install(source.runtime());
  const builtin = new BuiltinPackageRegistry(f.store);
  const entry = source.index.apps.find(item => item.appId === 'browser');
  if (!entry) throw new Error('Prepared browser capability bundle missing');
  const installed = await builtin.install(source, entry);
  await builtin.packages.activate(installed.packageHash, 0);
  const db = drizzle(f.sqlite, {schema});
  const secrets = new SecretsStore(db, {isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: bytes => bytes.toString()});
  const sqlite = f.sqlite, userData = f.root, directory = f.cwd;
  browser = new BrowserService({sqlite, userData,
    helper: {executable: join(f.root, 'must-not-run-browser-helper'), sha256: '0'.repeat(64), processes: reader},
    taskProject: taskId => (sqlite.prepare('SELECT project_id FROM tasks WHERE id=?').get(taskId) as {project_id: string} | undefined)?.project_id ?? null,
    taskDirectory: () => directory,
  });
  app = new ApplicationService(f.store, {secrets, projects: new ProjectService(db, secrets),
    tasks: {stopProject: async () => true, runningInProject: () => 0},
    requireSender: () => {throw new Error('No application UI sender in software CLI fixture');},
    mailWorker: join(f.root, 'unused-mail-worker'), foxmailNative: join(f.root, 'unused-foxmail-native'), processes: reader, browser,
  });
  await app.recover();
  await app.selections.setAdded('browser', true, 0);
  await app.selections.select({projectId: 'p1', appId: 'browser', enabled: true, expectedRevision: 0, connections: {}});
  const service = app;
  runs = new CapabilityRunRegistry(f.store, f.sessions, {processes: reader, assertCurrent: context => service.selections.requireApplicationEnabled(context.projectId, 'browser'), revoke: () => {},
    createPlan: (snapshot, snapshotHash, runId) => {
      const selection = snapshot.packages.find(item => item.appId === 'browser')!;
      const original = service.builtin.assertTrusted(selection.packageHash);
      return createApplicationRunPlan({runId, snapshot, snapshotHash,
        applications: [{packageHash: selection.packageHash, manifest: original.manifest, capabilities: builtinApplicationModules.capabilityViews(original.manifest)}],
        available: {mcp: false, cli: true}, skills: [],
      });
    },
  });
  app.attachRuns(runs);
  tools = new ApplicationToolService(f.store, runs, new ApplicationAdapterRegistry(f.store, app.data), {entry: 'cli', retryDelays: [0, 0]});
});
afterEach(async () => {
  try {
    for (const value of started ?? []) await end(value);
    await Promise.allSettled([...pending]);
    await app?.dispose();
    await browser?.dispose();
    await runs?.dispose();
    expect(sdk.allocate).not.toHaveBeenCalled();
  } finally {
    f?.cleanup(); f = undefined; app = undefined; browser = undefined; runs = undefined; tools = undefined;
    vi.restoreAllMocks();
  }
});

describe('browser stable run lifetime through the actual v3 CLI/v2 facade', () => {
  it('reaches pending for a same-project request and completes after the software user allows it', async () => {
    const {browser} = current(), target = await start(), requester = await start();
    const grant = await allow(requester, target);
    expect(grant).toMatchObject({runId: requester.run.runId, requesterTaskId: requester.taskId, targetTaskId: target.taskId, mode: 'control'});
    expect(browser.access.snapshot().requests).toEqual([]);
  });

  it('passes the genuine stable RunRegistry signal across calls, separate from each command signal', async () => {
    const {browser, runs} = current(), requester = await start(), execute = vi.spyOn(browser, 'execute');
    for (let i = 0; i < 2; i++) expect(await call(requester, 'browser.tab.list', {})).toMatchObject({status: 'ok', value: {data: {tabs: []}}});
    expect(execute).toHaveBeenCalledTimes(2);
    const first = execute.mock.calls[0][0], second = execute.mock.calls[1][0], stable = runs.assertActive(requester.run.runId).signal;
    expect(first.runSignal).toBe(stable);
    expect(second.runSignal).toBe(stable);
    expect(stable).toBe(requester.run.signal);
    expect(first.signal).not.toBe(stable);
    expect(second.signal).not.toBe(stable);
    expect(first.signal).not.toBe(second.signal);
    expect(stable.aborted).toBe(false);
  });

  it('preserves an existing grant after a completed command and a separately cancelled request', async () => {
    const {browser} = current(), target = await start(), requester = await start(), grant = await allow(requester, target);
    expect(await call(requester, 'browser.tab.list', {task: target.taskId})).toMatchObject({status: 'ok'});
    expect(browser.access.snapshot().grants.map(item => item.id)).toEqual([grant.id]);
    const command = new AbortController(), another = await request(requester, target, command.signal);
    command.abort();
    expect(await another.result).toMatchObject({status: 'error', error: {code: 'CANCELED'}});
    await vi.waitFor(() => expect(browser.access.snapshot().requests).toEqual([]));
    expect(requester.run.signal.aborted).toBe(false);
    expect(browser.access.snapshot().grants.map(item => item.id)).toEqual([grant.id]);
    expect(await call(requester, 'browser.tab.list', {task: target.taskId})).toMatchObject({status: 'ok'});
  });

  it('clears grant and pause only on real registry run stop and never inherits them in a fresh run of the same task', async () => {
    const {browser} = current(), target = await start(), requester = await start();
    await allow(requester, target);
    browser.pauseFromUi(requester.taskId, true);
    expect(browser.workspace.snapshot(requester.taskId).paused).toBe(true);
    await requester.run.stop('software-user-stopped-run');
    expect(requester.run.signal.aborted).toBe(true);
    expect(browser.access.snapshot().grants).toEqual([]);
    expect(browser.workspace.snapshot(requester.taskId).paused).toBe(false);
    await end(requester);
    const fresh = await start(requester.taskId);
    expect(fresh.run.runId).not.toBe(requester.run.runId);
    expect(fresh.run.signal).not.toBe(requester.run.signal);
    expect(await call(fresh, 'browser.tab.list', {})).toMatchObject({status: 'ok'});
    expect(await call(fresh, 'browser.tab.list', {task: target.taskId})).toMatchObject({status: 'error', error: {code: 'SCOPE_DENIED'}});
    expect(browser.access.snapshot()).toEqual({requests: [], grants: []});
  });
});

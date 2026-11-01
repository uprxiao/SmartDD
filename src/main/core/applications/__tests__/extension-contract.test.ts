import {applicationToolDeclarations} from '@shared/application-capabilities';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applicationIdSchema, connectionConfigSchema } from '@shared/application-connections';
import { runBundledMigrations } from '../../../db/migrations';
import { ApplicationAdapterRegistry } from '../application-adapter-registry';
import { assertHostCompatible, parseManifest, validateBundle } from '../manifest';
import { PackageRegistry } from '../package-registry';
import { ResourceStore } from '../resource-store';
import { RuntimeRegistry } from '../runtime-registry';
import { fixtureBundle } from './fixtures';

// E-EXT: production schema/registry with fake metadata; never approve a distribution,
// load adapter code, connect to a provider, or add anything to the product catalog.
let root: string, sqlite: Database.Database, store: ResourceStore, packages: PackageRegistry, runtimeHash: string;
function fakeBundle(appId = 'extfixture') {
  const value = fixtureBundle();
  Object.assign(value.manifest, { appId, displayName: 'Isolated extension', permissions: [appId + '.read'] });
  value.manifest.connectionContracts[0].providerId = appId;
  Object.assign(applicationToolDeclarations(value.manifest)[0], { name: 'smartdd_' + appId + '_query_v1', permission: appId + '.read' });
  value.manifest.runtime.hash = runtimeHash;
  return value;
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'willyou-m10-extension-'));
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys=ON'); runBundledMigrations(sqlite);
  store = new ResourceStore(sqlite, root); packages = new PackageRegistry(store, 'isolated-extension');
  runtimeHash = (await new RuntimeRegistry(store).install({ id: 'applications', protocolMajor: 1, bridgeEntry: 'mcp-bridge.cjs', files: { 'mcp-bridge.cjs': Buffer.from('module.exports = {};\n') } })).contentHash;
});
afterEach(() => { sqlite.close(); rmSync(root, { recursive: true, force: true }); });

describe('R09 current extension boundaries without a third-party-code loader', () => {
  it('accepts two distinct fake package identities in the real registry without adding product entries or connection support', async () => {
    for (const id of ['extfixture', 'otherfixture']) {
      const source = fakeBundle(id), valid = validateBundle(source), installed = await packages.install(source);
      expect(installed.packageHash).toBe(valid.packageHash);
      expect(applicationToolDeclarations(installed.manifest).map(t => ({ name: t.name, permission: t.permission }))).toEqual([{ name: 'smartdd_' + id + '_query_v1', permission: id + '.read' }]);
      expect(packages.active(id)).toBeNull();
      expect(applicationIdSchema.safeParse(id).success).toBe(false);
    }
    expect(packages.list()).toHaveLength(2);
    for (const table of ['application_catalog_state', 'application_connections', 'application_invocations', 'capability_builtin_package_sources']) expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  });

  it('keeps repeated same content idempotent and rejects a duplicate app/version with different bytes', async () => {
    const source = fakeBundle(), installed = await packages.install(source);
    expect((await packages.install(source)).packageHash).toBe(installed.packageHash);
    const changed = fakeBundle(); changed.manifest.description = 'changed without a version';
    await expect(packages.install(changed)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(packages.list().map(p => p.packageHash)).toEqual([installed.packageHash]);
  });

  it('rejects duplicate tool IDs and missing complete-file entries before installation', async () => {
    const duplicate = fakeBundle(); applicationToolDeclarations(duplicate.manifest).push(structuredClone(applicationToolDeclarations(duplicate.manifest)[0]));
    await expect(packages.install(duplicate)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    const missing = fakeBundle(); delete missing.files['skills/query/SKILL.md'];
    await expect(packages.install(missing)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    expect(packages.list()).toHaveLength(0);
  });

  it('refuses future host and data API versions before creating package rows', async () => {
    for (const kind of ['host', 'data']) {
      const source = fakeBundle();
      if (kind === 'host') source.manifest.hostApi = { min: 2, max: 2 }; else source.manifest.dataApi = 2;
      expect(() => assertHostCompatible(parseManifest(source.manifest))).toThrow('不支持');
      await expect(packages.install(source)).rejects.toMatchObject({ code: 'HOST_INCOMPATIBLE' });
    }
    expect(packages.list()).toHaveLength(0);
  });

  it('distinguishes auth compatibility metadata from the actual host config and rejects unsupported auth', () => {
    const source = fakeBundle(); source.manifest.connectionContracts[0].authModes = ['future-auth'];
    expect(parseManifest(source.manifest).connectionContracts[0].authModes).toEqual(['future-auth']);
    expect(connectionConfigSchema.safeParse({ kind: 'extfixture', authMode: 'future-auth' }).success).toBe(false);
    expect(connectionConfigSchema.safeParse({ kind: 'zentao', baseUrl: 'https://isolated.invalid', username: 'fixture', authMode: 'future-auth' }).success).toBe(false);
  });

  it('rejects the historical effect field instead of treating a research declaration as an executable contract', async () => {
    const source = fakeBundle();
    const manifest = { ...source.manifest, tools: applicationToolDeclarations(source.manifest).map(tool => ({ ...tool, effect: 'external-write' })) };
    await expect(packages.install({ ...source, manifest })).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    expect(packages.list()).toHaveLength(0);
  });

  it('never loads the installed fake adapter or resolves Data API without trusted distribution provenance', async () => {
    const installed = await packages.install(fakeBundle()); let resolved = 0;
    const adapters = new ApplicationAdapterRegistry(store, { resolve: () => { resolved++; throw new Error('must not resolve'); } });
    expect(() => adapters.resolve(installed.packageHash, 'smartdd_extfixture_query_v1', 1)).toThrow('可信内置分发依据');
    expect(resolved).toBe(0);
    expect(sqlite.prepare('SELECT count(*) AS n FROM application_invocations').get()).toEqual({ n: 0 });
  });
});

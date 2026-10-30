import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDbClient, type DbClient } from '@main/db/client';
import { runBundledMigrations } from '@main/db/migrations';
import { FileWorkspacePersistence } from './workspace-persistence';
import type { SavedFileWorkspace } from '@shared/file-workspace';

const scope = { kind: 'project' as const, projectId: 'fixture' };
const route = { source: 'project-directory' as const, sourceId: 'one', sourcePath: '/fixture', relativePath: 'changed.xlsx', mode: 'document' as const };
const state: SavedFileWorkspace = { schemaVersion: 1, routes: [route], active: route, treeSource: 'project-directory:two:/other', expanded: {}, filters: {}, collapsedRoots: [], treeWidth: 250 };
let directory: string, file: string, client: DbClient, store: FileWorkspacePersistence;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'm9-route-db-')); file = join(directory, 'test.sqlite'); client = openDbClient(file); runBundledMigrations(client.sqlite); store = new FileWorkspacePersistence(client.db); });
afterEach(() => { client.close(); rmSync(directory, { recursive: true, force: true }); });

describe('durable file workspace settings', () => {
  it('round-trips only bounded PDF restore hints and rejects invalid values without replacing prior state', () => {
    const pdfRoute = { ...route, relativePath: 'reader.pdf', pdf: { page: 3, zoom: 150 } };
    store.save(scope, { ...state, routes: [pdfRoute], active: pdfRoute });
    expect(store.load(scope)!.routes[0].pdf).toEqual({ page: 3, zoom: 150 });
    for (const pdf of [{ page: 0, zoom: 100 }, { page: 1.5, zoom: 100 }, { page: 1, zoom: Infinity }, { page: 1, zoom: 29 }, { page: 1, zoom: 801 }, { page: 1, zoom: 100, password: 'must-not-store' }]) {
      expect(() => store.save(scope, { ...state, routes: [{ ...pdfRoute, pdf }] } as never)).toThrow();
    }
    expect(store.load(scope)!.routes[0].pdf).toEqual({ page: 3, zoom: 150 });
  });
  it('commits independent scopes to the existing database and reloads without browser state', () => {
    expect(store.load(scope)).toBeNull(); store.save(scope, state);
    store.save({ kind: 'task', taskId: 'fixture' }, { ...state, routes: [], active: null });
    const independent = openDbClient(file);
    try {
      expect(new FileWorkspacePersistence(independent.db).load(scope)).toEqual(state);
      expect(new FileWorkspacePersistence(independent.db).load({ kind: 'task', taskId: 'fixture' })?.routes).toEqual([]);
      const row = independent.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('fileWorkspace.v1:project:fixture') as { value: string };
      expect(JSON.parse(row.value)).toEqual(state);
    } finally { independent.close(); }
  });
  it('rejects capabilities, unsafe relative paths and excessive state without replacing prior routes', () => {
    store.save(scope, state);
    expect(() => store.save(scope, { ...state, lease: 'not-a-route' } as never)).toThrow();
    expect(() => store.save(scope, { ...state, routes: [{ ...route, relativePath: '../escape' }] })).toThrow();
    const huge = { ...state, expanded: { root: Array.from({ length: 2000 }, (_, i) => `${i}${'x'.repeat(4096)}`) } };
    expect(() => store.save(scope, huge)).toThrow('4 MiB');
    expect(store.load(scope)).toEqual(state);
  });
  it('reports corrupt records and database failures while preserving the last committed value', () => {
    store.save(scope, state);
    client.sqlite.exec("CREATE TRIGGER deny_workspace BEFORE UPDATE ON app_settings BEGIN SELECT RAISE(ABORT, 'fixture write denied'); END");
    expect(() => store.save(scope, { ...state, routes: [], active: null })).toThrow('fixture write denied');
    expect(store.load(scope)).toEqual(state);
    client.sqlite.exec('DROP TRIGGER deny_workspace');
    client.sqlite.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run('{broken', 'fileWorkspace.v1:project:fixture');
    expect(() => store.load(scope)).toThrow('原记录仍保留');
    expect(client.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('fileWorkspace.v1:project:fixture')).toEqual({ value: '{broken' });
  });
});

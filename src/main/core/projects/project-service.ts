import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  databaseInputSchema,
  dirInputSchema,
  projectInputSchema,
  serverInputSchema,
  type ConnectionTestResult,
  type DatabaseInput,
  type DatabaseView,
  type DbVendor,
  type DirInput,
  type LastTest,
  type ProjectDetail,
  type ProjectDirView,
  type ProjectInput,
  type ProjectSummary,
  type ServerInput,
  type ServerView,
  type TestCategory,
} from '@shared/projects';
import type { AppDb } from '../../db/client';
import { projectDatabases, projectDirs, projects, projectServers } from '../../db/schema';
import type { SecretsStore } from '../../secrets';
import { inspectDir, pathIdentity } from './dir-status';
import { secretKeys } from './secret-keys';

type ProjectRow = typeof projects.$inferSelect;
type DirRow = typeof projectDirs.$inferSelect;
type DbRow = typeof projectDatabases.$inferSelect;
type ServerRow = typeof projectServers.$inferSelect;

export interface DeleteOptions {
  /** PRD F09: the user decides whether the encrypted secrets go too. */
  deleteSecrets: boolean;
}

/** zod issues → one readable line; the renderer shows it as is. */
function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  throw new Error(`输入无效：${first.path.join('.') || '（根）'} ${first.message}`);
}

const parseAliases = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
};

function lastTestOf(row: DbRow | ServerRow): LastTest | null {
  if (row.lastTestAt == null) return null;
  return {
    at: row.lastTestAt,
    ok: Boolean(row.lastTestOk),
    category: (row.lastTestCategory ?? 'other') as TestCategory,
    message: row.lastTestMessage ?? '',
    ms: row.lastTestMs ?? 0,
  };
}

export class ProjectService {
  constructor(
    private readonly db: AppDb,
    private readonly secrets: SecretsStore,
    private readonly now: () => number = Date.now
  ) {}

  // ---- projects ----

  listProjects(opts: { includeArchived?: boolean } = {}): ProjectSummary[] {
    const rows = this.db
      .select()
      .from(projects)
      .where(opts.includeArchived ? undefined : isNull(projects.archivedAt))
      .orderBy(asc(projects.createdAt))
      .all();
    return rows.map((r) => this.toSummary(r));
  }

  getProject(id: string): ProjectDetail {
    const row = this.requireProject(id);
    const dirs = this.db.select().from(projectDirs).where(eq(projectDirs.projectId, id)).orderBy(asc(projectDirs.createdAt)).all();
    const dbs = this.db
      .select()
      .from(projectDatabases)
      .where(eq(projectDatabases.projectId, id))
      .orderBy(asc(projectDatabases.createdAt))
      .all();
    const servers = this.db
      .select()
      .from(projectServers)
      .where(eq(projectServers.projectId, id))
      .orderBy(asc(projectServers.createdAt))
      .all();
    return {
      ...this.toSummary(row),
      dirs: dirs.map((d) => this.toDirView(d)),
      databases: dbs.map((d) => this.toDatabaseView(d)),
      servers: servers.map((s) => this.toServerView(s)),
    };
  }

  createProject(input: ProjectInput, dirs: DirInput[] = []): ProjectDetail {
    const data = parse(projectInputSchema, input);
    const parsedDirs = dirs.map((d) => parse(dirInputSchema, d));
    const id = randomUUID();
    const ts = this.now();
    this.db.transaction(() => {
      this.assertUniqueName(data.name, null);
      this.db
        .insert(projects)
        .values({ id, ...data, aliases: JSON.stringify(data.aliases), createdAt: ts, updatedAt: ts })
        .run();
      for (const d of parsedDirs) this.insertDir(id, d, ts);
    });
    return this.getProject(id);
  }

  updateProject(id: string, input: ProjectInput): ProjectDetail {
    const data = parse(projectInputSchema, input);
    this.db.transaction(() => {
      this.requireProject(id);
      this.assertUniqueName(data.name, id);
      this.db
        .update(projects)
        .set({ ...data, aliases: JSON.stringify(data.aliases) })
        .where(eq(projects.id, id))
        .run();
      this.bump(id);
    });
    return this.getProject(id);
  }

  setArchived(id: string, archived: boolean): ProjectDetail {
    this.db.transaction(() => {
      const row = this.requireProject(id);
      if (!archived && row.archivedAt != null) {
        // Coming back to life must not create a second active owner for a path.
        const dirs = this.db.select().from(projectDirs).where(eq(projectDirs.projectId, id)).all();
        for (const d of dirs) this.assertPathFree(d.path, id, d.id);
        this.assertUniqueName(row.name, id);
      }
      this.db
        .update(projects)
        .set({ archivedAt: archived ? (row.archivedAt ?? this.now()) : null })
        .where(eq(projects.id, id))
        .run();
      this.bump(id);
    });
    return this.getProject(id);
  }

  /** Removes SmartDD's records only; code directories and remote resources are never touched. */
  deleteProject(id: string, opts: DeleteOptions): void {
    this.db.transaction(() => {
      this.requireProject(id);
      if (opts.deleteSecrets) {
        const dbIds = this.db.select({ id: projectDatabases.id }).from(projectDatabases).where(eq(projectDatabases.projectId, id)).all();
        const srvIds = this.db.select({ id: projectServers.id }).from(projectServers).where(eq(projectServers.projectId, id)).all();
        this.secrets.deleteMany([
          ...dbIds.flatMap((r) => secretKeys.database(r.id)),
          ...srvIds.flatMap((r) => secretKeys.server(r.id)),
        ]);
      }
      // Child rows go with it (ON DELETE CASCADE).
      this.db.delete(projects).where(eq(projects.id, id)).run();
    });
  }

  // ---- code directories ----

  addDir(projectId: string, input: DirInput): ProjectDirView {
    const data = parse(dirInputSchema, input);
    let id = '';
    this.db.transaction(() => {
      this.requireProject(projectId);
      id = this.insertDir(projectId, data, this.now());
      this.bump(projectId);
    });
    return this.toDirView(this.requireDir(id));
  }

  updateDir(id: string, input: DirInput): ProjectDirView {
    const data = parse(dirInputSchema, input);
    this.db.transaction(() => {
      const row = this.requireDir(id);
      this.assertPathFree(data.path, row.projectId, id);
      this.db
        .update(projectDirs)
        .set({ label: data.label, path: data.path, updatedAt: this.now() })
        .where(eq(projectDirs.id, id))
        .run();
      this.bump(row.projectId);
    });
    return this.toDirView(this.requireDir(id));
  }

  setDefaultDir(id: string): void {
    this.db.transaction(() => {
      const row = this.requireDir(id);
      this.db.update(projectDirs).set({ isDefault: false }).where(eq(projectDirs.projectId, row.projectId)).run();
      this.db.update(projectDirs).set({ isDefault: true }).where(eq(projectDirs.id, id)).run();
      this.bump(row.projectId);
    });
  }

  removeDir(id: string): void {
    this.db.transaction(() => {
      const row = this.requireDir(id);
      this.db.delete(projectDirs).where(eq(projectDirs.id, id)).run();
      if (row.isDefault) {
        // Keep exactly one default while any directory is left.
        const next = this.db
          .select({ id: projectDirs.id })
          .from(projectDirs)
          .where(eq(projectDirs.projectId, row.projectId))
          .orderBy(asc(projectDirs.createdAt))
          .get();
        if (next) this.db.update(projectDirs).set({ isDefault: true }).where(eq(projectDirs.id, next.id)).run();
      }
      this.bump(row.projectId);
    });
  }

  // ---- databases ----

  createDatabase(projectId: string, input: DatabaseInput): DatabaseView {
    const data = parse(databaseInputSchema, input);
    const id = randomUUID();
    const ts = this.now();
    this.db.transaction(() => {
      this.requireProject(projectId);
      const { password, ...fields } = data;
      if (fields.isDefault) this.clearDefaultDatabase(projectId);
      this.db
        .insert(projectDatabases)
        .values({ id, projectId, ...fields, aliases: JSON.stringify(fields.aliases), createdAt: ts, updatedAt: ts })
        .run();
      this.applySecret(secretKeys.databasePassword(id), password);
      this.bump(projectId);
    });
    return this.toDatabaseView(this.requireDatabase(id));
  }

  updateDatabase(id: string, input: DatabaseInput): DatabaseView {
    const data = parse(databaseInputSchema, input);
    this.db.transaction(() => {
      const row = this.requireDatabase(id);
      const { password, ...fields } = data;
      if (fields.isDefault) this.clearDefaultDatabase(row.projectId);
      this.db
        .update(projectDatabases)
        .set({ ...fields, aliases: JSON.stringify(fields.aliases), updatedAt: this.now() })
        .where(eq(projectDatabases.id, id))
        .run();
      this.applySecret(secretKeys.databasePassword(id), password);
      this.bump(row.projectId);
    });
    return this.toDatabaseView(this.requireDatabase(id));
  }

  deleteDatabase(id: string, opts: DeleteOptions): void {
    this.db.transaction(() => {
      const row = this.requireDatabase(id);
      if (opts.deleteSecrets) this.secrets.deleteMany(secretKeys.database(id));
      this.db.delete(projectDatabases).where(eq(projectDatabases.id, id)).run();
      this.bump(row.projectId);
    });
  }

  /** Connection parameters for a test. Main process only — the password never goes to the renderer. */
  databaseTarget(input: DatabaseInput, existingId?: string) {
    const data = parse(databaseInputSchema, input);
    return {
      vendor: data.vendor as DbVendor,
      host: data.host,
      port: data.port,
      database: data.database,
      schema: data.schema,
      username: data.username,
      password: this.resolveSecret(data.password, existingId ? secretKeys.databasePassword(existingId) : null),
    };
  }

  savedDatabaseInput(id: string): DatabaseInput {
    const r = this.requireDatabase(id);
    return {
      env: r.env,
      label: r.label,
      aliases: parseAliases(r.aliases),
      vendor: r.vendor as DbVendor,
      host: r.host,
      port: r.port,
      database: r.database,
      schema: r.schema,
      username: r.username,
      accessLevel: r.accessLevel,
      isDefault: r.isDefault,
      note: r.note,
    };
  }

  recordDatabaseTest(id: string, result: ConnectionTestResult): DatabaseView {
    this.db.update(projectDatabases).set(this.testColumns(result)).where(eq(projectDatabases.id, id)).run();
    return this.toDatabaseView(this.requireDatabase(id));
  }

  // ---- servers ----

  createServer(projectId: string, input: ServerInput): ServerView {
    const data = parse(serverInputSchema, input);
    const id = randomUUID();
    const ts = this.now();
    this.db.transaction(() => {
      this.requireProject(projectId);
      const { password, passphrase, sudoPassword, ...fields } = data;
      this.db
        .insert(projectServers)
        .values({ id, projectId, ...fields, aliases: JSON.stringify(fields.aliases), createdAt: ts, updatedAt: ts })
        .run();
      const keys = secretKeys.serverKeys(id);
      this.applySecret(keys.password, password);
      this.applySecret(keys.passphrase, passphrase);
      this.applySecret(keys.sudo, sudoPassword);
      this.bump(projectId);
    });
    return this.toServerView(this.requireServer(id));
  }

  updateServer(id: string, input: ServerInput): ServerView {
    const data = parse(serverInputSchema, input);
    this.db.transaction(() => {
      const row = this.requireServer(id);
      const { password, passphrase, sudoPassword, ...fields } = data;
      this.db
        .update(projectServers)
        .set({ ...fields, aliases: JSON.stringify(fields.aliases), updatedAt: this.now() })
        .where(eq(projectServers.id, id))
        .run();
      const keys = secretKeys.serverKeys(id);
      this.applySecret(keys.password, password);
      this.applySecret(keys.passphrase, passphrase);
      this.applySecret(keys.sudo, sudoPassword);
      this.bump(row.projectId);
    });
    return this.toServerView(this.requireServer(id));
  }

  deleteServer(id: string, opts: DeleteOptions): void {
    this.db.transaction(() => {
      const row = this.requireServer(id);
      if (opts.deleteSecrets) this.secrets.deleteMany(secretKeys.server(id));
      this.db.delete(projectServers).where(eq(projectServers.id, id)).run();
      this.bump(row.projectId);
    });
  }

  serverTarget(input: ServerInput, existingId?: string) {
    const data = parse(serverInputSchema, input);
    const keys = existingId ? secretKeys.serverKeys(existingId) : null;
    return {
      host: data.host,
      port: data.port,
      username: data.username,
      authType: data.authType,
      privateKeyPath: data.privateKeyPath,
      password: this.resolveSecret(data.password, keys?.password ?? null),
      passphrase: this.resolveSecret(data.passphrase, keys?.passphrase ?? null),
    };
  }

  savedServerInput(id: string): ServerInput {
    const r = this.requireServer(id);
    return {
      env: r.env,
      label: r.label,
      aliases: parseAliases(r.aliases),
      host: r.host,
      port: r.port,
      username: r.username,
      authType: r.authType,
      privateKeyPath: r.privateKeyPath,
      defaultRoot: r.defaultRoot,
      sudoPolicy: r.sudoPolicy,
      appRoot: r.appRoot,
      logsPath: r.logsPath,
      note: r.note,
    };
  }

  recordServerTest(id: string, result: ConnectionTestResult): ServerView {
    this.db.update(projectServers).set(this.testColumns(result)).where(eq(projectServers.id, id)).run();
    return this.toServerView(this.requireServer(id));
  }

  // ---- internals ----

  private insertDir(projectId: string, d: { label: string; path: string }, ts: number): string {
    this.assertPathFree(d.path, projectId);
    const hasDefault = this.db
      .select({ id: projectDirs.id })
      .from(projectDirs)
      .where(and(eq(projectDirs.projectId, projectId), eq(projectDirs.isDefault, true)))
      .get();
    const id = randomUUID();
    this.db
      .insert(projectDirs)
      .values({ id, projectId, label: d.label, path: d.path, isDefault: !hasDefault, createdAt: ts, updatedAt: ts })
      .run();
    return id;
  }

  /**
   * PRD F01: a path belongs to at most one active project, and appears once per project.
   * Archived projects do not hold their paths.
   */
  private assertPathFree(path: string, projectId: string, exceptDirId?: string): void {
    const identity = pathIdentity(path);
    const rows = this.db
      .select({ dirId: projectDirs.id, path: projectDirs.path, projectId: projects.id, name: projects.name, archivedAt: projects.archivedAt })
      .from(projectDirs)
      .innerJoin(projects, eq(projectDirs.projectId, projects.id))
      .all();
    for (const r of rows) {
      if (r.dirId === exceptDirId) continue;
      if (r.projectId !== projectId && r.archivedAt != null) continue;
      if (pathIdentity(r.path) !== identity) continue;
      throw new Error(
        r.projectId === projectId ? `该项目已登记此目录：${r.path}` : `目录已属于项目「${r.name}」：${r.path}`
      );
    }
  }

  private assertUniqueName(name: string, exceptId: string | null): void {
    const clash = this.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          sql`lower(${projects.name}) = lower(${name})`,
          isNull(projects.archivedAt),
          exceptId ? ne(projects.id, exceptId) : undefined
        )
      )
      .get();
    if (clash) throw new Error(`已有同名项目：${name}`);
  }

  private clearDefaultDatabase(projectId: string): void {
    this.db.update(projectDatabases).set({ isDefault: false }).where(eq(projectDatabases.projectId, projectId)).run();
  }

  /** undefined keeps, null or '' clears, anything else replaces. */
  private applySecret(key: string, change: string | null | undefined): void {
    if (change === undefined) return;
    if (change === null || change === '') this.secrets.delete(key);
    else this.secrets.set(key, change);
  }

  private resolveSecret(change: string | null | undefined, savedKey: string | null): string {
    if (change !== undefined) return change ?? '';
    return savedKey ? (this.secrets.get(savedKey) ?? '') : '';
  }

  /** Every config change gets a new version; sessions keep the version they started with. */
  private bump(projectId: string): void {
    this.db
      .update(projects)
      .set({ configVersion: sql`${projects.configVersion} + 1`, updatedAt: this.now() })
      .where(eq(projects.id, projectId))
      .run();
  }

  private testColumns(r: ConnectionTestResult) {
    return {
      lastTestAt: this.now(),
      lastTestOk: r.ok,
      lastTestCategory: r.category,
      lastTestMessage: r.ok ? (r.detail ?? '') : r.message,
      lastTestMs: r.ms,
    };
  }

  private requireProject(id: string): ProjectRow {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) throw new Error(`项目不存在：${id}`);
    return row;
  }

  private requireDir(id: string): DirRow {
    const row = this.db.select().from(projectDirs).where(eq(projectDirs.id, id)).get();
    if (!row) throw new Error(`代码目录不存在：${id}`);
    return row;
  }

  private requireDatabase(id: string): DbRow {
    const row = this.db.select().from(projectDatabases).where(eq(projectDatabases.id, id)).get();
    if (!row) throw new Error(`数据库配置不存在：${id}`);
    return row;
  }

  private requireServer(id: string): ServerRow {
    const row = this.db.select().from(projectServers).where(eq(projectServers.id, id)).get();
    if (!row) throw new Error(`服务器配置不存在：${id}`);
    return row;
  }

  private toSummary(r: ProjectRow): ProjectSummary {
    return {
      id: r.id,
      name: r.name,
      aliases: parseAliases(r.aliases),
      description: r.description,
      rulesPath: r.rulesPath,
      configVersion: r.configVersion,
      archivedAt: r.archivedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toDirView(r: DirRow): ProjectDirView {
    return { id: r.id, projectId: r.projectId, label: r.label, path: r.path, isDefault: r.isDefault, status: inspectDir(r.path) };
  }

  private toDatabaseView(r: DbRow): DatabaseView {
    return {
      id: r.id,
      projectId: r.projectId,
      env: r.env,
      label: r.label,
      aliases: parseAliases(r.aliases),
      vendor: r.vendor as DbVendor,
      host: r.host,
      port: r.port,
      database: r.database,
      schema: r.schema,
      username: r.username,
      accessLevel: r.accessLevel,
      isDefault: r.isDefault,
      note: r.note,
      hasPassword: this.secrets.has(secretKeys.databasePassword(r.id)),
      lastTest: lastTestOf(r),
    };
  }

  private toServerView(r: ServerRow): ServerView {
    const keys = secretKeys.serverKeys(r.id);
    return {
      id: r.id,
      projectId: r.projectId,
      env: r.env,
      label: r.label,
      aliases: parseAliases(r.aliases),
      host: r.host,
      port: r.port,
      username: r.username,
      authType: r.authType,
      privateKeyPath: r.privateKeyPath,
      defaultRoot: r.defaultRoot,
      sudoPolicy: r.sudoPolicy,
      appRoot: r.appRoot,
      logsPath: r.logsPath,
      note: r.note,
      hasPassword: this.secrets.has(keys.password),
      hasPassphrase: this.secrets.has(keys.passphrase),
      hasSudoPassword: this.secrets.has(keys.sudo),
      lastTest: lastTestOf(r),
    };
  }
}

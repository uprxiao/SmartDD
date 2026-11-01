import { createHash, randomUUID } from 'node:crypto';
import { asc, eq, like, sql } from 'drizzle-orm';
import {
  aiProfileInputSchema,
  CHECK_STATUS_OF,
  describeProfileIssue,
  type AiProfileData,
  type AiProfileInput,
  type AiProfileView,
  type ProfileCheck,
  type ProfileCheckCategory,
  type ProfileCheckSource,
  type ZshrcImportCandidate,
} from '@shared/ai-profiles';
import type { InputIssue } from '@shared/projects';
import type { Runner } from '@shared/types';
import type { AppDb } from '../../db/client';
import { aiProfiles, appSecrets } from '../../db/schema';
import type { SecretsStore } from '../../secrets';
import { maskPreview, parseZshrc, suggestedProfileName } from './zshrc-import';
import { builtinRunnerAdapters, type RunnerAdapterRegistry } from '../tasks/runner-adapters';

type ProfileRow = typeof aiProfiles.$inferSelect;
interface StoredEnv {
  name: string;
  secret: boolean;
  value: string | null;
}

export const aiSecretKey = (profileId: string, name: string) => `ai:${profileId}:env:${name}`;
const aiSecretPrefix = (profileId: string) => `ai:${profileId}:env:`;

function parse(value: unknown): AiProfileData {
  const r = aiProfileInputSchema.safeParse(value);
  if (r.success) return r.data;
  throw new Error(`输入无效：${describeProfileIssue(r.error.issues[0] as InputIssue)}`);
}

function parseJsonArray<T>(json: string, keep: (v: unknown) => v is T): T[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter(keep) : [];
  } catch {
    return [];
  }
}
const readEnv = (row: ProfileRow) =>
  parseJsonArray(row.env, (v): v is StoredEnv => typeof v === 'object' && v !== null && typeof (v as StoredEnv).name === 'string');
const readArgs = (row: ProfileRow) => parseJsonArray(row.args, (v): v is string => typeof v === 'string');

function checkOfRow(row: ProfileRow): ProfileCheck | null {
  if (row.checkAt == null || !row.checkStatus) return null;
  return {
    status: row.checkStatus,
    category: (row.checkCategory ?? 'other') as ProfileCheckCategory,
    source: (row.checkSource ?? 'manual') as ProfileCheckSource,
    message: row.checkMessage ?? '',
    ms: row.checkMs,
    at: row.checkAt,
  };
}

/** Everything needed to start the CLI; values are plaintext and must stay in the main process. */
export interface ResolvedProfile {
  id: string;
  name: string;
  runner: Runner;
  command: string;
  args: string[];
  env: Record<string, string>;
  isolatePrefixes: string[];
}

export class AiProfileService {
  constructor(
    private readonly db: AppDb,
    private readonly secrets: SecretsStore,
    private readonly now: () => number = Date.now,
    readonly runnerAdapters: RunnerAdapterRegistry = builtinRunnerAdapters
  ) {}

  private parse(input: unknown): AiProfileData {
    const common = parse(input), adapter = this.runnerAdapters.get(common.runner);
    const result = adapter.profileSchema().safeParse(common);
    if (!result.success) throw new Error('输入无效：运行器配置不符合已登记的字段约定');
    return common;
  }

  list(): AiProfileView[] {
    return this.db
      .select()
      .from(aiProfiles)
      .orderBy(asc(aiProfiles.createdAt))
      .all()
      .map((r) => this.toView(r));
  }

  get(id: string): AiProfileView {
    return this.toView(this.require(id));
  }

  defaultProfileId(): string | null {
    return this.db.select({ id: aiProfiles.id }).from(aiProfiles).where(eq(aiProfiles.isDefault, true)).get()?.id ?? null;
  }

  create(input: AiProfileInput): AiProfileView {
    const data = this.parse(input);
    const id = randomUUID();
    const ts = this.now();
    this.db.transaction(() => {
      this.assertUniqueName(data.name, null);
      const first = !this.db.select({ id: aiProfiles.id }).from(aiProfiles).get();
      this.db
        .insert(aiProfiles)
        .values({
          id,
          name: data.name,
          runner: data.runner,
          executable: data.executable,
          env: JSON.stringify(this.storeEnv(id, data, [])),
          args: JSON.stringify(data.args),
          color: data.color,
          isDefault: false,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      if (data.isDefault || first) this.markDefault(id);
    });
    return this.get(id);
  }

  update(id: string, input: AiProfileInput): AiProfileView {
    const data = this.parse(input);
    const row = this.require(id);
    this.db.transaction(() => {
      this.assertUniqueName(data.name, id);
      this.db
        .update(aiProfiles)
        .set({
          name: data.name,
          runner: data.runner,
          executable: data.executable,
          env: JSON.stringify(this.storeEnv(id, data, readEnv(row))),
          commandPending: row.commandPending && data.executable === row.executable && data.runner === row.runner,
          args: JSON.stringify(data.args),
          color: data.color,
          updatedAt: this.now(),
        })
        .where(eq(aiProfiles.id, id))
        .run();
      if (data.isDefault) this.markDefault(id);
    });
    return this.get(id);
  }

  setDefault(id: string): void {
    this.require(id);
    this.markDefault(id);
  }

  /** Tasks keep a snapshot of the name; their profile link is set to null by the FK. */
  delete(id: string): void {
    const row = this.require(id);
    this.db.transaction(() => {
      this.db.delete(aiProfiles).where(eq(aiProfiles.id, id)).run();
      this.deleteSecretsOf(id);
      if (row.isDefault) {
        const next = this.db.select({ id: aiProfiles.id }).from(aiProfiles).orderBy(asc(aiProfiles.createdAt)).get();
        if (next) this.markDefault(next.id);
      }
    });
  }

  /**
   * Decrypts the profile for a launch. A secret variable without a value stops the launch
   * (PRD §9: never fall back to another profile's token or the shell's).
   */
  resolve(id: string, allowPendingCommand = false): ResolvedProfile {
    const row = this.require(id);
    if (row.commandPending && !allowPendingCommand) throw new Error(`AI 配置「${row.name}」的本机命令尚未配置，请在设置中修改命令或完成一次连接测试`);
    const env: Record<string, string> = {};
    const missing: string[] = [];
    for (const e of readEnv(row)) {
      if (!e.secret) {
        env[e.name] = e.value ?? '';
        continue;
      }
      const v = this.secrets.get(aiSecretKey(id, e.name));
      if (v == null || v === '') missing.push(e.name);
      else env[e.name] = v;
    }
    if (missing.length) throw new Error(`AI 配置「${row.name}」缺少令牌：${missing.join('、')}，请在设置中补充`);
    return {
      id,
      name: row.name,
      runner: row.runner,
      command: row.executable ?? this.runnerAdapters.get(row.runner).describe().command,
      args: readArgs(row),
      env,
      isolatePrefixes: [...(this.runnerAdapters.get(row.runner).describe().isolatedEnvPrefixes ?? [])],
    };
  }

  /** Masked preview of the `.zshrc` account branches; values never leave the main process. */
  previewZshrc(text: string): { found: boolean; candidates: ZshrcImportCandidate[]; warnings: string[] } {
    const parsed = parseZshrc(text);
    const names = new Set(this.list().map((p) => p.name.toLowerCase()));
    return {
      found: parsed.found,
      warnings: parsed.warnings,
      candidates: parsed.accounts.map((a) => ({
        account: a.account,
        labels: a.labels,
        aliases: a.aliases,
        suggestedName: suggestedProfileName(a),
        env: a.env.map((e) => ({ name: e.name, secret: e.secret, preview: maskPreview(e.name, e.value, e.secret) })),
        warnings: a.warnings,
        exists: names.has(suggestedProfileName(a).toLowerCase()),
      })),
    };
  }

  /** Creates one Claude Code profile per selected account; names that already exist are skipped. */
  importZshrc(text: string, accounts: string[]): { created: AiProfileView[]; skipped: string[] } {
    const parsed = parseZshrc(text);
    const created: AiProfileView[] = [];
    const skipped: string[] = [];
    for (const account of accounts) {
      const a = parsed.accounts.find((x) => x.account === account);
      if (!a) {
        skipped.push(`${account}（文件中已找不到该账号）`);
        continue;
      }
      const name = suggestedProfileName(a);
      if (this.list().some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        skipped.push(`${name}（已存在）`);
        continue;
      }
      created.push(
        this.create({
          name,
          runner: 'claude',
          executable: null,
          env: a.env.map((e) => ({ name: e.name, secret: e.secret, value: e.value })),
          args: [],
          color: null,
          isDefault: false,
        })
      );
    }
    return { created, skipped };
  }

  /**
   * Fingerprint of everything that decides how the CLI starts (runner, command, arguments,
   * variable values), so an edit of only the name or colour does not trigger a re-test.
   */
  launchSignature(id: string): string {
    let material: string;
    try {
      const p = this.resolve(id, true);
      material = JSON.stringify([p.runner, p.command, p.args, Object.entries(p.env).sort()]);
    } catch (e) {
      material = `unresolvable:${(e as Error).message}`;
    }
    return createHash('sha256').update(material).digest('hex');
  }

  /** Stores the latest health result; a profile deleted meanwhile is ignored. */
  recordCheck(id: string, r: { category: ProfileCheckCategory; source: ProfileCheckSource; message: string; ms: number | null }): ProfileCheck | null {
    const check: ProfileCheck = { status: CHECK_STATUS_OF[r.category], category: r.category, source: r.source, message: r.message, ms: r.ms, at: this.now() };
    const res = this.db
      .update(aiProfiles)
      .set({
        checkStatus: check.status,
        ...(check.status === 'ok' ? { commandPending: false } : {}),
        checkCategory: check.category,
        checkSource: check.source,
        checkMessage: check.message,
        checkMs: check.ms,
        checkAt: check.at,
      })
      .where(eq(aiProfiles.id, id))
      .run();
    return res.changes > 0 ? check : null;
  }

  checkOf(id: string): ProfileCheck | null {
    const row = this.db.select().from(aiProfiles).where(eq(aiProfiles.id, id)).get();
    return row ? checkOfRow(row) : null;
  }

  /** Values of secret variables, for redacting CLI output in logs and errors. */
  secretValues(id: string): string[] {
    const row = this.db.select().from(aiProfiles).where(eq(aiProfiles.id, id)).get();
    if (!row) return [];
    return readEnv(row)
      .filter((e) => e.secret)
      .map((e) => this.secrets.get(aiSecretKey(id, e.name)))
      .filter((v): v is string => Boolean(v));
  }

  // ---- internals ----

  /** Applies the keep/clear/replace semantics for secrets and returns what goes into the row. */
  private storeEnv(id: string, data: AiProfileData, previous: StoredEnv[]): StoredEnv[] {
    const next = data.env.map((e) => ({ name: e.name, secret: e.secret, value: e.secret ? null : (e.value ?? '') }));
    const keepSecret = new Set(next.filter((e) => e.secret).map((e) => e.name));
    // Secrets of removed variables, or of variables that are no longer secret, go away.
    const stale = previous.filter((p) => p.secret && !keepSecret.has(p.name)).map((p) => aiSecretKey(id, p.name));
    this.secrets.deleteMany(stale);
    for (const e of data.env) {
      if (!e.secret || e.value === undefined) continue;
      if (e.value === null || e.value === '') this.secrets.delete(aiSecretKey(id, e.name));
      else this.secrets.set(aiSecretKey(id, e.name), e.value);
    }
    return next;
  }

  private deleteSecretsOf(id: string): void {
    // Keys are derived from the id, so a prefix match also catches secrets of renamed variables.
    // The prefix has no LIKE wildcards: a UUID plus fixed text.
    this.db.delete(appSecrets).where(like(appSecrets.key, `${aiSecretPrefix(id)}%`)).run();
  }

  private markDefault(id: string): void {
    this.db.update(aiProfiles).set({ isDefault: sql`id = ${id}` }).run();
  }

  private assertUniqueName(name: string, exceptId: string | null): void {
    const clash = this.db
      .select({ id: aiProfiles.id })
      .from(aiProfiles)
      .where(sql`lower(${aiProfiles.name}) = lower(${name})`)
      .all()
      .find((r) => r.id !== exceptId);
    if (clash) throw new Error(`已存在名为「${name}」的 AI 配置`);
  }

  private require(id: string): ProfileRow {
    const row = this.db.select().from(aiProfiles).where(eq(aiProfiles.id, id)).get();
    if (!row) throw new Error('AI 配置不存在或已被删除');
    return row;
  }

  private toView(row: ProfileRow): AiProfileView {
    return {
      id: row.id,
      name: row.name,
      runner: row.runner,
      executable: row.executable,
      env: readEnv(row).map((e) => ({
        name: e.name,
        secret: e.secret,
        value: e.secret ? null : (e.value ?? ''),
        hasValue: e.secret ? this.secrets.has(aiSecretKey(row.id, e.name)) : Boolean(e.value),
      })),
      args: readArgs(row),
      color: row.color,
      isDefault: row.isDefault,
      check: checkOfRow(row),
      checking: false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

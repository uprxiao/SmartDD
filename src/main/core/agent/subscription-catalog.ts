import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
import type { CodeAgentTool } from '@shared/ai-agents';
import { agentModelsSchema, type AgentModelCatalog, type AgentModelOption, type CatalogReadMode } from '@shared/agent-model-choice';
import { projectLayers } from '../capabilities/discovery';
import { CLAUDE_MODEL_VARIABLES } from '../ai/agent-launch-plan';
import type { ProfileLaunch } from './profile-launch';
import { DriverError } from './driver';
import type { CatalogObserver, CodexCatalogResult } from './drivers/codex-catalog';

type Probe = (observer: CatalogObserver) => Promise<CodexCatalogResult>;
interface Entry {
  snapshot: AgentModelCatalog;
  account?: string;
  verified: boolean;
  pending?: Promise<void>;
  available?: Promise<void>;
  refreshAt: number;
}
const PREFIX = 'codexModelCatalog.v1.';
const SCOPE_PREFIX = 'codexModelScope.v1.';
const FRESH_FOR = 5 * 60_000;
function cacheKey(prefix: string, ...parts: string[]) {
  return prefix + createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function fileStamp(path: string) {
  try {
    const file = statSync(path);
    if (file.isFile()) return [file.dev, file.ino, file.size, file.mtimeMs, file.ctimeMs];
  } catch { /* Optional local file. */ }
  return null;
}

/** Use a local file identity for immediate display only when Codex uses file-backed login. */
export function subscriptionCatalogScope(profileId: string, launch: ProfileLaunch, tool: CodeAgentTool, cwd: string) {
  const home = launch.env.HOME ?? homedir();
  const auth = fileStamp(join(launch.stateRoot, 'auth.json'));
  const paths = ['/etc/codex/config.toml', join(launch.stateRoot, 'config.toml'),
    ...projectLayers(cwd, home).map(dir => join(dir, '.codex', 'config.toml'))];
  const configs = [...new Set(paths)].flatMap(path => {
    const stamp = fileStamp(path);
    return stamp ? [{ path, stamp }] : [];
  });
  const otherStorage = /cli_auth_credentials_store["']?\s*=\s*["']?(?:keyring|auto|ephemeral)/i;
  const localLoginBound = !!auth && !launch.extraArgs.some(arg => otherStorage.test(arg)) && configs.every(({ path, stamp }) => {
    if (stamp[2] > 1024 * 1024) return false;
    try { return !otherStorage.test(readFileSync(path, 'utf8')); } catch { return false; }
  });
  const key = cacheKey('', profileId, JSON.stringify([launch.stateRoot, launch.compatibility, launch.extraArgs, launch.command,
    fileStamp(launch.command), tool.version, tool.login, isAbsolute(launch.command) ? null : launch.env.PATH,
    launch.env.OPENAI_BASE_URL, launch.env.CHATGPT_BASE_URL, auth, configs]));
  return { key, localLoginBound };
}

export function claudeCatalogScope(profileId: string, launch: ProfileLaunch, tool: CodeAgentTool, cwd: string) {
  const home = launch.env.HOME ?? homedir();
  const paths = [join(launch.stateRoot, 'settings.json'), join(launch.stateRoot, '.credentials.json'),
    ...projectLayers(cwd, home).flatMap(dir => ['settings.json', 'settings.local.json'].map(file => join(dir, '.claude', file)))];
  const env = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', ...CLAUDE_MODEL_VARIABLES];
  return cacheKey('claude:', profileId, JSON.stringify([cwd, launch.stateRoot, launch.command, fileStamp(launch.command),
    tool.login, tool.version, launch.env.PATH, env.map(name => launch.env[name]),
    paths.map(path => [path, fileStamp(path)])]));
}

export class SubscriptionCatalogs {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly db: Database.Database) {}

  async read(key: string, probe: Probe, mode: CatalogReadMode = 'peek', localLoginBound: boolean | string = false): Promise<AgentModelCatalog> {
    const verifiedAccount = typeof localLoginBound === 'string' ? localLoginBound : undefined;
    const entryKey = verifiedAccount ? cacheKey('', key, verifiedAccount) : key;
    let entry = this.entries.get(entryKey);
    if (!entry) {
      if (this.entries.size >= 32) {
        const idle = [...this.entries].find(([, v]) => !v.pending);
        if (idle) this.entries.delete(idle[0]);
      }
      const account = verifiedAccount ?? (localLoginBound ? this.lastAccount(key) : undefined);
      const saved = account && this.restore(cacheKey(PREFIX, key, account));
      entry = saved
        ? { snapshot: { status: 'ready', models: saved.models }, account, verified: true, refreshAt: saved.checkedAt + FRESH_FOR }
        : { snapshot: { status: 'loading', models: [] }, account, verified: false, refreshAt: 0 };
      this.entries.set(entryKey, entry);
    }
    if (!entry.pending && (mode === 'retry' || Date.now() >= entry.refreshAt)) {
      if ([...this.entries.values()].filter(v => v.pending).length >= 8) {
        if (entry.verified) return entry.snapshot;
        throw new DriverError('STATE', '模型目录查询繁忙，请稍后重试');
      }
      entry.snapshot = { models: entry.snapshot.models, status: entry.snapshot.models.length ? 'refreshing' : 'loading' };
      let usable!: () => void;
      entry.available = new Promise(resolve => { usable = resolve; });
      entry.pending = this.refresh(key, entry, probe, usable).finally(() => { entry.pending = undefined; usable(); });
    }
    if (mode === 'wait' && !entry.verified) await entry.available;
    return entry.snapshot;
  }

  private async refresh(key: string, entry: Entry, probe: Probe, usable: () => void) {
    let observedAccount: string | undefined;
    try {
      const result = await probe({
        account: identity => {
          observedAccount = identity;
          if (this.lastAccount(key) !== identity) {
            try { this.db.prepare('DELETE FROM app_settings WHERE key=?').run(cacheKey(SCOPE_PREFIX, key)); } catch { /* read-only cache */ }
          }
          if (identity !== entry.account) {
            entry.verified = false;
            entry.snapshot = { status: 'loading', models: [] };
          }
          entry.account = identity;
          if (!identity) return;
          const saved = this.restore(cacheKey(PREFIX, key, identity));
          if (saved) {
            entry.verified = true;
            entry.snapshot = { status: 'refreshing', models: saved.models };
            usable();
          }
        },
        fallback: models => {
          if (!entry.verified) entry.snapshot = { status: 'refreshing', models };
        },
      });
      if (result.confirmed) {
        entry.snapshot = { status: 'ready', models: result.models };
        entry.verified = true;
        if (observedAccount) this.save(key, observedAccount, result.models);
      } else {
        entry.snapshot = { status: 'unavailable', models: entry.verified ? entry.snapshot.models : result.models };
      }
    } catch {
      entry.snapshot = { status: 'unavailable', models: entry.snapshot.models };
    }
    entry.refreshAt = Date.now() + (entry.snapshot.status === 'ready' ? FRESH_FOR : 15_000);
  }

  /** A confirmed runtime account can reuse its last verified directory while a refresh is in progress. */
  async modelsForRun(key: string, account: string, refresh?: () => void) {
    const saved = this.restore(cacheKey(PREFIX, key, account));
    if (saved) {
      if (saved.checkedAt + FRESH_FOR <= Date.now()) refresh?.();
      return saved.models;
    }
    return undefined;
  }

  remember(key: string, account: string, models: AgentModelOption[]) {
    const entry = this.entries.get(key);
    if (entry?.account && entry.account !== account) return;
    this.save(key, account, models);
    if (entry && !entry.pending) {
      entry.snapshot = { status: 'ready', models };
      entry.account = account;
      entry.verified = true;
      entry.refreshAt = Date.now() + FRESH_FOR;
    }
  }

  private lastAccount(key: string): string | undefined {
    try {
      const row = this.db.prepare('SELECT value FROM app_settings WHERE key=? AND length(value)<=256')
        .get(cacheKey(SCOPE_PREFIX, key)) as { value: string } | undefined;
      const value: unknown = row && JSON.parse(row.value);
      return typeof value === 'string' ? value : undefined;
    } catch { return undefined; }
  }

  private restore(key: string): { models: AgentModelOption[]; checkedAt: number } | undefined {
    try {
      const row = this.db.prepare('SELECT value,updated_at FROM app_settings WHERE key=? AND length(value)<=262144')
        .get(key) as { value: string; updated_at: number } | undefined;
      return row && { models: agentModelsSchema.parse(JSON.parse(row.value)), checkedAt: row.updated_at };
    } catch { return undefined; }
  }

  private save(key: string, account: string, models: AgentModelOption[]) {
    try {
      this.db.transaction(() => {
        const write = this.db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at');
        const now = Date.now();
        write.run(cacheKey(PREFIX, key, account), JSON.stringify(models), now);
        write.run(cacheKey(SCOPE_PREFIX, key), JSON.stringify(account), now);
        const trim = this.db.prepare('DELETE FROM app_settings WHERE key IN (SELECT key FROM app_settings WHERE key GLOB ? ORDER BY updated_at DESC, key DESC LIMIT -1 OFFSET 32)');
        trim.run(PREFIX + '*');
        trim.run(SCOPE_PREFIX + '*');
      })();
    } catch { /* The native account response remains usable with a read-only or full cache. */ }
  }
}

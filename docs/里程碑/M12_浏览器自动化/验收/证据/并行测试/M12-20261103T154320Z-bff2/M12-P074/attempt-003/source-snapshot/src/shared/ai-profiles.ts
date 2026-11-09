import { z } from 'zod';
import type { InputIssue } from './projects';
import { describeIssue } from './projects';
import type { Runner } from './types';
import { agentIdSchema } from './agent-id';

// AI 配置 = 运行器（程序）+ 一组环境变量和启动参数（PRD F04）。

export const RUNNERS: Record<Runner, { label: string; command: string }> = {
  claude: { label: 'Claude Code', command: 'claude' },
  codex: { label: 'Codex', command: 'codex' },
};
export const RUNNER_IDS = Object.keys(RUNNERS) as Runner[];
/** Historical or externally registered ids remain readable without guessing a builtin identity. */
export const runnerDescription = (id: Runner) => RUNNERS[id] ?? { label: id, command: id };

/**
 * Inherited variables that would silently pick another account. They are cleared before the
 * profile's own variables are applied, so the profile is the only source (see launch-env.ts).
 */
export const ISOLATED_ENV_PREFIXES: Record<Runner, string[]> = {
  claude: ['ANTHROPIC_'],
  codex: [],
};

export const PROFILE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#64748b'] as const;

export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Names that look like credentials are stored encrypted and never shown. */
export function isSecretEnvName(name: string): boolean {
  return /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i.test(name);
}

const envEntry = z.object({
  name: z.string().trim().regex(ENV_NAME_RE, { message: '变量名只能包含字母、数字和下划线，且不能以数字开头' }),
  secret: z.boolean(),
  /**
   * Plain variables: the value ('' when missing). Secret variables: undefined keeps the saved
   * value, null clears it, a string replaces it.
   */
  value: z.string().max(8192).nullable().optional(),
});

export const aiProfileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    runner: agentIdSchema,
    /** null = the runner's own command, found on the login shell's PATH. */
    executable: z
      .string()
      .trim()
      .max(1024)
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || !/[\s'"`$;&|<>\\]/.test(v), { message: '只能是命令名或路径，不能包含空格和 shell 特殊字符' }),
    env: z.array(envEntry).max(100),
    args: z.array(z.string().max(4096)).max(50),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
    isDefault: z.boolean(),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.env.forEach((e, i) => {
      if (seen.has(e.name)) ctx.addIssue({ code: 'custom', path: ['env', i, 'name'], message: `变量 ${e.name} 重复` });
      seen.add(e.name);
    });
  });
export type AiProfileInput = z.input<typeof aiProfileInputSchema>;
export type AiProfileData = z.output<typeof aiProfileInputSchema>;

const PROFILE_LABELS: Record<string, string> = {
  name: '配置名称',
  runner: '运行器',
  executable: '可执行文件',
  env: '环境变量',
  args: '启动参数',
  color: '颜色',
};
export const describeProfileIssue = (issue: InputIssue) => describeIssue(issue, PROFILE_LABELS);

export interface AiProfileEnvView {
  name: string;
  secret: boolean;
  /** Plain variables only; secret values never leave the main process. */
  value: string | null;
  hasValue: boolean;
}

// ---- health: the profile's last test or the last API answer seen in a task ----

/** ok: answered. failed: unusable until fixed (auth, billing, model). warning: probably temporary. */
export type ProfileCheckStatus = 'ok' | 'failed' | 'warning';
export type ProfileCheckCategory =
  | 'ok'
  | 'auth'
  | 'billing'
  | 'model'
  | 'config'
  | 'not_found'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'unexpected'
  | 'other';

export const CHECK_STATUS_OF: Record<ProfileCheckCategory, ProfileCheckStatus> = {
  ok: 'ok',
  auth: 'failed',
  billing: 'failed',
  model: 'failed',
  config: 'failed',
  not_found: 'failed',
  other: 'failed',
  rate_limit: 'warning',
  server: 'warning',
  network: 'warning',
  timeout: 'warning',
  unexpected: 'warning',
};

/** manual / auto (after import, create or a launch-affecting edit) / task:<taskId>. */
export type ProfileCheckSource = 'manual' | 'auto' | `task:${string}`;

export interface ProfileCheck {
  status: ProfileCheckStatus;
  category: ProfileCheckCategory;
  source: ProfileCheckSource;
  /** Redacted; the CLI's own words where there are any. */
  message: string;
  /** Test duration; null for results seen in a task. */
  ms: number | null;
  at: number;
}

export interface AiProfileView {
  id: string;
  name: string;
  runner: Runner;
  executable: string | null;
  env: AiProfileEnvView[];
  args: string[];
  color: string | null;
  isDefault: boolean;
  check: ProfileCheck | null;
  /** A test is running now (memory only). */
  checking: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RunnerInfo {
  runner: Runner;
  command: string;
  /** Resolved path on the login shell's PATH, null when not found. */
  path: string | null;
  version: string | null;
  error: string | null;
}

/** One `claude_with_account` branch found in ~/.zshrc, values masked for the preview. */
export interface ZshrcImportCandidate {
  account: string;
  labels: string[];
  aliases: string[];
  suggestedName: string;
  env: { name: string; secret: boolean; preview: string }[];
  /** Lines we could not take over literally, e.g. values referring to other variables. */
  warnings: string[];
  /** A profile with this name already exists. */
  exists: boolean;
}

// ---- launch arguments as typed in one line ----

/** Splits like a shell would for words and quotes, without expansion: `--model "a b"` → ['--model', 'a b']. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && (line[i + 1] === '"' || line[i + 1] === '\\')) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (quote) throw new Error('启动参数中的引号没有闭合');
  if (has) out.push(cur);
  return out;
}

/** Inverse of splitArgs for display. */
export function joinArgs(args: string[]): string {
  return args.map((a) => (a !== '' && /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}

/**
 * The model a profile asks for, for the status bar: `--model x` / `--model=x` (and Codex `-m x`)
 * in the launch arguments win over a plain model variable, as on the CLIs themselves.
 * null when the profile leaves it to the CLI's own default.
 */
export function profileModel(p: Pick<AiProfileView, 'runner' | 'env' | 'args'>): string | null {
  const flags = p.runner === 'codex' ? ['--model', '-m'] : ['--model'];
  for (let i = p.args.length - 1; i >= 0; i--) {
    const a = p.args[i];
    if (flags.includes(a) && i + 1 < p.args.length && p.args[i + 1]) return p.args[i + 1];
    const eq = flags.find((f) => f.startsWith('--') && a.startsWith(`${f}=`));
    if (eq && a.length > eq.length + 1) return a.slice(eq.length + 1);
  }
  const name = p.runner === 'claude' ? 'ANTHROPIC_MODEL' : null;
  const v = name ? p.env.find((e) => e.name === name && !e.secret)?.value : null;
  return v || null;
}

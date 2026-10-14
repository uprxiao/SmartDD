import { z } from 'zod';

// Shared by main (validation before writing) and renderer (types, vendor list).

/** Suggested environment tags; any non-empty custom tag is allowed too. */
export const ENV_PRESETS = ['dev', 'test', 'prod'] as const;

export type DbTransport = 'mysql' | 'postgres';

/**
 * Vendors as named by the existing `operate-databases` Skill. The connection test speaks the
 * wire protocol (`transport`); vendor-specific auth methods may still be refused and are then
 * reported as "unsupported authentication method", not as a wrong password.
 */
export const DB_VENDORS = {
  mysql: { label: 'MySQL', transport: 'mysql', defaultPort: 3306 },
  postgres: { label: 'PostgreSQL', transport: 'postgres', defaultPort: 5432 },
  opengauss: { label: 'openGauss', transport: 'postgres', defaultPort: 5432 },
  panweidb: { label: '盘维 PanweiDB', transport: 'postgres', defaultPort: 5432 },
  kingbase: { label: 'KingbaseES', transport: 'postgres', defaultPort: 54321 },
  highgo: { label: 'HighGo', transport: 'postgres', defaultPort: 5866 },
  oceanbase: { label: 'OceanBase (MySQL)', transport: 'mysql', defaultPort: 2881 },
  goldendb: { label: 'GoldenDB', transport: 'mysql', defaultPort: 3306 },
} as const satisfies Record<string, { label: string; transport: DbTransport; defaultPort: number }>;

export type DbVendor = keyof typeof DB_VENDORS;
export const DB_VENDOR_IDS = Object.keys(DB_VENDORS) as DbVendor[];

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);
const optionalPath = z
  .string()
  .trim()
  .max(1024)
  .nullable()
  .transform((v) => (v ? v : null));
const aliases = z
  .array(z.string())
  .max(50)
  .transform((list) => [...new Set(list.map((a) => a.trim()).filter(Boolean))]);
const port = z.number().int().min(1).max(65535);
/** undefined = keep the saved secret, null = clear it, string = replace it. */
const secretChange = z.string().max(4096).nullable().optional();

export const projectInputSchema = z.object({
  name: required(100),
  aliases,
  description: trimmed(2000),
  rulesPath: optionalPath,
});
export type ProjectInput = z.input<typeof projectInputSchema>;

export const dirInputSchema = z.object({
  label: trimmed(100),
  path: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine((p) => p.startsWith('/'), { message: '必须是绝对路径' }),
});
export type DirInput = z.input<typeof dirInputSchema>;

export const databaseInputSchema = z.object({
  env: required(32),
  label: trimmed(100),
  aliases,
  vendor: z.enum(DB_VENDOR_IDS as [DbVendor, ...DbVendor[]]),
  host: required(255),
  port,
  database: trimmed(255),
  schema: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .transform((v) => (v ? v : null)),
  username: required(255),
  accessLevel: z.enum(['readonly', 'readwrite']),
  isDefault: z.boolean(),
  note: trimmed(2000),
  password: secretChange,
});
export type DatabaseInput = z.input<typeof databaseInputSchema>;

export const serverInputSchema = z
  .object({
    env: required(32),
    label: trimmed(100),
    aliases,
    host: required(255),
    port,
    username: required(255),
    authType: z.enum(['password', 'key']),
    privateKeyPath: optionalPath,
    defaultRoot: z.boolean(),
    sudoPolicy: z.enum(['none', 'same-as-login', 'separate']),
    appRoot: optionalPath,
    logsPath: optionalPath,
    note: trimmed(2000),
    password: secretChange,
    passphrase: secretChange,
    sudoPassword: secretChange,
  })
  .refine((s) => s.authType !== 'key' || Boolean(s.privateKeyPath), {
    message: '密钥认证需要填写私钥路径',
    path: ['privateKeyPath'],
  });
export type ServerInput = z.input<typeof serverInputSchema>;

const FIELD_LABELS: Record<string, string> = {
  name: '项目名称',
  aliases: '别名',
  description: '说明',
  rulesPath: '规则文件',
  label: '名称',
  path: '路径',
  env: '环境',
  vendor: '数据库类型',
  host: '主机',
  port: '端口',
  database: '库名',
  schema: 'Schema',
  username: '用户名',
  accessLevel: '权限',
  note: '备注',
  authType: '认证方式',
  privateKeyPath: '私钥文件',
  sudoPolicy: 'sudo',
  appRoot: '应用目录',
  logsPath: '日志目录',
  password: '密码',
  passphrase: '私钥口令',
  sudoPassword: 'sudo 密码',
};

export interface InputIssue {
  code: string;
  path: PropertyKey[];
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
}

/** One zod issue as a Chinese sentence naming the form field, e.g. "端口必须是 1–65535 的整数". */
export function describeIssue(issue: InputIssue, labels: Record<string, string> = FIELD_LABELS): string {
  const key = issue.path.find((p) => typeof p === 'string');
  const field = (key && (labels[key] ?? FIELD_LABELS[key])) ?? (issue.path.join('.') || '输入');
  if (key === 'port') return `${field}必须是 1–65535 的整数`;
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string' && Number(issue.minimum) === 1 ? `${field}不能为空` : `${field}过小或过短`;
    case 'too_big':
      return issue.origin === 'string' ? `${field}不能超过 ${issue.maximum} 个字符` : `${field}过大或过长`;
    case 'invalid_type':
    case 'invalid_value':
      return `${field}取值无效`;
    default:
      // Our own refine() messages are already Chinese.
      return /[一-鿿]/.test(issue.message) ? `${field}：${issue.message}` : `${field}无效`;
  }
}

// ---- views returned to the renderer (never contain secrets) ----

export interface ProjectSummary {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  rulesPath: string | null;
  configVersion: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface DirStatus {
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  /** Marker only; SmartDD never runs svn/git. */
  vcs: 'svn' | 'git' | null;
  /** Usable as a session working directory. */
  available: boolean;
}

export interface ProjectDirView {
  id: string;
  projectId: string;
  label: string;
  path: string;
  isDefault: boolean;
  status: DirStatus;
}

export interface LastTest {
  at: number;
  ok: boolean;
  category: TestCategory;
  message: string;
  ms: number;
}

export interface DatabaseView {
  id: string;
  projectId: string;
  env: string;
  label: string;
  aliases: string[];
  vendor: DbVendor;
  host: string;
  port: number;
  database: string;
  schema: string | null;
  username: string;
  accessLevel: 'readonly' | 'readwrite';
  isDefault: boolean;
  note: string;
  hasPassword: boolean;
  lastTest: LastTest | null;
}

export interface ServerView {
  id: string;
  projectId: string;
  env: string;
  label: string;
  aliases: string[];
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  privateKeyPath: string | null;
  defaultRoot: boolean;
  sudoPolicy: 'none' | 'same-as-login' | 'separate';
  appRoot: string | null;
  logsPath: string | null;
  note: string;
  hasPassword: boolean;
  hasPassphrase: boolean;
  hasSudoPassword: boolean;
  lastTest: LastTest | null;
}

export interface ProjectDetail extends ProjectSummary {
  dirs: ProjectDirView[];
  databases: DatabaseView[];
  servers: ServerView[];
}

// ---- connection tests ----

/**
 * network: refused / unreachable / DNS; auth: wrong user or password; database: database or
 * schema missing; timeout: no answer in time; unsupported_auth: server wants an auth method the
 * driver cannot do; config: our side is incomplete (e.g. key file unreadable); other: the rest.
 */
export const TEST_CATEGORIES = ['ok', 'network', 'auth', 'database', 'timeout', 'unsupported_auth', 'config', 'other'] as const;
export type TestCategory = (typeof TEST_CATEGORIES)[number];

export interface ConnectionTestResult {
  ok: boolean;
  category: TestCategory;
  /** Driver message, redacted. */
  message: string;
  ms: number;
  /** Extra facts on success, e.g. server version or host key fingerprint. */
  detail?: string;
}

export function isProdEnv(env: string): boolean {
  return /^(prod|production|生产)$/i.test(env.trim());
}

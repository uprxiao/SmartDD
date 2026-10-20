import { z } from 'zod';

export const APP_HOST_API = 1;
export const APP_DATA_API = 1;
export const PACKAGE_OWNER_FILE = '.willyou-package-owner.json';
export const APP_HASH_PATTERN = /^[a-f0-9]{64}$/;
export const APP_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Reject ambiguous paths before either the builder or runtime touches the filesystem. */
export function isPackagePath(value: string): boolean {
  if (!value || value !== value.normalize('NFC') || value.length > 1024 || /[\\:\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
const nativePart = (max: number) => z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(max);
const path = z.string().refine(isPackagePath, '应用包路径无效');
const hash = z.string().regex(APP_HASH_PATTERN);
const operation = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const api = z.number().int().positive();
export const applicationManifestSchema = z.object({
  schema: z.literal('smartdd-app-package-v1'),
  appId: nativePart(20),
  version: z.string().regex(version),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().max(4000),
  hostApi: z.object({ min: api, max: api }).strict(),
  dataApi: api,
  connectionContracts: z.array(z.object({
    providerId: z.string().regex(APP_ID_PATTERN), configApiMajor: api, inputSchemaPath: path,
    authModes: z.array(z.string().min(1).max(80)).min(1), identityContractMajor: api,
  }).strict()).min(1),
  runtime: z.object({ id: z.string().regex(APP_ID_PATTERN), hash, protocolMajor: api }).strict(),
  skills: z.array(z.object({ id: nativePart(16), path, entry: path, description: z.string().max(2000) }).strict()).min(1),
  tools: z.array(z.object({
    name: z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9]\d*$/).max(128), contractMajor: api,
    inputSchemaPath: path, outputSchemaPath: path, permission: operation,
    annotations: z.object({ readOnlyHint: z.boolean(), destructiveHint: z.boolean(), idempotentHint: z.boolean(), openWorldHint: z.boolean() }).strict(),
  }).strict()).min(1),
  adapter: z.object({ entry: path, format: z.literal('cjs') }).strict(),
  migrations: z.array(z.object({ id: z.string().regex(APP_ID_PATTERN), from: z.number().int().nonnegative(), to: api, file: path, checksum: hash }).strict()),
  files: z.array(z.object({ path, sha256: hash, size: z.number().int().nonnegative(), executable: z.boolean() }).strict()).min(1).max(4096),
  permissions: z.array(operation).min(1),
}).strict().superRefine((manifest, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (manifest.hostApi.min > manifest.hostApi.max) issue('宿主API范围无效');
  const paths = new Set<string>(), folded = new Set<string>();
  for (const f of manifest.files) {
    if (['manifest.json', PACKAGE_OWNER_FILE].includes(f.path.split('/')[0].toLowerCase()) || paths.has(f.path) || folded.has(f.path.toLowerCase())) issue('包路径重复、大小写冲突或使用保留名称');
    paths.add(f.path); folded.add(f.path.toLowerCase());
  }
  const required = [manifest.adapter.entry, ...manifest.connectionContracts.map(c => c.inputSchemaPath), ...manifest.tools.flatMap(t => [t.inputSchemaPath, t.outputSchemaPath]), ...manifest.skills.map(s => s.entry), ...manifest.migrations.map(m => m.file)];
  if (required.some(p => !paths.has(p))) issue('包入口或契约未列入完整文件清单');
  for (const f of paths) for (const other of paths) if (other !== f && other.startsWith(f + '/')) issue('文件与目录路径冲突');
  if (new Set(manifest.skills.map(s => s.id)).size !== manifest.skills.length) issue('Skill标识重复');
  if (manifest.skills.some(s => !s.entry.startsWith(s.path + '/') || !s.entry.endsWith('/SKILL.md'))) issue('Skill入口必须是本Skill目录内的SKILL.md');
  if (new Set(manifest.tools.map(t => t.name)).size !== manifest.tools.length) issue('工具名重复');
  if (new Set(manifest.permissions).size !== manifest.permissions.length) issue('动作权限重复');
  const prefix = 'smartdd_' + manifest.appId.replaceAll('-', '_') + '_';
  for (const t of manifest.tools) {
    if (!t.name.startsWith(prefix) || !t.name.endsWith('_v' + t.contractMajor)) issue('工具名称与应用及主契约不一致');
    if (!manifest.permissions.includes(t.permission)) issue('工具权限未在包声明中提供');
    if (t.permission.endsWith('.send') && (t.annotations.readOnlyHint || t.annotations.idempotentHint)) issue('发送工具不得声明为只读或幂等');
  }
  const migrations = new Set<string>();
  for (let i = 0; i < manifest.migrations.length; i++) {
    const m = manifest.migrations[i];
    if (migrations.has(m.id) || m.to !== m.from + 1 || (i && m.from !== manifest.migrations[i - 1].to)) issue('应用迁移编号或版本不连续');
    migrations.add(m.id);
    if (manifest.files.find(f => f.path === m.file)?.sha256 !== m.checksum) issue('迁移checksum与文件清单不一致');
  }
});
export type ApplicationManifest = z.infer<typeof applicationManifestSchema>;
export type ApplicationErrorCode = 'INVALID_PACKAGE' | 'HASH_MISMATCH' | 'VERSION_CONFLICT' | 'OWNERSHIP_CONFLICT' | 'HOST_INCOMPATIBLE' | 'RESOURCE_BUSY' | 'RESOURCE_RECOVERY_REQUIRED' | 'RESOURCE_STATE_CHANGED' | 'CANCELED' | 'NOT_FOUND' | 'INVALID_INPUT' | 'AUTH_REQUIRED' | 'AUTH_FAILED' | 'IDENTITY_CHANGE_REQUIRES_SELECTION' | 'CONFIG_PLAN_STALE' | 'CONFIG_INCOMPATIBLE' | 'CONFIG_COMPATIBILITY_UNVERIFIED' | 'REVISION_CONFLICT' | 'CONNECTION_UNAVAILABLE' | 'RUN_STOP_FAILED' | 'SCOPE_DENIED' | 'TIMEOUT' | 'TRANSIENT_FAILURE' | 'INVALID_RESPONSE' | 'INCOMPLETE_RESULT' | 'SOURCE_UNAVAILABLE' | 'UNSUPPORTED_FORMAT';
export class ApplicationError extends Error {
  constructor(public readonly code: ApplicationErrorCode, message: string) { super(message); this.name = 'ApplicationError'; }
}
export interface InstalledApplicationPackage {
  packageHash: string; appId: string; version: string; resourceId: string;
  relativePath: string; manifest: ApplicationManifest; installedAt: string;
  state: 'staged' | 'verified' | 'ready' | 'deleting' | 'removed' | 'recovery-required';
}

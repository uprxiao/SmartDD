import { z } from 'zod';
import { ApplicationError, applicationManifestSchema, PACKAGE_OWNER_FILE, type ApplicationManifestV1 } from './applications';

const api = z.number().int().positive();
const name = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const capabilityId = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/).max(192);
const fields = applicationManifestSchema.shape;
const toolName = fields.tools.element.shape.name;
export const capabilityProtectionSchema = z.object({
  kind: z.enum(['business-intent', 'revision', 'upstream-key', 'operation-receipt']),
  object: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
  key: z.string().regex(/^[a-z][A-Za-z0-9_]{0,127}$/),
}).strict();
const mcp = z.object({ tool: toolName }).strict();
const cli = z.object({ command: z.array(name).min(2).max(8) }).strict();
const fallback = z.union([z.object({ mcp }).strict(), z.object({ cli }).strict()]);
export const applicationCapabilitySchema = z.object({
  id: capabilityId, contractMajor: api, title: z.string().trim().min(1).max(120),
  semantics: z.enum(['read', 'write', 'external-write']),
  permission: fields.permissions.element,
  slots: z.object({ required: z.array(name).max(32), conditional: z.array(name).max(32) }).strict(),
  inputSchemaPath: fields.tools.element.shape.inputSchemaPath,
  outputSchemaPath: fields.tools.element.shape.outputSchemaPath,
  retry: z.enum(['safe-read', 'never']),
  protection: capabilityProtectionSchema.optional(),
  approval: z.literal('host-observed-user-authorization').optional(),
  legacyTool: z.object({ name: toolName, contractMajor: api }).strict().optional(),
  binding: z.object({ mcp: mcp.optional(), cli: cli.optional(), fallback: fallback.optional() }).strict(),
}).strict();
export type ApplicationCapability = z.infer<typeof applicationCapabilitySchema>;
export type ApplicationEntry = 'mcp' | 'cli';

/** Data-only packages. Trusted executors and provider definitions live in the host. */
export const applicationManifestV2Schema = z.object({
  schema: z.literal('smartdd-app-package-v2'),
  appId: fields.appId, version: fields.version, displayName: fields.displayName, description: fields.description,
  hostApi: fields.hostApi, dataApi: fields.dataApi, runtime: fields.runtime,
  connectionContracts: fields.connectionContracts,
  module: z.object({ id: name, contractMajor: api }).strict(),
  entry: z.enum(['mcp', 'cli']), mixedEntries: z.literal(true).optional(),
  connectionSlots: z.array(z.object({ slot: name, required: z.boolean() }).strict()).max(32),
  capabilities: z.array(applicationCapabilitySchema).min(1).max(256),
  skills: z.array(fields.skills.element.extend({ template: z.boolean() })).min(1),
  permissions: fields.permissions, migrations: fields.migrations, files: fields.files,
}).strict().superRefine((manifest, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  // Keep the old parser byte-for-byte in the retained v1 bridge. This version's
  // tree checks operate on the new raw declaration, without normalizing its identity.
  if (manifest.hostApi.min > manifest.hostApi.max) issue('宿主API范围无效');
  const paths = new Set<string>(), folded = new Set<string>();
  for (const f of manifest.files) {
    if (['manifest.json', PACKAGE_OWNER_FILE].includes(f.path.split('/')[0].toLowerCase()) || paths.has(f.path) || folded.has(f.path.toLowerCase())) issue('包路径重复、大小写冲突或使用保留名称');
    paths.add(f.path); folded.add(f.path.toLowerCase());
  }
  const required = [
    ...manifest.connectionContracts.map(c => c.inputSchemaPath),
    ...manifest.capabilities.flatMap(c => [c.inputSchemaPath, c.outputSchemaPath]),
    ...manifest.skills.map(s => s.entry), ...manifest.migrations.map(m => m.file),
  ];
  if (required.some(p => !paths.has(p))) issue('包入口或契约未列入完整文件清单');
  for (const f of paths) for (const other of paths) if (other !== f && other.startsWith(f + '/')) issue('文件与目录路径冲突');
  if (new Set(manifest.skills.map(s => s.id)).size !== manifest.skills.length) issue('Skill标识重复');
  if (manifest.skills.some(s => !s.entry.startsWith(s.path + '/') || !s.entry.endsWith('/SKILL.md'))) issue('Skill入口必须是本Skill目录内的SKILL.md');
  if (new Set(manifest.permissions).size !== manifest.permissions.length) issue('动作权限重复');
  if (manifest.permissions.some(p => !p.startsWith(manifest.appId + '.'))) issue('动作权限必须属于本应用');
  if (new Set(manifest.connectionContracts.map(c => c.providerId)).size !== manifest.connectionContracts.length) issue('连接配置契约重复');
  const migrations = new Set<string>();
  for (let i = 0; i < manifest.migrations.length; i++) {
    const m = manifest.migrations[i];
    if (migrations.has(m.id) || m.to !== m.from + 1 || (i && m.from !== manifest.migrations[i - 1].to)) issue('应用迁移编号或版本不连续');
    migrations.add(m.id);
    if (manifest.files.find(f => f.path === m.file)?.sha256 !== m.checksum) issue('迁移checksum与文件清单不一致');
  }
  const slots = new Set(manifest.connectionSlots.map(s => s.slot));
  if (slots.size !== manifest.connectionSlots.length) issue('连接槽重复');
  if (manifest.connectionSlots.some(s => !manifest.connectionContracts.some(c => c.providerId === s.slot))) issue('连接槽没有配置契约');
  if (new Set(manifest.capabilities.map(c => c.id)).size !== manifest.capabilities.length) issue('能力标识重复');
  const names = new Set<string>(), commands = new Set<string>(), legacy = new Set<string>();
  for (const c of manifest.capabilities) {
    if (!c.id.startsWith(manifest.appId + '.')) issue('能力标识前缀与应用不符');
    if (!manifest.permissions.includes(c.permission)) issue('能力权限未在包声明中提供');
    const primary = c.binding.mcp ? 'mcp' : c.binding.cli ? 'cli' : null;
    if (!primary || !!c.binding.mcp === !!c.binding.cli) issue('能力必须恰好声明一个主入口');
    if (primary && primary !== manifest.entry && !manifest.mixedEntries) issue('能力主入口与应用入口不同');
    if (c.semantics !== 'read' && (!c.protection || c.retry !== 'never')) issue('写能力必须声明业务级保护且不得自动重试');
    if (c.semantics === 'external-write' && !c.approval) issue('外部写能力必须声明宿主观察授权');
    if (c.binding.fallback && (c.semantics !== 'read' || primary && Object.hasOwn(c.binding.fallback, primary))) issue('降级入口仅用于只读且必须不同于主入口');
    const required = new Set(c.slots.required), conditional = new Set(c.slots.conditional);
    if (required.size !== c.slots.required.length || conditional.size !== c.slots.conditional.length || [...required].some(s => conditional.has(s))) issue('能力槽依赖重复');
    if ([...required, ...conditional].some(s => !slots.has(s))) issue('能力引用了未声明的连接槽');
    for (const binding of [c.binding, c.binding.fallback]) {
      if (!binding) continue;
      if ('mcp' in binding && binding.mcp) {
        const tool = binding.mcp.tool;
        if (!tool.startsWith('smartdd_' + manifest.appId.replaceAll('-', '_') + '_') || !tool.endsWith('_v' + c.contractMajor)) issue('MCP工具名称与应用或能力契约不符');
        if (names.has(tool)) issue('MCP工具名重复');
        names.add(tool);
      }
      if ('cli' in binding && binding.cli) {
        if (binding.cli.command[0] !== manifest.appId) issue('CLI命令必须以应用标识开头');
        const key = binding.cli.command.join(' ');
        if (commands.has(key)) issue('CLI命令重复');
        commands.add(key);
      }
    }
    if (c.legacyTool) {
      const t = c.legacyTool;
      if (!t.name.startsWith('smartdd_' + manifest.appId.replaceAll('-', '_') + '_') || !t.name.endsWith('_v' + t.contractMajor) || legacy.has(t.name)) issue('旧工具映射重复或契约不符');
      legacy.add(t.name);
    }
  }
  if (manifest.files.some(f => f.executable || /\.(?:[cm]?js|node|wasm|py|sh|exe|dll|dylib)$/i.test(f.path))) issue('v2应用包不得携带执行代码');
});
export type ApplicationManifestV2 = z.infer<typeof applicationManifestV2Schema>;
export type ApplicationPackageManifest = ApplicationManifestV1 | ApplicationManifestV2;
export const applicationPackageManifestSchema = z.discriminatedUnion('schema', [applicationManifestSchema, applicationManifestV2Schema]);

export interface LegacyCapabilityPolicy {
  id: string; semantics: ApplicationCapability['semantics']; retry: ApplicationCapability['retry'];
  slots: ApplicationCapability['slots']; protection?: ApplicationCapability['protection']; approval?: ApplicationCapability['approval'];
}
export type LegacyCapabilityResolver = (tool: ApplicationManifestV1['tools'][number]) => LegacyCapabilityPolicy;
/** No mutation of the retained v1 manifest or result contract. A trusted module supplies business semantics. */
export function applicationCapabilityViews(manifest: ApplicationPackageManifest, legacyPolicy?: LegacyCapabilityResolver): ApplicationCapability[] {
  if (manifest.schema === 'smartdd-app-package-v2') return structuredClone(manifest.capabilities);
  if (!legacyPolicy) throw new ApplicationError('HOST_INCOMPATIBLE', '旧包能力视图需要受信模块的业务策略');
  return manifest.tools.map(tool => {
    const policy = legacyPolicy(tool);
    if (!policy.id.startsWith(manifest.appId + '.') || (policy.semantics === 'read') !== tool.annotations.readOnlyHint || policy.semantics !== 'read' && (!policy.protection || policy.retry !== 'never') || policy.semantics === 'external-write' && !policy.approval) throw new ApplicationError('HOST_INCOMPATIBLE', '旧包业务策略与固定契约不符');
    return applicationCapabilitySchema.parse({ ...policy, title: tool.name, contractMajor: tool.contractMajor,
      permission: tool.permission, inputSchemaPath: tool.inputSchemaPath, outputSchemaPath: tool.outputSchemaPath,
      legacyTool: { name: tool.name, contractMajor: tool.contractMajor }, binding: { mcp: { tool: tool.name } },
    });
  });
}

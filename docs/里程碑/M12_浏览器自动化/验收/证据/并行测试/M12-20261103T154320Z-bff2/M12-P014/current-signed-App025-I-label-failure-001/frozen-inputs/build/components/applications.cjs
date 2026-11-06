"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicationError = exports.applicationManifestSchema = exports.APP_ID_PATTERN = exports.APP_HASH_PATTERN = exports.PACKAGE_OWNER_FILE = exports.APP_DATA_API = exports.APP_HOST_API = void 0;
exports.isPackagePath = isPackagePath;
const zod_1 = globalThis.__m12T017Deps.zod;
exports.APP_HOST_API = 1;
exports.APP_DATA_API = 1;
exports.PACKAGE_OWNER_FILE = '.willyou-package-owner.json';
exports.APP_HASH_PATTERN = /^[a-f0-9]{64}$/;
exports.APP_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** Reject ambiguous paths before either the builder or runtime touches the filesystem. */
function isPackagePath(value) {
    if (!value || value !== value.normalize('NFC') || value.length > 1024 || /[\\:\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value))
        return false;
    return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'
        && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
const nativePart = (max) => zod_1.z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(max);
const path = zod_1.z.string().refine(isPackagePath, '应用包路径无效');
const hash = zod_1.z.string().regex(exports.APP_HASH_PATTERN);
const operation = zod_1.z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const api = zod_1.z.number().int().positive();
exports.applicationManifestSchema = zod_1.z.object({
    schema: zod_1.z.literal('smartdd-app-package-v1'),
    appId: nativePart(20),
    version: zod_1.z.string().regex(version),
    displayName: zod_1.z.string().trim().min(1).max(120),
    description: zod_1.z.string().max(4000),
    hostApi: zod_1.z.object({ min: api, max: api }).strict(),
    dataApi: api,
    connectionContracts: zod_1.z.array(zod_1.z.object({
        providerId: zod_1.z.string().regex(exports.APP_ID_PATTERN), configApiMajor: api, inputSchemaPath: path,
        authModes: zod_1.z.array(zod_1.z.string().min(1).max(80)).min(1), identityContractMajor: api,
    }).strict()).min(1),
    runtime: zod_1.z.object({ id: zod_1.z.string().regex(exports.APP_ID_PATTERN), hash, protocolMajor: api }).strict(),
    skills: zod_1.z.array(zod_1.z.object({ id: nativePart(16), path, entry: path, description: zod_1.z.string().max(2000) }).strict()).min(1),
    tools: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9]\d*$/).max(128), contractMajor: api,
        inputSchemaPath: path, outputSchemaPath: path, permission: operation,
        annotations: zod_1.z.object({ readOnlyHint: zod_1.z.boolean(), destructiveHint: zod_1.z.boolean(), idempotentHint: zod_1.z.boolean(), openWorldHint: zod_1.z.boolean() }).strict(),
    }).strict()).min(1),
    adapter: zod_1.z.object({ entry: path, format: zod_1.z.literal('cjs') }).strict(),
    migrations: zod_1.z.array(zod_1.z.object({ id: zod_1.z.string().regex(exports.APP_ID_PATTERN), from: zod_1.z.number().int().nonnegative(), to: api, file: path, checksum: hash }).strict()),
    files: zod_1.z.array(zod_1.z.object({ path, sha256: hash, size: zod_1.z.number().int().nonnegative(), executable: zod_1.z.boolean() }).strict()).min(1).max(4096),
    permissions: zod_1.z.array(operation).min(1),
}).strict().superRefine((manifest, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', message });
    if (manifest.hostApi.min > manifest.hostApi.max)
        issue('宿主API范围无效');
    const paths = new Set(), folded = new Set();
    for (const f of manifest.files) {
        if (['manifest.json', exports.PACKAGE_OWNER_FILE].includes(f.path.split('/')[0].toLowerCase()) || paths.has(f.path) || folded.has(f.path.toLowerCase()))
            issue('包路径重复、大小写冲突或使用保留名称');
        paths.add(f.path);
        folded.add(f.path.toLowerCase());
    }
    const required = [manifest.adapter.entry, ...manifest.connectionContracts.map(c => c.inputSchemaPath), ...manifest.tools.flatMap(t => [t.inputSchemaPath, t.outputSchemaPath]), ...manifest.skills.map(s => s.entry), ...manifest.migrations.map(m => m.file)];
    if (required.some(p => !paths.has(p)))
        issue('包入口或契约未列入完整文件清单');
    for (const f of paths)
        for (const other of paths)
            if (other !== f && other.startsWith(f + '/'))
                issue('文件与目录路径冲突');
    if (new Set(manifest.skills.map(s => s.id)).size !== manifest.skills.length)
        issue('Skill标识重复');
    if (manifest.skills.some(s => !s.entry.startsWith(s.path + '/') || !s.entry.endsWith('/SKILL.md')))
        issue('Skill入口必须是本Skill目录内的SKILL.md');
    if (new Set(manifest.tools.map(t => t.name)).size !== manifest.tools.length)
        issue('工具名重复');
    if (new Set(manifest.permissions).size !== manifest.permissions.length)
        issue('动作权限重复');
    const prefix = 'smartdd_' + manifest.appId.replaceAll('-', '_') + '_';
    for (const t of manifest.tools) {
        if (!t.name.startsWith(prefix) || !t.name.endsWith('_v' + t.contractMajor))
            issue('工具名称与应用及主契约不一致');
        if (!manifest.permissions.includes(t.permission))
            issue('工具权限未在包声明中提供');
        if (t.permission.endsWith('.send') && (t.annotations.readOnlyHint || t.annotations.idempotentHint))
            issue('发送工具不得声明为只读或幂等');
    }
    const migrations = new Set();
    for (let i = 0; i < manifest.migrations.length; i++) {
        const m = manifest.migrations[i];
        if (migrations.has(m.id) || m.to !== m.from + 1 || (i && m.from !== manifest.migrations[i - 1].to))
            issue('应用迁移编号或版本不连续');
        migrations.add(m.id);
        if (manifest.files.find(f => f.path === m.file)?.sha256 !== m.checksum)
            issue('迁移checksum与文件清单不一致');
    }
});
class ApplicationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ApplicationError';
    }
}
exports.ApplicationError = ApplicationError;

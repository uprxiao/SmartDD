import {constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {Ajv, addFormats} from '@modelcontextprotocol/server/validators/ajv';
import {ApplicationError, isPackagePath} from '@shared/applications';
import {PLUGIN_HOST_API, PLUGIN_LIMITS, PLUGIN_MANIFEST_PATH, pluginManifestSchema, type PluginManifest} from '@shared/plugins';
import {canonicalJson, digest} from '../manifest';
import {validatePluginUi} from './ui-validation';

export type JsonSchema = Record<string, unknown>;
export type PluginValidation = (value: unknown) => {valid: boolean};
export interface ValidatedPlugin {
  manifest: PluginManifest;
  files: ReadonlyMap<string, Buffer>;
  hash: string;
  schemas: ReadonlyMap<string, JsonSchema>;
  contracts: ReadonlyMap<string, {input: PluginValidation; output: PluginValidation}>;
  legacyContracts: ReadonlyMap<string, {input: PluginValidation; output: PluginValidation}>;
  providers: ReadonlyMap<string, PluginValidation>;
  skills: readonly {id: string; path: string; entry: string}[];
  executables: ReadonlySet<string>;
}
const reserved = new Set(['mail', 'browser', 'sample-kv']);
const reject = (message: string): never => {throw new ApplicationError('INVALID_PACKAGE', message);};
export function parsePluginJson(bytes: Buffer, path: string, maxBytes = PLUGIN_LIMITS.schemaBytes): JsonSchema {
  if (bytes.length > maxBytes) reject(`插件声明超过大小限制：${path}`);
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return reject(`插件声明不是 JSON 对象：${path}`);
    const visit = (item: unknown, depth: number): void => {
      if (depth > PLUGIN_LIMITS.depth) reject(`插件声明嵌套过深：${path}`);
      if (item && typeof item === 'object') for (const child of Object.values(item)) visit(child, depth + 1);
    };
    visit(value, 0); return value as JsonSchema;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    return reject(`插件声明不是有效 UTF-8 JSON：${path}`);
  }
}
function binary(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const magic = bytes.readUInt32BE(0);
  return [0x7f454c46, 0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)
    || bytes[0] === 0x4d && bytes[1] === 0x5a;
}
function fileSet(input: ReadonlyMap<string, Buffer>): Map<string, Buffer> {
  if (!input.size || input.size > PLUGIN_LIMITS.files) reject('插件包结构不完整或文件数量超限');
  const folded = new Set<string>(), names = new Map<string, string>(), files = new Map<string, Buffer>(); let total = 0;
  for (const [path, bytes] of input) {
    if (!isPackagePath(path) || path.split('/').length > PLUGIN_LIMITS.depth) reject(`插件包路径无效：${path}`);
    const parts = path.toLowerCase().split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), original = path.split('/').slice(0, i).join('/');
      if (i < parts.length && folded.has('file:' + prefix) || i === parts.length && folded.has('dir:' + prefix)) reject(`插件包文件与目录冲突：${path}`);
      if (names.has(prefix) && names.get(prefix) !== original) reject(`插件包路径大小写冲突：${path}`);
      if (i === parts.length && folded.has('file:' + prefix)) reject(`插件包路径大小写冲突：${path}`);
      names.set(prefix, original);
      folded.add((i === parts.length ? 'file:' : 'dir:') + prefix);
    }
    if (!Buffer.isBuffer(bytes) || bytes.length > PLUGIN_LIMITS.fileBytes || (total += bytes.length) > PLUGIN_LIMITS.packageBytes) reject('插件包大小超过限制');
    if (/\.(node|dylib|so|dll|exe)$/i.test(path) || binary(bytes)) reject(`包含原生模块 ${path}，首期不支持`);
    files.set(path, Buffer.from(bytes));
  }
  return files;
}

/** Pure inspection: no process, credential access, network, install record or private data directory. */
export function validatePluginBundle(input: ReadonlyMap<string, Buffer>, reservedIds: ReadonlySet<string> = reserved, executablePaths: ReadonlySet<string> = new Set()): ValidatedPlugin {
  const files = fileSet(input), raw = files.get(PLUGIN_MANIFEST_PATH);
  const executables = new Set(executablePaths);
  if ([...executables].some(path => !files.has(path))) reject('可执行文件不在插件完整清单中');
  if (!raw) return reject('插件包结构不完整：缺少 ' + PLUGIN_MANIFEST_PATH);
  const parsed = pluginManifestSchema.safeParse(parsePluginJson(raw, PLUGIN_MANIFEST_PATH, PLUGIN_LIMITS.manifestBytes));
  if (!parsed.success) return reject('插件声明无效：' + parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; ').slice(0, 2000));
  const manifest = parsed.data;
  if (reservedIds.has(manifest.id)) reject('与内置应用同名，不能覆盖');
  if (manifest.hostApi !== PLUGIN_HOST_API) throw new ApplicationError('HOST_INCOMPATIBLE', `需要插件接口 ${manifest.hostApi}，当前为 ${PLUGIN_HOST_API}，请先升级 WillYou`);
  if (!/\.(mjs|cjs|js)$/.test(manifest.runtime.entry)) reject('插件运行入口必须是 JavaScript 文件');
  const requireFile = (path: string): Buffer => files.get(path) ?? reject(`插件包结构不完整：缺少 ${path}`);
  requireFile(manifest.runtime.entry);
  if (manifest.icon) { requireFile(manifest.icon.light); requireFile(manifest.icon.dark); }
  if (new Set(manifest.permissions).size !== manifest.permissions.length) reject('插件权限重复');
  const providerIds = new Set(manifest.providers.map(p => p.id));
  if (providerIds.size !== manifest.providers.length) reject('插件连接声明重复');
  const count = Object.keys(manifest.capabilities).length;
  if (count < 1 || count > 256) reject('插件能力数量必须为 1–256');

  // A fresh compiler belongs to this one package; identical $ids in another plugin cannot reuse its contract.
  const ajv = new Ajv({strict: false, allErrors: false, ownProperties: true, validateSchema: true, inlineRefs: false});
  addFormats(ajv);
  const schemas = new Map<string, JsonSchema>();
  const loadSchema = (path: string): JsonSchema => {
    let schema = schemas.get(path);
    if (!schema) { schema = parsePluginJson(requireFile(path), path); schemas.set(path, schema); }
    return schema;
  };
  const compile = (schema: JsonSchema, name: string): PluginValidation => {
    try {
      if (schema.$async) return reject(`不支持异步 Schema：${name}`);
      const check = ajv.compile(schema);
      return value => ({valid: check(value) === true});
    } catch { return reject(`插件 Schema 无效或引用未声明：${name}`); }
  };
  const ids = new Set<string>();
  for (const path of manifest.schemas) {
    const schema = loadSchema(path);
    const schemaId = schema.$id;
    if (typeof schemaId !== 'string' || ids.has(schemaId)) return reject(`共享 Schema 缺少或重复 $id：${path}`);
    ids.add(schemaId);
    try { ajv.addSchema(schema); } catch { reject(`共享 Schema 无效：${path}`); }
  }
  for (const path of manifest.schemas) compile(loadSchema(path), path);
  const providers = new Map<string, PluginValidation>();
  for (const provider of manifest.providers) {
    const properties=provider.config.properties;
    if(properties&&typeof properties==='object'&&!Array.isArray(properties)&&['kind','authMode'].some(key=>Object.hasOwn(properties,key)))reject('插件连接字段 kind／authMode 为宿主保留字段');
    providers.set(provider.id, compile(provider.config, provider.id));
  }
  const contracts = new Map<string, {input: PluginValidation; output: PluginValidation}>();
  for (const [id, cap] of Object.entries(manifest.capabilities)) {
    if (!id.startsWith(manifest.id + '.') || !cap.permission.startsWith(manifest.id + '.')) reject(`能力或权限不属于本插件：${id}`);
    if (cap.semantics !== 'read' && cap.retry !== 'never') reject(`写能力不能自动重试：${id}`);
    if (new Set(cap.slots).size !== cap.slots.length || cap.slots.some(slot => !providerIds.has(slot))) reject(`能力引用未知或重复连接：${id}`);
    contracts.set(id, {input: compile(loadSchema(cap.input), cap.input), output: compile(loadSchema(cap.output), cap.output)});
  }
  for (const [name, id] of Object.entries(manifest.legacyToolNames)) if (!contracts.has(id)) reject(`旧工具名 ${name} 引用了不存在的能力`);
  const legacyContracts = new Map<string, {input: PluginValidation; output: PluginValidation}>();
  for(const [name,contract] of Object.entries(manifest.legacyToolContracts??{})){
    if(!Object.hasOwn(manifest.legacyToolNames,name))reject(`旧契约没有对应工具名：${name}`);
    if(manifest.capabilities[manifest.legacyToolNames[name]].semantics!=='read')reject(`旧版结果兼容只支持读取能力：${name}`);
    if(contract.dataFields&&new Set(contract.dataFields).size!==contract.dataFields.length)reject(`旧结果投影字段重复：${name}`);
    legacyContracts.set(name,{input:compile(loadSchema(contract.input),contract.input),output:compile(loadSchema(contract.output),contract.output)});
  }
  validatePluginUi(manifest, schemas);
  const roots = (typeof manifest.skills === 'string' ? [manifest.skills] : manifest.skills).map(path => path.replace(/\/$/, ''));
  const skills = [...files.keys()].filter(path => path.endsWith('/SKILL.md') && roots.some(root => path.startsWith(root + '/'))).map(entry => {
    const path = entry.slice(0, -'/SKILL.md'.length), id = path.split('/').at(-1)!;
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) reject(`Skill 标识无效：${entry}`);
    return {id, path, entry};
  });
  if (new Set(skills.map(s => s.id)).size !== skills.length) reject('插件 Skill 标识重复');
  for (const root of roots) if (!skills.some(skill => skill.path === root || skill.path.startsWith(root + '/'))) reject(`Skill 目录没有 SKILL.md：${root}`);
  const inventory = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({path, size: bytes.length, sha256: digest(bytes), executable: executables.has(path)}));
  return {manifest, files, hash: digest(canonicalJson(inventory)), schemas, contracts, legacyContracts, providers, skills, executables};
}

/** Inspect a selected directory without following links, devices or changing source files. */
export function inspectPluginDirectory(directory: string, reservedIds?: ReadonlySet<string>): ValidatedPlugin {
  const chosen = resolve(directory), rootStat = lstatSync(chosen);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) reject('插件来源必须是实际目录，不能是链接');
  const root = realpathSync(chosen), files = new Map<string, Buffer>(), executables = new Set<string>(); let total = 0, entries = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > PLUGIN_LIMITS.depth) reject('插件包目录嵌套过深');
    const before = lstatSync(dir);
    if (before.isSymbolicLink() || !before.isDirectory() || realpathSync(dir) !== dir) reject('插件来源包含链接');
    for (const name of readdirSync(dir).sort()) {
      if (++entries > PLUGIN_LIMITS.files * 2) reject('插件包目录项数量超限');
      const absolute = join(dir, name), stat = lstatSync(absolute), path = relative(root, absolute).split(sep).join('/');
      if (!isPackagePath(path)) reject(`插件包路径无效：${path}`);
      if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) reject('插件来源包含链接或特殊文件');
      if (stat.isDirectory()) { walk(absolute, depth + 1); continue; }
      if (files.size >= PLUGIN_LIMITS.files || stat.size > PLUGIN_LIMITS.fileBytes || (total += stat.size) > PLUGIN_LIMITS.packageBytes) reject('插件包大小或文件数量超限');
      const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || realpathSync(absolute) !== absolute || !absolute.startsWith(root + sep)) reject('读取时插件来源发生变化');
        // Do not let a growing source make readFileSync allocate beyond the inspected budget.
        const buffer = Buffer.alloc(stat.size + 1); let size = 0, read = 0;
        while (size < buffer.length && (read = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += read;
        const bytes = buffer.subarray(0, size), after = fstatSync(fd);
        if (bytes.length !== stat.size || after.mtimeMs !== opened.mtimeMs || after.size !== opened.size) reject('读取时插件来源发生变化');
        files.set(path, bytes);
        if (stat.mode & 0o111) executables.add(path);
      } finally { closeSync(fd); }
    }
    const after = lstatSync(dir);
    if (after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) reject('读取时插件来源发生变化');
  };
  walk(root, 0); return validatePluginBundle(files, reservedIds, executables);
}

import { createHash } from 'node:crypto';
import { boundedJson, BRIDGE_LIMITS } from '@shared/application-bridge';
import { APP_DATA_API, APP_HOST_API, ApplicationError, applicationManifestSchema, type ApplicationManifest } from '@shared/applications';
import { applicationPackageManifestSchema, type ApplicationPackageManifest } from '@shared/application-capabilities';

export const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
// UTF-16's default sort orders astral keys differently from Unicode code points.
export function compareCodePoints(a: string, b: string): number {
  const aa = Array.from(a, c => c.codePointAt(0)!), bb = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Array.from(value).some(v => v === undefined)) throw new ApplicationError('INVALID_PACKAGE', '数组含有非JSON值');
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort(compareCodePoints).map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  throw new ApplicationError('INVALID_PACKAGE', '规范化摘要只接受JSON值');
}
export function parseManifest(value: unknown): ApplicationManifest {
  const parsed = applicationManifestSchema.safeParse(value);
  if (!parsed.success) throw new ApplicationError('INVALID_PACKAGE', '应用包声明无效：' + parsed.error.issues.map(i => i.message).join('；'));
  const manifest = parsed.data;
  manifest.files.sort((a, b) => compareCodePoints(a.path, b.path));
  return manifest;
}
export function manifestHash(value: unknown): string { return digest(canonicalJson(parseManifest(value))); }
/** Only compiled module registrations may satisfy this lookup; package data is never authority. */
export interface ApplicationModuleCatalog { supportsModule(id: string, appId: string, contractMajor: number): boolean }
export function parsePackageManifest(value: unknown, modules: ApplicationModuleCatalog): ApplicationPackageManifest {
  const parsed = applicationPackageManifestSchema.safeParse(value);
  if (!parsed.success) throw new ApplicationError('INVALID_PACKAGE', '应用包声明无效：' + parsed.error.issues.map(i => i.message).join('；'));
  const manifest = parsed.data;
  if (manifest.schema === 'smartdd-app-package-v2' && !modules.supportsModule(manifest.module.id, manifest.appId, manifest.module.contractMajor)) throw new ApplicationError('HOST_INCOMPATIBLE', '应用包没有兼容的受信模块');
  manifest.files.sort((a, b) => compareCodePoints(a.path, b.path));
  return manifest;
}
export interface ApplicationBundle { manifest: unknown; files: Readonly<Record<string, Uint8Array>> }
export interface ValidatedBundle { manifest: ApplicationManifest; packageHash: string; files: Readonly<Record<string, Buffer>> }
export interface ValidatedPackageBundle { manifest: ApplicationPackageManifest; packageHash: string; files: Readonly<Record<string, Buffer>> }
function validateFiles(bundle: ApplicationBundle, manifest: ApplicationPackageManifest): ValidatedPackageBundle {
  const expected = new Set(manifest.files.map(f => f.path));
  if (Object.keys(bundle.files).length !== expected.size || Object.keys(bundle.files).some(p => !expected.has(p))) throw new ApplicationError('INVALID_PACKAGE', '应用包文件集合与清单不一致');
  const files = Object.create(null) as Record<string, Buffer>;
  let total = 0;
  for (const file of manifest.files) {
    const source = bundle.files[file.path];
    if (!(source instanceof Uint8Array)) throw new ApplicationError('INVALID_PACKAGE', '应用包缺少文件');
    const bytes = Buffer.from(source); total += bytes.length;
    if (bytes.length > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new ApplicationError('INVALID_PACKAGE', '应用包超过资源预算');
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new ApplicationError('HASH_MISMATCH', '应用包资源大小或摘要不一致');
    files[file.path] = bytes;
  }
  const contracts = manifest.schema === 'smartdd-app-package-v1' ? manifest.tools : manifest.capabilities;
  for (const path of new Set([...manifest.connectionContracts.map(c => c.inputSchemaPath), ...contracts.flatMap(t => [t.inputSchemaPath, t.outputSchemaPath])])) {
    try {
      if (files[path].length > BRIDGE_LIMITS.requestBytes || !Buffer.from(files[path].toString('utf8'),'utf8').equals(files[path])) throw new Error();
      const schema: unknown = JSON.parse(files[path].toString('utf8'));
      if (!boundedJson(schema)) throw new Error();
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error();
    } catch { throw new ApplicationError('INVALID_PACKAGE', '工具或连接JSON Schema无效'); }
  }
  return { manifest, packageHash: digest(canonicalJson(manifest)), files };
}
export function validateBundle(bundle: ApplicationBundle): ValidatedBundle {
  return validateFiles(bundle, parseManifest(bundle.manifest)) as ValidatedBundle;
}
export function validatePackageBundle(bundle: ApplicationBundle, modules: ApplicationModuleCatalog): ValidatedPackageBundle {
  return validateFiles(bundle, parsePackageManifest(bundle.manifest, modules));
}
export function assertHostCompatible(manifest: ApplicationManifest): void {
  if (manifest.hostApi.min > APP_HOST_API || manifest.hostApi.max < APP_HOST_API || manifest.dataApi !== APP_DATA_API) throw new ApplicationError('HOST_INCOMPATIBLE', '当前程序不支持此应用包契约');
}

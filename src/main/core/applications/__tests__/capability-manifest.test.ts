import { describe, expect, it } from 'vitest';
import { ApplicationError } from '@shared/applications';
import { applicationCapabilityViews, applicationManifestV2Schema, type ApplicationManifestV2 } from '@shared/application-capabilities';
import { canonicalJson, digest, parseManifest, parsePackageManifest, validatePackageBundle } from '../manifest';
import { fixtureBundle } from './fixtures';

const modules = { supportsModule: (id: string, appId: string, major: number) => id === 'zentao' && appId === 'zentao' && major === 1 };
function v2Bundle() {
  const { manifest: old, files: original } = fixtureBundle('1.1.0');
  const { adapter: _adapter, tools: _tools, schema: _schema, ...base } = old;
  const { 'adapter/index.cjs': _code, ...files } = original;
  const manifest: ApplicationManifestV2 = {
    ...base, schema: 'smartdd-app-package-v2', files: base.files.filter(f => f.path !== 'adapter/index.cjs'),
    module: { id: 'zentao', contractMajor: 1 }, entry: 'cli', connectionSlots: [{ slot: 'zentao', required: true }],
    skills: base.skills.map(s => ({ ...s, template: true })), capabilities: [{
      id: 'zentao.object.list', contractMajor: 2, title: '列出本人对象', semantics: 'read', retry: 'safe-read', permission: 'zentao.read',
      slots: { required: ['zentao'], conditional: [] }, inputSchemaPath: 'schemas/input.json', outputSchemaPath: 'schemas/output.json',
      legacyTool: { name: 'smartdd_zentao_query_v1', contractMajor: 1 },
      binding: { cli: { command: ['zentao', 'list'] }, fallback: { mcp: { tool: 'smartdd_zentao_object_list_v2' } } },
    }],
  };
  return { manifest, files };
}

describe('v2 capability manifests and retained v1 views', () => {
  it('accepts a data-only CLI capability with a read-only MCP fallback and verifies its complete tree', () => {
    const b = v2Bundle(), validated = validatePackageBundle(b, modules);
    expect(validated.manifest).toMatchObject({ schema: 'smartdd-app-package-v2', capabilities: b.manifest.capabilities });
    const reordered = v2Bundle(); reordered.manifest.files.reverse();
    expect(validated.packageHash).toBe(validatePackageBundle(reordered, modules).packageHash);
    const views = applicationCapabilityViews(validated.manifest);
    expect(views[0].binding).toEqual(b.manifest.capabilities[0].binding);
    views[0].binding.cli!.command.push('changed');
    expect(b.manifest.capabilities[0].binding.cli!.command).toEqual(['zentao', 'list']);
  });
  it('checks a trusted module identity and its supported contract before admitting v2', () => {
    const b = v2Bundle();
    for (const module of [{ id: 'unregistered', contractMajor: 1 }, { id: 'zentao', contractMajor: 2 }]) {
      expect(() => parsePackageManifest({ ...b.manifest, module }, modules)).toThrow(expect.objectContaining({ code: 'HOST_INCOMPATIBLE' }));
    }
    expect(() => parsePackageManifest(b.manifest, { supportsModule: () => false })).toThrow(ApplicationError);
    expect(() => parseManifest(b.manifest)).toThrow(ApplicationError); // Existing v1 callers remain closed until the module composition step.
  });
  it('preserves the exact v1 identity and calls no module lookup while parsing old resources', () => {
    const b = fixtureBundle(), bytes = canonicalJson(b.manifest), originalIdentity = digest(canonicalJson(parseManifest(b.manifest)));
    expect(digest(canonicalJson(parsePackageManifest(b.manifest, { supportsModule: () => { throw Error('must not call'); } })))).toBe(originalIdentity);
    expect(canonicalJson(b.manifest)).toBe(bytes);
  });
  it('projects a v1 tool through trusted business policy without renaming its tool or mutating bytes', () => {
    const b = fixtureBundle(), before = canonicalJson(b.manifest);
    const views = applicationCapabilityViews(b.manifest, () => ({ id: 'zentao.object.list', semantics: 'read', retry: 'safe-read', slots: { required: ['zentao'], conditional: [] } }));
    expect(views[0]).toMatchObject({ id: 'zentao.object.list', contractMajor: 1, legacyTool: { name: 'smartdd_zentao_query_v1', contractMajor: 1 }, binding: { mcp: { tool: 'smartdd_zentao_query_v1' } } });
    expect(canonicalJson(b.manifest)).toBe(before);
    expect(() => applicationCapabilityViews(b.manifest)).toThrow(/受信模块/);
    expect(() => applicationCapabilityViews(b.manifest, () => ({ id: 'zentao.object.list', semantics: 'write', retry: 'never', slots: { required: [], conditional: [] } }))).toThrow(/业务策略/);
  });
  it('accepts protected writes and requires explicit observed authorization for external writes', () => {
    const b = v2Bundle(), c = b.manifest.capabilities[0];
    b.manifest.entry = 'mcp';
    c.binding = { mcp: { tool: 'smartdd_zentao_update_v2' } }; c.semantics = 'write'; c.retry = 'never';
    c.protection = { kind: 'revision', object: 'controlled_object', key: 'expectedRevision' };
    expect(applicationManifestV2Schema.safeParse(b.manifest).success).toBe(true);
    c.semantics = 'external-write';
    expect(applicationManifestV2Schema.safeParse(b.manifest).success).toBe(false);
    c.approval = 'host-observed-user-authorization';
    expect(applicationManifestV2Schema.safeParse(b.manifest).success).toBe(true);
  });
  const invalid: [string, (m: ApplicationManifestV2) => void][] = [
    ['MCP fallback contract major mismatch', m => { m.capabilities[0].binding.fallback = { mcp: { tool: 'smartdd_zentao_object_list_v1' } }; }],
    ['MCP primary contract major mismatch', m => { m.entry = 'mcp'; m.capabilities[0].binding = { mcp: { tool: 'smartdd_zentao_object_list_v1' } }; }],
    ['two primary entries', m => { m.capabilities[0].binding.mcp = { tool: 'smartdd_zentao_object_list_v2' }; }],
    ['no primary entry', m => { m.capabilities[0].binding = {}; }],
    ['primary differs from application entry', m => { m.entry = 'mcp'; }],
    ['same fallback as primary', m => { m.capabilities[0].binding.fallback = { cli: { command: ['zentao', 'fallback'] } }; }],
    ['write fallback', m => { m.capabilities[0].semantics = 'write'; m.capabilities[0].retry = 'never'; m.capabilities[0].protection = { kind: 'revision', object: 'item', key: 'expectedRevision' }; }],
    ['write without protection', m => { m.capabilities[0].semantics = 'write'; m.capabilities[0].retry = 'never'; delete m.capabilities[0].binding.fallback; }],
    ['write automatic retry', m => { m.capabilities[0].semantics = 'write'; delete m.capabilities[0].binding.fallback; m.capabilities[0].protection = { kind: 'operation-receipt', object: 'operations', key: 'operationId' }; }],
    ['capability of another app', m => { m.capabilities[0].id = 'mail.object.list'; }],
    ['CLI command of another app', m => { m.capabilities[0].binding.cli!.command[0] = 'mail'; }],
    ['undeclared required slot', m => { m.capabilities[0].slots.required = ['smtp']; }],
    ['undeclared conditional slot', m => { m.capabilities[0].slots.conditional = ['smtp']; }],
    ['repeated dependency', m => { m.capabilities[0].slots.conditional = ['zentao']; }],
    ['undeclared capability permission', m => { m.capabilities[0].permission = 'zentao.extra'; }],
    ['permission of another app', m => { m.permissions.push('mail.read'); }],
    ['duplicate provider contract', m => { m.connectionContracts.push(structuredClone(m.connectionContracts[0])); }],
    ['duplicate capability', m => { m.capabilities.push(structuredClone(m.capabilities[0])); }],
    ['missing contract file', m => { m.files = m.files.filter(f => f.path !== 'schemas/output.json'); }],
    ['case folded file collision', m => { m.files.push({ ...m.files[0], path: 'skills/query/skill.md' }); }],
    ['package code', m => { m.files.push({ path: 'untrusted.mjs', sha256: '0'.repeat(64), size: 0, executable: false }); }],
    ['package executable', m => { m.files[0].executable = true; }],
    ['legacy mapping wrong major', m => { m.capabilities[0].legacyTool!.contractMajor = 2; }],
  ];
  it.each(invalid)('rejects %s before publication', (_label, mutate) => {
    const b = v2Bundle(); mutate(b.manifest);
    expect(() => parsePackageManifest(b.manifest, modules)).toThrow(ApplicationError);
  });
  it('rejects unknown declarations, altered bytes and unlisted files', () => {
    const b = v2Bundle();
    expect(() => parsePackageManifest({ ...b.manifest, adapter: { entry: 'evil.cjs', format: 'cjs' } }, modules)).toThrow(ApplicationError);
    b.files['schemas/input.json'] = Buffer.from('{}');
    expect(() => validatePackageBundle(b, modules)).toThrow(expect.objectContaining({ code: 'HASH_MISMATCH' }));
    const extra = v2Bundle(); extra.files.extra = Buffer.from('unlisted');
    expect(() => validatePackageBundle(extra, modules)).toThrow(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
  });
});

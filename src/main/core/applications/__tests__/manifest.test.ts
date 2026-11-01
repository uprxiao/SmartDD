import {applicationToolDeclarations} from '@shared/application-capabilities';
import { describe, expect, it } from 'vitest';
import { ApplicationError, isPackagePath } from '@shared/applications';
import { assertHostCompatible, canonicalJson, digest, manifestHash, parseManifest, validateBundle } from '../manifest';
import { fixtureBundle } from './fixtures';

describe('application manifest identity and complete-file contract', () => {
  it('canonicalizes nested object keys by Unicode code point with preserved array order', () => {
    expect(canonicalJson({ '\u{10000}': 2, '\ue000': 1, list: [3, 2], a: { z: 1, a: 2 } })).toBe('{"a":{"a":2,"z":1},"list":[3,2],"\ue000":1,"\u{10000}":2}');
    expect(() => canonicalJson({ invalid: undefined })).toThrow(ApplicationError);
    expect(() => canonicalJson([Number.NaN])).toThrow(ApplicationError);
  });
  it('gives the same identity for equivalent file-list and object-key orders', () => {
    const a = fixtureBundle(), b = fixtureBundle(); b.manifest.files.reverse();
    b.manifest.hostApi = { max: 1, min: 1 };
    expect(manifestHash(a.manifest)).toBe(manifestHash(b.manifest));
    expect(validateBundle(a).packageHash).toBe(manifestHash(a.manifest));
  });
  it('changes identity when either Skill, adapter, tool contract or permission changes', () => {
    const original = fixtureBundle(), base = manifestHash(original.manifest);
    const skill = fixtureBundle(); skill.manifest.files[0].sha256 = 'a'.repeat(64);
    const adapter = fixtureBundle(); adapter.manifest.files[1].sha256 = 'a'.repeat(64);
    const tool = fixtureBundle(); applicationToolDeclarations(tool.manifest)[0].name = 'smartdd_zentao_query_v2'; applicationToolDeclarations(tool.manifest)[0].contractMajor = 2;
    const permission = fixtureBundle(); permission.manifest.permissions.push('zentao.extra');
    for (const item of [skill, adapter, tool, permission]) expect(manifestHash(item.manifest)).not.toBe(base);
  });
  it.each(['../escape', '/absolute', 'a//b', 'a/./b', 'a\\b', 'C:/x', 'a/CON.txt', 'a/NUL', 'a/trailing.', 'a/trailing ', 'a/\u202ex', 'e\u0301/file'])('rejects ambiguous package path %j', path => {
    expect(isPackagePath(path)).toBe(false);
  });
  it('rejects unknown manifest fields and duplicate or case-folded file paths', () => {
    const a = fixtureBundle();
    expect(() => parseManifest({ ...a.manifest, arbitraryCommand: 'run' })).toThrow(ApplicationError);
    a.manifest.files.push({ ...a.manifest.files[0] }); expect(() => parseManifest(a.manifest)).toThrow(/重复/);
    const b = fixtureBundle(); b.manifest.files.push({ ...b.manifest.files[0], path: 'skills/query/skill.md' }); expect(() => parseManifest(b.manifest)).toThrow(/大小写/);
  });
  it('rejects a missing or empty connection-contract declaration before assigning executable package identity', () => {
    const source = fixtureBundle(); const { connectionContracts: _omitted, ...missing } = source.manifest;
    for (const manifest of [missing, { ...source.manifest, connectionContracts: [] }]) {
      expect(() => parseManifest(manifest)).toThrow(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
      expect(() => manifestHash(manifest)).toThrow(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
    }
    expect(validateBundle(source).manifest.connectionContracts).toEqual(source.manifest.connectionContracts);
  });
  it('rejects file-directory conflicts and a missing declared executable entry', () => {
    const a = fixtureBundle(); a.manifest.files.push({ ...a.manifest.files[0], path: 'skills' }); expect(() => parseManifest(a.manifest)).toThrow(/目录路径冲突/);
    const b = fixtureBundle(); b.manifest.adapter.entry = 'adapter/missing.cjs'; expect(() => parseManifest(b.manifest)).toThrow(/完整文件清单/);
  });
  it('rejects altered bytes, size, missing files and unlisted files before publication', () => {
    const a = fixtureBundle(); a.files['adapter/index.cjs'] = Buffer.from('altered'); expect(() => validateBundle(a)).toThrow(/摘要/);
    const b = fixtureBundle(); delete b.files['adapter/index.cjs']; expect(() => validateBundle(b)).toThrow(/文件集合/);
    const c = fixtureBundle(); c.files['extra.cjs'] = Buffer.from('unlisted'); expect(() => validateBundle(c)).toThrow(/文件集合/);
    const d = fixtureBundle(); d.manifest.files[0].size++; expect(() => validateBundle(d)).toThrow(/大小/);
  });
  it('rejects malformed JSON Schema resources and mismatched migration checksums', () => {
    const a = fixtureBundle(); a.files['schemas/input.json'] = Buffer.from('bad JSON');
    const file = a.manifest.files.find(f => f.path === 'schemas/input.json')!;
    file.size = a.files[file.path].length; file.sha256 = digest(a.files[file.path]);
    expect(() => validateBundle(a)).toThrow(/JSON Schema/);
    const b = fixtureBundle(); b.manifest.migrations = [{ id: 'initial', from: 0, to: 1, file: b.manifest.adapter.entry, checksum: 'a'.repeat(64) }];
    expect(() => parseManifest(b.manifest)).toThrow(/checksum/);
  });
  it('bounds native application and Skill names before creating any shared projections', () => {
    const a = fixtureBundle(); a.manifest.appId = 'a'.repeat(21); expect(() => parseManifest(a.manifest)).toThrow(ApplicationError);
    const b = fixtureBundle(); b.manifest.skills[0].id = 'a'.repeat(17); expect(() => parseManifest(b.manifest)).toThrow(ApplicationError);
    const c = fixtureBundle(); c.manifest.skills[0].id = 'bad--name'; expect(() => parseManifest(c.manifest)).toThrow(ApplicationError);
  });
  it('enforces application/tool identity, declared permissions, send annotations and host compatibility', () => {
    const a = fixtureBundle(); applicationToolDeclarations(a.manifest)[0].name = 'smartdd_mail_query_v1'; expect(() => parseManifest(a.manifest)).toThrow(/名称/);
    const b = fixtureBundle(); applicationToolDeclarations(b.manifest)[0].permission = 'zentao.send'; expect(() => parseManifest(b.manifest)).toThrow(/权限|发送/);
    const c = fixtureBundle(); c.manifest.hostApi = { min: 2, max: 3 }; expect(() => assertHostCompatible(parseManifest(c.manifest))).toThrow(/不支持/);
  });
});

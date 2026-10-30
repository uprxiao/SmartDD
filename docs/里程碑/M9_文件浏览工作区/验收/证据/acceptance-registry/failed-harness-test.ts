import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_STRICT_SCHEMA_MAP, AppSettingsKeys } from '@shared/app-settings';
import { classifyFile, type FileContentKind } from '@shared/file-classification';
import { pathRequestSchema } from '@shared/files';
import { fileRouteSchema } from '@shared/file-workspace';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileBuffer } from './file-buffer';
import { CODE_ROLES, codeLanguage, highlightRanges } from './code/model';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const baselinePath = 'docs/里程碑/M9_文件浏览工作区/调研/证据/m9-viewers-source.json';
const baselineBytes = readFileSync(baselinePath);
const baseline = JSON.parse(baselineBytes.toString('utf8')).language_registry as {
  entry_count: number; distinct_language_ids: number; entries: { filename_or_suffix: string; language: string }[];
};
// Filename keys are retained as filenames; other registry keys become suffixes.
// Separate numbered directories avoid case-insensitive filesystem collisions (P/p, R/r).
const fullNames = new Set(['CMakeLists.txt', 'CODEOWNERS', 'Dockerfile', 'dockerfile', 'COMMIT_EDITMSG', 'git-rebase-todo', 'Makefile', 'makefile', 'qmldir', 'Gemfile', 'Rakefile', 'Guardfile', 'Capfile', 'Berksfile', 'Brewfile', 'Vagrantfile', 'Thorfile', 'Appraisals', 'Dangerfile']);
const source = 'const 中文 = "🙂<&>";\n// UTF-8 registry fixture, not executable code\n';
const bytes = Buffer.from(source);
const registry = baseline.entries.map((entry, index) => ({ ...entry, index, name: fullNames.has(entry.filename_or_suffix) ? entry.filename_or_suffix : `sample.${entry.filename_or_suffix}` }));
const output: Record<string, unknown> = {
  cases: ['M9-T-F05', 'M9-T-F06', 'M9-T-F28'], startedAt: new Date().toISOString(),
  baseline: { path: baselinePath, sha256: sha(baselineBytes), entries: baseline.entry_count, languages: baseline.distinct_language_ids },
  unit: [], integration: [],
  boundaries: {
    customLanguageMappings: 'Not exposed by the production settings or file-open/restore contract. No override was installed; tests record fixed mapping and reject unsupported request fields.',
    mcpViewerHost: 'No production viewer registry, preferred-viewer or explicit-viewer selector. The no-host branch verifies local text/binary fallback. Registration/longest-suffix/preferred/explicit-null arbitration is not implemented or claimed.',
    integration: 'Real FileService/FileRootsService/FileRecoveryStore/FileBuffer and packaged native broker; direct typed service adapter, not Electron IPC transport or App UI.',
    semantics: 'Language IDs are observations of syntax highlighting only; no compiler/runtime or Codex token/color parity claim.',
  },
};
afterAll(() => {
  if (process.env.SMARTDD_REGISTRY_EVIDENCE) {
    mkdirSync(dirname(process.env.SMARTDD_REGISTRY_EVIDENCE), { recursive: true });
    writeFileSync(process.env.SMARTDD_REGISTRY_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n');
  }
});

function difference(reference: string, actual: string | null, kind: FileContentKind) {
  if (kind !== 'text') return `Local ${kind} routing takes precedence over a syntax-language hint; reference ${reference} is not an editable-text guarantee.`;
  if (actual === reference) return null;
  if (actual === null) return `Reference ${reference} is not selected by this production filename resolver/grammar bundle; content remains literal plain UTF-8 text.`;
  return `Reference ${reference}; production ${actual}. The fixed basename/last-suffix resolver and highlight.js bundle differ from the reference registry; no grammar-equivalence claim.`;
}
function assertTokens(text: string, name: string) {
  const tokens = highlightRanges(text, name);
  expect(tokens.length % 3).toBe(0);
  for (let i = 0; i < tokens.length; i += 3) {
    expect(tokens[i]).toBeLessThan(tokens[i + 1]);
    expect(tokens[i + 1]).toBeLessThanOrEqual(text.length);
    expect(CODE_ROLES[tokens[i + 2]]).toBeDefined();
    if (i) expect(tokens[i]).toBeGreaterThanOrEqual(tokens[i - 2]);
  }
  if (codeLanguage(name) === null) expect(tokens.length).toBe(0);
  return tokens.length / 3;
}
const route = { source: 'project-directory', sourceId: 'registry-root', sourcePath: '/synthetic', relativePath: 'sample.ts', mode: 'document' };

describe('M9-T-F05/F06/F28 production classification capability contract', () => {
  it('F05 records every one of the 345 baseline entries, literal names, compound suffixes and both case forms', () => {
    expect(baseline.entry_count).toBe(345); expect(registry).toHaveLength(345);
    expect(new Set(registry.map(v => v.filename_or_suffix)).size).toBe(345);
    expect(new Set(registry.map(v => v.language)).size).toBe(228);
    for (const entry of registry) {
      for (const [form, name] of [['primary', entry.name], ['literal-key', entry.filename_or_suffix], ['lower', entry.name.toLowerCase()], ['upper', entry.name.toUpperCase()]]) {
        const classification = classifyFile(name, bytes), languageId = codeLanguage(name);
        const mappingDifference = difference(entry.language, languageId, classification.kind);
        // These are the only two reviewed artifact overrides present in this language registry.
        expect(classification.kind, name).toBe(entry.filename_or_suffix === 'wasm' && form !== 'literal-key' ? 'binary' : entry.filename_or_suffix === 'potx' && form !== 'literal-key' ? 'archive' : 'text');
        const tokenCount = assertTokens(source, name);
        if (languageId !== entry.language || classification.kind !== 'text') expect(mappingDifference).toBeTruthy();
        (output.unit as unknown[]).push({ case: 'F05', index: entry.index, key: entry.filename_or_suffix, referenceLanguageId: entry.language, form, name, classification, languageId, tokenCount, mappingDifference });
      }
    }
  });
  it('F06 explicitly reports absent custom mapping and verifies fixed filename/compound/final-suffix outcomes', () => {
    expect(AppSettingsKeys).not.toContain('fileLanguageMappings');
    expect(Object.keys(APP_SETTINGS_STRICT_SCHEMA_MAP.general.shape)).toEqual(['language']);
    const requestedOverride = { 'playwright.config.ts': 'python', 'config.ts': 'ruby', ts: 'java' };
    expect(fileRouteSchema.safeParse({ ...route, languageMappings: requestedOverride }).success).toBe(false);
    const actual = [['playwright.config.ts', 'typescript'], ['sample.config.ts', 'typescript'], ['sample.ts', 'typescript'], ['CMakeLists.txt', null], ['Dockerfile', 'dockerfile']] as const;
    for (const [name, expected] of actual) expect(codeLanguage(name)).toBe(expected);
    (output.unit as unknown[]).push({ case: 'F06', capability: 'unsupported', requestedOverride, installed: false, routeRejected: true, actual, difference: 'No configurable mapping facility. The production defaults cannot demonstrate custom > full filename > compound > final suffix precedence. Unsupported-branch evidence only.' });
  });
  it('F28 rejects unsupported explicit/preferred viewer fields and keeps the no-host fallback explicit', () => {
    for (const extra of [{ explicitViewer: 'missing-viewer' }, { preferredViewers: ['missing-viewer'] }, { viewerRegistrations: [{ id: 'foo', suffix: '.foo' }, { id: 'barfoo', suffix: '.bar.foo' }] }]) {
      expect(fileRouteSchema.safeParse({ ...route, ...extra }).success).toBe(false);
    }
    for (const name of ['sample.foo', 'sample.bar.foo', 'SAMPLE.BAR.FOO']) {
      expect(classifyFile(name, bytes).kind).toBe('text'); expect(codeLanguage(name)).toBeNull();
      expect(classifyFile(name, Buffer.from([65, 0, 66])).kind).toBe('binary');
    }
    (output.unit as unknown[]).push({ case: 'F28', capability: 'unsupported', requestedRegistrations: ['.foo', '.bar.foo'], installed: false, preferred: 'missing-viewer', explicit: 'missing-viewer', routeRejected: true, difference: 'No viewer host/registry. No longest-match, preference or explicit-miss null result is claimed; strict local routes reject unsupported selectors and ordinary authorized files use internal fallback.' });
  });
});

type Fixture = { name: string; bytes: Buffer; reference?: string; expectedKind: FileContentKind; expectedLanguage?: string | null };
async function withRealFiles(caseId: string, fixtures: Fixture[], unsupported?: Record<string, unknown>) {
  const executable = process.env.SMARTDD_REGISTRY_BROKER!;
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-registry-'))), project = join(fixture, 'project'), userData = join(fixture, 'userdata');
  mkdirSync(project); mkdirSync(userData);
  const broker = new NativeFileBroker(executable);
  const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'registry-root', path: project, label: 'Registry synthetic fixtures', projectId: 'registry-project' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userData, resolver));
  const owner = 'registry-owner';
  output.native = { path: executable, sha256: sha(readFileSync(executable)), platform: process.platform, arch: process.arch };
  try {
    const root = (await service.openScope(owner, { kind: 'project', projectId: 'registry-project' })).roots[0];
    for (const [index, sample] of fixtures.entries()) {
      const relativePath = `${index}/${sample.name}`, path = join(project, relativePath);
      mkdirSync(dirname(path)); writeFileSync(path, sample.bytes);
      const before = statSync(path, { bigint: true });
      const request = { lease: root.lease, generation: root.generation, relativePath };
      if (unsupported) expect(pathRequestSchema.safeParse({ ...request, ...unsupported }).success).toBe(false);
      const document = await service.open(owner, request);
      const api = {
        read: vi.fn((ref) => service.read(owner, ref)), refresh: vi.fn((ref) => service.refresh(owner, ref)),
        save: vi.fn((input) => service.save(owner, input)), checkpoint: vi.fn((input) => service.checkpoint(owner, input)),
        drafts: vi.fn(async (ref) => service.drafts(owner, ref)), readDraft: vi.fn((ref, id) => service.readDraft(owner, ref, id)),
        resolveDraft: vi.fn((input) => service.resolveDraft(owner, input)), closeDocument: vi.fn(async (ref) => { service.closeDocument(owner, ref); }),
      };
      const buffer = new FileBuffer(document, api, () => undefined);
      try {
        await buffer.load();
        expect(buffer.loadState, relativePath).toBe('ready');
        expect(document.content?.kind, relativePath).toBe(sample.expectedKind);
        expect(buffer.editable, relativePath).toBe(sample.expectedKind === 'text');
        expect(buffer.editor !== null, relativePath).toBe(sample.expectedKind === 'text');
        expect(document.revision.hash, relativePath).toBe(sha(sample.bytes));
        const languageId = codeLanguage(document.name);
        if (sample.expectedLanguage !== undefined) expect(languageId, relativePath).toBe(sample.expectedLanguage);
        if (sample.expectedKind === 'text') {
          expect(buffer.raw, relativePath).toBe(sample.bytes.toString('utf8'));
          assertTokens(buffer.raw, document.name);
        } else { await buffer.save(); await buffer.checkpoint(); }
        expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
        const independent = readFileSync(path), after = statSync(path, { bigint: true });
        expect(independent, relativePath).toEqual(sample.bytes);
        expect(after.ino).toBe(before.ino); expect(after.mtimeNs).toBe(before.mtimeNs); expect(after.ctimeNs).toBe(before.ctimeNs);
        (output.integration as unknown[]).push({ case: caseId, index, name: sample.name, relativePath, kind: document.content?.kind, referenceLanguageId: sample.reference ?? null, languageId, mappingDifference: sample.reference ? difference(sample.reference, languageId, sample.expectedKind) : null, bytes: independent.length, initialSha256: sha(sample.bytes), finalSha256: sha(independent), inodeBefore: String(before.ino), inodeAfter: String(after.ino), mtimeNsBefore: String(before.mtimeNs), mtimeNsAfter: String(after.mtimeNs), ctimeNsBefore: String(before.ctimeNs), ctimeNsAfter: String(after.ctimeNs), editable: buffer.editable, readCalls: api.read.mock.calls.length, saveCalls: api.save.mock.calls.length, checkpointCalls: api.checkpoint.mock.calls.length, unsupportedFieldsRejected: Boolean(unsupported), pass: true });
      } finally { buffer.dispose(); service.closeDocument(owner, document.ref); }
    }
  } finally { service.closeOwner(owner); broker.dispose(); rmSync(fixture, { recursive: true, force: true }); }
}

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_REGISTRY_BROKER)('M9-T-F05/F06/F28 actual authorized file IO and editor routing', () => {
  it('F05 reads all 345 pure UTF-8 registry samples using the production service and packaged broker', async () => {
    await withRealFiles('F05', registry.map(entry => ({ name: entry.name, bytes, reference: entry.language, expectedKind: entry.filename_or_suffix === 'wasm' ? 'binary' : entry.filename_or_suffix === 'potx' ? 'archive' : 'text' })));
  }, 90_000);
  it('F06 retains documented fixed mapping for full, compound and final-suffix names when overrides are unavailable', async () => {
    await withRealFiles('F06', ['playwright.config.ts', 'sample.config.ts', 'sample.ts'].map(name => ({ name, bytes, expectedKind: 'text', expectedLanguage: 'typescript' })), { languageMappings: { 'playwright.config.ts': 'python', 'config.ts': 'ruby', ts: 'java' } });
  });
  it('F28 falls back safely for .foo and .bar.foo with text/binary content and rejects nonexistent viewer selectors', async () => {
    const fixtures: Fixture[] = [];
    for (const name of ['sample.foo', 'sample.bar.foo', 'SAMPLE.BAR.FOO']) {
      fixtures.push({ name, bytes, expectedKind: 'text', expectedLanguage: null }, { name, bytes: Buffer.from([65, 0, 66]), expectedKind: 'binary', expectedLanguage: null });
    }
    await withRealFiles('F28', fixtures, { explicitViewer: 'missing-viewer', preferredViewers: ['missing-viewer'] });
  });
});

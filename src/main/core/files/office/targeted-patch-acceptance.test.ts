import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileService } from '../file-service';
import { FileRootsService } from '../roots';
import { FileRecoveryStore } from '../recovery-store';
import { NativeFileBroker } from '../native-broker';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { editPptx } from './pptx-edit';
import { OfficeXml, attribute, children, descendants, type OfficeXmlNode } from './xml';
import { drawingNamespace, pptxDrawingNodes, pptxShapeId, pptxShapeTree } from './pptx-elements';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const native = process.env.SMARTDD_M9_FILE_BROKER;
const part = 'ppt/slides/slide1.xml';
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const target = (doc: OfficeXml, id: string): OfficeXmlNode => pptxDrawingNodes(pptxShapeTree(doc)).find(row => pptxShapeId(row.node) === id)!.node;
const rows: unknown[] = [];
let directory = '', worker = '';
async function repeatedFixture() {
  let file = await OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    file = editPptx(file, { type: 'insert-element', slideId: '256', kind: 'text' }).packageData;
    ids.push(new OfficePagesModel(file).info.slides[0].elements!.at(-1)!.id);
  }
  const doc = new OfficeXml(file.read(part)), a = drawingNamespace(doc.root.uri);
  const rich = `<a:bodyPr xmlns:a="${a}"/><a:lstStyle xmlns:a="${a}"/><a:p xmlns:a="${a}"><a:r><a:rPr b="1"/><a:t>Alpha</a:t></a:r><a:r><a:rPr i="1"/><a:t>Beta</a:t></a:r></a:p>`;
  file = file.patch(new Map([[part, doc.edit(ids.map(id => doc.replaceContent(children(target(doc, id), 'txBody')[0], rich)))]]), { changed: [part], added: [], removed: [] });
  return { file, ids };
}
function assertOnlyTarget(before: OfficePackage, after: OfficePackage, ids: string[]) {
  const old = new OfficeXml(before.read(part)), next = new OfficeXml(after.read(part));
  for (const row of pptxDrawingNodes(pptxShapeTree(old))) {
    const id = pptxShapeId(row.node)!;
    if (id !== ids[0]) expect(next.slice(target(next, id)), `untouched object ${id}`).toBe(old.slice(row.node));
  }
  for (const name of before.names()) if (name !== part) expect(hash(after.read(name)), name).toBe(hash(before.read(name)));
  const body = children(target(next, ids[0]), 'txBody')[0];
  const runs = children(children(body, 'p', drawingNamespace(next.root.uri))[0], 'r');
  expect(children(runs[0], 't')[0].text).toBe('Al中文🙂');
  expect(attribute(children(runs[0], 'rPr')[0], 'b')).toBe('1');
  expect(children(runs[1], 't')[0].text).toBe('ta');
  expect(attribute(children(runs[1], 'rPr')[0], 'i')).toBe('1');
}
it('addresses repeated rich text structurally, and the preservation oracle catches a naive global replacement', async () => {
  const { file, ids } = await repeatedFixture();
  const result = editPptx(file, { type: 'element-text', slideId: '256', elementId: ids[0], text: 'Al中文🙂ta' });
  assertOnlyTarget(file, result.packageData, ids);
  expect(result.plan).toEqual({ changed: [part], added: [], removed: [] });
  // Negative control: the same old run occurs twice. A global byte replacement
  // corrupts the other object and must fail the exact preservation assertion.
  const corrupt = file.patch(new Map([[part, Buffer.from(file.read(part).toString().replaceAll('Alpha', 'Al中文🙂').replaceAll('Beta', 'ta'))]]), { changed: [part], added: [], removed: [] });
  expect(() => assertOnlyTarget(file, corrupt, ids)).toThrow('untouched object');
  rows.push({ branch: 'unit-duplicate-text', target: ids[0], untouched: ids[1], naiveReplacementRejectedByPreservationOracle: true });
});
describe.skipIf(!native || process.platform !== 'darwin')('Y11 actual Worker/native structural target authority', () => {
  beforeAll(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-y11-target-'))); worker = join(directory, 'pptx.cjs');
    if (process.env.SMARTDD_OFFICE_ACCEPTANCE_APP) { worker = join(process.env.SMARTDD_OFFICE_ACCEPTANCE_APP, 'Contents/Resources/app.asar/out/main/m9-pptx-document.js'); return; }
    const require = createRequire(import.meta.url), esbuild = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    esbuild.buildSync({ entryPoints: [resolve('src/main/core/files/office/pptx-worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
  });
  it.each([false, true])('rejects unsafe selection without writing and retains an exact target (duplicate identity=%s)', async duplicate => {
    const { file, ids } = await repeatedFixture();
    const xml = new OfficeXml(file.read(part));
    const source = duplicate ? file.patch(new Map([[part, xml.edit([xml.setAttribute(descendants(target(xml, ids[1]), 'cNvPr', xml.root.uri)[0], 'id', ids[0])])]]), { changed: [part], added: [], removed: [] }) : file;
    const project = join(directory, String(duplicate)), userdata = join(project, 'userdata'); mkdirSync(userdata, { recursive: true });
    const path = join(project, 'repeated.pptx'), bytes = await source.bytes(); writeFileSync(path, bytes);
    const broker = new NativeFileBroker(native!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Y11 synthetic target', projectId: 'target' }] };
    const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver), undefined, undefined, undefined, undefined, undefined, undefined, undefined, worker);
    const owner = 'target';
    try {
      const root = (await service.openScope(owner, { kind: 'project', projectId: 'target' })).roots[0];
      const document = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: 'repeated.pptx' }), id = randomUUID();
      if (duplicate) {
        await expect(service.pptx.open(owner, { id, ref: document.ref, baseHash: document.revision.hash })).rejects.toThrow('编号重复');
        expect(hash(readFileSync(path))).toBe(hash(bytes));
        rows.push({ branch: 'duplicate-identity', sourceHash: hash(bytes), unchanged: true, message: '幻灯片对象编号重复或无效' });
        return;
      }
      await service.pptx.open(owner, { id, ref: document.ref, baseHash: document.revision.hash });
      // The production entry has no text-search mutation: missing identity or
      // an injected text matcher is rejected by its strict action contract.
      const noIdentity = { id, version: 0, action: { type: 'element-text', slideId: '256', findText: 'AlphaBeta', text: 'Al中文🙂ta' } };
      await expect(service.pptx.edit(owner, noIdentity as never)).rejects.toThrow('elementId');
      const guessed = { ...noIdentity, action: { ...noIdentity.action, elementId: ids[0] } };
      await expect(service.pptx.edit(owner, guessed as never)).rejects.toThrow('findText');
      expect(hash(readFileSync(path))).toBe(hash(bytes));
      const state = await service.pptx.edit(owner, { id, version: 0, action: { type: 'element-text', slideId: '256', elementId: ids[0], text: 'Al中文🙂ta' } });
      expect(state.version).toBe(1);
      const saved = await service.pptx.save(owner, { id, version: 1, draftId: randomUUID(), bufferVersion: 1, opId: randomUUID() });
      expect(saved.receipt.state, saved.receipt.message).toBe('saved');
      const disk = await OfficePackage.read(readFileSync(path)); assertOnlyTarget(file, disk, ids);
      service.pptx.close(owner, id); service.closeDocument(owner, document.ref);
      const fresh = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: 'repeated.pptx' });
      const reopened = await service.pptx.open(owner, { id: randomUUID(), ref: fresh.ref, baseHash: fresh.revision.hash });
      const objects = reopened.state.info.slides[0].elements!;
      expect(objects.find(item => item.id === ids[0])?.text).toBe('Al中文🙂ta');
      expect(objects.find(item => item.id === ids[1])?.text).toBe('AlphaBeta');
      rows.push({ branch: 'exact-identity', sourceHash: hash(bytes), savedHash: hash(readFileSync(path)), rejected: ['missing elementId', 'findText matcher'], target: ids[0], untouched: ids[1], reopened: true, otherPartsUnchanged: true });
    } finally { service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); }
  });
});
afterAll(() => {
  if (process.env.SMARTDD_Y11_TARGET_EVIDENCE) writeFileSync(process.env.SMARTDD_Y11_TARGET_EVIDENCE, JSON.stringify({ completedAt: new Date().toISOString(), rows }, null, 2) + '\n');
  if (directory) rmSync(directory, { recursive: true, force: true });
});

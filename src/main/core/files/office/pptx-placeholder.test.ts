import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pptxActionSchema, type PptxAction } from '@shared/file-pptx';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { OfficeXml, attribute, children } from './xml';
import { drawingNamespace, pptxDrawingNodes, pptxShapeId, pptxShapeTree } from './pptx-elements';
import { OFFICE_REL } from './relationships';
import { validatePptxImageContainer } from './pptx-image-container';
import { pptxTestImage } from './pptx-image-fixtures';
import { pptxPlaceholderImage } from './pptx-placeholder';

const part = 'ppt/slides/slide1.xml';
const frame = { x: 31.25, y: 42.5, width: 200, height: 125 };
const action = { type: 'image-placeholder', slideId: '256', frame } as unknown as PptxAction;
const fixture = () => OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const owned = () => {
  const image = pptxPlaceholderImage(), bytes = Buffer.from(image.base64, 'base64');
  return { bytes, receipt: { ...validatePptxImageContainer(bytes, image.mime as 'image/png'), hash: createHash('sha256').update(bytes).digest('hex') } };
};

describe('PPTX genuine image placeholder, distinct from generated media', () => {
  it('accepts only a source frame, never renderer-supplied media/receipt/provider state', () => {
    expect(pptxActionSchema.parse(action)).toEqual(action);
    for (const extra of [{ image: pptxTestImage().image }, { receipt: pptxTestImage().receipt }, { generated: true }, { provider: {} }]) {
      expect(() => pptxActionSchema.parse({ ...action, ...extra })).toThrow();
    }
    for (const invalid of [{ ...frame, width: 0 }, { ...frame, height: Infinity }, { ...frame, x: -1 }]) {
      expect(() => pptxActionSchema.parse({ ...action, frame: invalid })).toThrow();
    }
  });
  it('requires the exact decoded authored resource rather than an arbitrary image receipt', async () => {
    const file = await fixture(), source = owned();
    expect(source.receipt).toMatchObject({ width: 320, height: 200 });
    expect(source.bytes.length).toBeLessThan(4096);
    expect(() => editPptx(file, action)).toThrow('解码');
    expect(() => editPptx(file, action, undefined, pptxTestImage().receipt)).toThrow('回执');
    expect(() => editPptx(file, action, undefined, { ...source.receipt, width: 321 })).toThrow('尺寸');
  });
  it('creates one real picture/media relation at the requested frame, preserving all previous drawings and unrelated parts', async () => {
    const file = await fixture(), before = new OfficeXml(file.read(part)), source = owned();
    const result = editPptx(file, action, undefined, source.receipt), model = new OfficePagesModel(result.packageData);
    const oldIds = new Set(new OfficePagesModel(file).info.slides[0].elements!.map(element => element.id));
    const added = model.info.slides[0].elements!.filter(element => !oldIds.has(element.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'image', isPlaceholder: true, box: { ...frame, rotation: 0 } });
    const after = new OfficeXml(result.packageData.read(part));
    for (const { node } of pptxDrawingNodes(pptxShapeTree(before))) {
      const same = pptxDrawingNodes(pptxShapeTree(after)).find(row => pptxShapeId(row.node) === pptxShapeId(node))!.node;
      expect(after.slice(same)).toBe(before.slice(node));
    }
    const picture = pptxDrawingNodes(pptxShapeTree(after)).find(row => pptxShapeId(row.node) === added[0].id)!.node;
    const blip = children(children(picture, 'blipFill')[0], 'blip', drawingNamespace(after.root.uri))[0], rid = attribute(blip, 'embed', OFFICE_REL);
    const relation = model.graph.forPart(part).find(row => row.id === rid)!;
    expect(relation.external).toBeFalsy();
    expect(result.packageData.read(relation.part!)).toEqual(source.bytes);
    expect(model.graph.contentTypes.get(relation.part!)).toBe('image/png');
    for (const name of file.names()) if (!result.plan.changed.includes(name)) expect(result.packageData.hashes()[name], name).toBe(file.hashes()[name]);
    const reopened = new OfficePagesModel(await OfficePackage.read(await result.packageData.bytes()));
    expect(reopened.info).toEqual(model.info);
  });
  it('preserves placeholder identity through save/reopen and undo/redo, clearing its marker on real replacement', async () => {
    const original = await fixture(), document = new PptxDocument(original);
    const first = document.edit(0, action, owned().receipt), placeholder = first.info.slides[0].elements!.at(-1)!;
    const materialized = await document.materialize(1);
    const reopened = new PptxDocument(await OfficePackage.read(materialized.bytes));
    expect(reopened.state().info.slides[0].elements!.find(element => element.id === placeholder.id)).toMatchObject({ isPlaceholder: true, box: frame });
    const replacement = pptxTestImage(1), replaced = reopened.edit(0, { type: 'image-replace', slideId: '256', elementId: placeholder.id, image: replacement.image }, replacement.receipt);
    const image = replaced.info.slides[0].elements!.find(element => element.id === placeholder.id)!;
    expect(image.isPlaceholder).toBeUndefined(); expect(image.name).toBe(`Picture ${placeholder.id}`); expect(image.box).toMatchObject(frame);
    expect(reopened.history(1, 'undo').info.slides[0].elements!.find(element => element.id === placeholder.id)?.isPlaceholder).toBe(true);
    expect(reopened.history(2, 'redo').info.slides[0].elements!.find(element => element.id === placeholder.id)?.isPlaceholder).toBeUndefined();
    document.history(1, 'undo'); expect(document.model.packageData.hashes()).toEqual(original.hashes());
    expect(document.history(2, 'redo').info.slides[0].elements!.find(element => element.id === placeholder.id)).toMatchObject({ isPlaceholder: true, box: frame });
  });
  it('rejects stale slides, out-of-slide frames and zero-EMU dimensions without changing original content', async () => {
    const file = await fixture(), hashes = file.hashes(), bounds = new OfficePagesModel(file).info;
    for (const invalid of [
      { ...action, slideId: '4294967295' },
      { ...action, frame: { ...frame, x: bounds.width! - 1 } },
      { ...action, frame: { ...frame, y: bounds.height! - 1 } },
      { ...action, frame: { ...frame, width: .000001 } },
    ]) expect(() => editPptx(file, invalid as PptxAction, undefined, owned().receipt)).toThrow();
    expect(file.hashes()).toEqual(hashes);
  });
});

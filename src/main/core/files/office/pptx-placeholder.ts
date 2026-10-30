import { crc32, deflateSync } from 'node:zlib';
import type { PptxAction } from '@shared/file-pptx';
import type { PptxImageInput } from '@shared/file-pptx-image';
import { PPTX_PLACEHOLDER_DESCRIPTION } from '@shared/file-pptx-placeholder';
import { FileError } from '@shared/files';
import { OfficePagesModel } from './pages-model';
import { editPptxImage, type PptxImageReceipt } from './pptx-image';
import { EMU_PER_POINT, drawingNamespace, pptxDrawingNodes, pptxShapeId, pptxShapeTree } from './pptx-elements';
import { OfficeXml, attribute, children, descendants } from './xml';
import { OFFICE_REL, STRICT_REL } from './relationships';

let placeholder: string | undefined;
/** A bounded, authored grey cross, not model output or user-selected media.
 * The exact bytes still go through the normal main decoder and Worker receipt. */
export function pptxPlaceholderImage(): PptxImageInput {
  if (!placeholder) {
    const width = 320, height = 200, header = Buffer.alloc(13), pixels = Buffer.alloc((width * 3 + 1) * height);
    header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const border = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const cross = Math.abs(x * (height - 1) - y * (width - 1)) < 500
        || Math.abs((width - 1 - x) * (height - 1) - y * (width - 1)) < 500;
      pixels.fill(border ? 150 : cross ? 200 : 238, y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3);
    }
    const chunk = (type: string, body: Buffer) => {
      const length = Buffer.alloc(4), data = Buffer.concat([Buffer.from(type), body]), sum = Buffer.alloc(4);
      length.writeUInt32BE(body.length); sum.writeUInt32BE(crc32(data)); return Buffer.concat([length, data, sum]);
    };
    placeholder = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
  }
  return { mime: 'image/png', base64: placeholder };
}

export function insertPptxPlaceholder(model: OfficePagesModel, action: Extract<PptxAction, { type: 'image-placeholder' }>, receipt?: PptxImageReceipt) {
  const frame = action.frame, width = model.info.width!, height = model.info.height!;
  if (frame.x + frame.width > width || frame.y + frame.height > height
    || Math.round(frame.width * EMU_PER_POINT) < 1 || Math.round(frame.height * EMU_PER_POINT) < 1) {
    throw new FileError('INVALID_INPUT', '图片占位范围超出当前幻灯片，未应用修改');
  }
  const originalSlide = model.info.slides.find(slide => slide.id === action.slideId);
  if (!originalSlide) throw new FileError('CHANGED', '幻灯片已不存在');
  const result = editPptxImage(model, { type: 'image-insert', slideId: action.slideId, image: pptxPlaceholderImage() }, receipt);
  const updated = new OfficePagesModel(result.packageData), originalIds = new Set(originalSlide.elements?.map(element => element.id));
  const added = updated.info.slides.find(slide => slide.id === action.slideId)!.elements!.filter(element => !originalIds.has(element.id));
  if (added.length !== 1 || added[0].kind !== 'image') throw new FileError('INVALID_INPUT', '图片占位对象身份无效');
  const main = new OfficeXml(result.packageData.read(updated.graph.mainPart));
  const entry = children(children(main.root, 'sldIdLst')[0], 'sldId').find(node => attribute(node, 'id') === action.slideId)!;
  const part = updated.graph.target(updated.graph.mainPart, (attribute(entry, 'id', OFFICE_REL) ?? attribute(entry, 'id', STRICT_REL))!);
  const doc = new OfficeXml(result.packageData.read(part)), picture = pptxDrawingNodes(pptxShapeTree(doc)).find(row => pptxShapeId(row.node) === added[0].id)!.node;
  const properties = descendants(picture, 'cNvPr', doc.root.uri)[0], drawing = drawingNamespace(doc.root.uri);
  const transform = children(children(picture, 'spPr', doc.root.uri)[0], 'xfrm', drawing)[0];
  const offset = children(transform, 'off', drawing)[0], extent = children(transform, 'ext', drawing)[0];
  const edits = [doc.setAttribute(properties, 'name', `Image placeholder ${added[0].id}`), doc.setAttribute(properties, 'descr', PPTX_PLACEHOLDER_DESCRIPTION),
    doc.setAttribute(offset, 'x', String(Math.round(frame.x * EMU_PER_POINT))), doc.setAttribute(offset, 'y', String(Math.round(frame.y * EMU_PER_POINT))),
    doc.setAttribute(extent, 'cx', String(Math.round(frame.width * EMU_PER_POINT))), doc.setAttribute(extent, 'cy', String(Math.round(frame.height * EMU_PER_POINT)))];
  const packageData = result.packageData.patch(new Map([[part, doc.edit(edits)]]), { changed: [part], added: [], removed: [] });
  new OfficePagesModel(packageData);
  return { packageData, plan: result.plan };
}

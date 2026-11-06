import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { FileError } from '@shared/files';
import type { PptxAction } from '@shared/file-pptx';
import { PPTX_IMAGE_LIMIT, type PptxImageInput } from '@shared/file-pptx-image';
import type { OfficePartPlan } from '@shared/file-office';
import { OfficePagesModel } from './pages-model';
import { OFFICE_REL, STRICT_REL, OPC_REL, relationshipKind, relationshipPart } from './relationships';
import { OfficeXml, attribute, children, descendants, xmlEscape, type OfficeXmlNode, type XmlEdit } from './xml';
import { EMU_PER_POINT, drawingNamespace, pptxDrawingNodes, pptxShapeId, pptxShapeTree } from './pptx-elements';
import { validatePptxImageContainer } from './pptx-image-container';
import { PPTX_PLACEHOLDER_DESCRIPTION } from '@shared/file-pptx-placeholder';

// Internal main -> Worker receipt, never accepted by the renderer action schema.
export const pptxImageReceiptSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
}).strict().refine(value => value.width * value.height <= 16 * 1024 * 1024);
export type PptxImageReceipt = z.infer<typeof pptxImageReceiptSchema>;
export type PptxImageDecoder = (image:PptxImageInput, signal:AbortSignal) => Promise<{width:number;height:number}>;
export function pptxImageBytes(image:PptxImageInput):Buffer {
  const bytes = Buffer.from(image.base64, 'base64');
  if (!bytes.length || bytes.length > PPTX_IMAGE_LIMIT || bytes.toString('base64') !== image.base64) throw new FileError('INVALID_INPUT', '图片编码无效或超过 20 MiB');
  const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!(image.mime === 'image/png' ? png : jpeg)) throw new FileError('INVALID_INPUT', '图片格式与文件内容不一致');
  return bytes;
}
const prefix = (node:OfficeXmlNode) => node.name.includes(':') ? node.name.slice(0, node.name.indexOf(':') + 1) : '';
const append = (doc:OfficeXml, node:OfficeXmlNode, value:string):XmlEdit => node.selfClosing ? doc.replaceContent(node, value) : {start:node.closeStart,end:node.closeStart,value};

/** Insert original bytes; replacement redirects only one picture's blip.
 * Existing media, relationships, crop, effects and other objects stay intact. */
export function editPptxImage(model:OfficePagesModel, action:Extract<PptxAction,{type:'image-insert'|'image-replace'}>, rawReceipt?:PptxImageReceipt) {
  if (!rawReceipt) throw new FileError('UNTRUSTED', '图片尚未通过本机解码验证');
  const receipt = pptxImageReceiptSchema.parse(rawReceipt), bytes = pptxImageBytes(action.image);
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.hash) throw new FileError('UNTRUSTED', '图片解码回执与所选内容不一致');
  const size=validatePptxImageContainer(bytes,action.image.mime);
  if(size.width!==receipt.width||size.height!==receipt.height)throw new FileError('UNTRUSTED','图片尺寸与本机解码回执不一致');
  const file = model.packageData, graph = model.graph, main = new OfficeXml(file.read(graph.mainPart));
  const entry = children(children(main.root,'sldIdLst')[0],'sldId').find(node => attribute(node,'id') === action.slideId);
  if (!entry) throw new FileError('CHANGED','幻灯片已不存在');
  const part = graph.target(graph.mainPart,(attribute(entry,'id',OFFICE_REL) ?? attribute(entry,'id',STRICT_REL))!);
  const doc = new OfficeXml(file.read(part)), ns = doc.root.uri, drawing = drawingNamespace(ns), relNs = drawing.startsWith('http://purl.') ? STRICT_REL : OFFICE_REL;
  const tree = pptxShapeTree(doc), nodes = pptxDrawingNodes(tree), edits:XmlEdit[] = [];
  let blip:OfficeXmlNode|undefined;
  if (action.type === 'image-replace') {
    const target = nodes.find(row => pptxShapeId(row.node) === String(Number(action.elementId)))?.node;
    if (!target) throw new FileError('CHANGED','图片对象已不存在');
    if (target.local !== 'pic') throw new FileError('UNSUPPORTED','所选对象不是普通图片');
    const fills = children(target,'blipFill',ns), blips = fills.length === 1 ? children(fills[0],'blip',drawing) : [];
    if (blips.length !== 1) throw new FileError('UNSUPPORTED','此图片的来源结构尚未适配，原图保留');
    blip = blips[0];
    if (attribute(blip,'link',relNs) || descendants(blip,'extLst').length || descendants(target,'extLst',ns).length) throw new FileError('UNSUPPORTED','此图片包含外链或扩展替代图像，原图保留');
    const id = attribute(blip,'embed',relNs), relation = graph.forPart(part).find(row => row.id === id);
    if (!relation?.part || relation.external || !relationshipKind(relation.type,'image')) throw new FileError('INVALID_INPUT','图片嵌入关系无效，原图保留');
    const properties=descendants(target,'cNvPr',ns)[0],placeholder=properties&&attribute(properties,'descr')===PPTX_PLACEHOLDER_DESCRIPTION;
    if (file.read(relation.part).equals(bytes) && graph.contentTypes.get(relation.part) === action.image.mime && !placeholder) return {packageData:file,plan:{changed:[],added:[],removed:[]} as OfficePartPlan};
    if(placeholder){edits.push(doc.setAttribute(properties,'descr',''));if(attribute(properties,'name')===`Image placeholder ${action.elementId}`)edits.push(doc.setAttribute(properties,'name',`Picture ${action.elementId}`));}
  }
  const occupied = new Set(file.names().map(name => decodeURIComponent(name).toLowerCase()));
  let index = 1, media:string;
  do { media = posix.join(posix.dirname(graph.mainPart),'media',`willyou-image-${index++}.${action.image.mime === 'image/png' ? 'png' : 'jpg'}`); } while (occupied.has(media.toLowerCase()));
  const relPart = relationshipPart(part), relations = new OfficeXml(file.has(relPart) ? file.read(relPart) : Buffer.from(`<Relationships xmlns="${OPC_REL}"/>`));
  const ids = new Set(graph.forPart(part).map(row => row.id)); index = 1;
  while (ids.has(`rIdWillYouImage${index}`)) index++;
  const rid = `rIdWillYouImage${index}`;
  if (blip) edits.push(doc.setAttribute(blip, Object.values(blip.attributes).find(item => item.local === 'embed' && item.uri === relNs)!.name, rid));
  else {
    const objectIds = new Set(descendants(tree,'cNvPr',ns).map(node => Number(attribute(node,'id')))); let id = 1;
    for (const value of objectIds) id = Math.max(id, value + 1);
    if (id > 4294967295) { id = 1; while (objectIds.has(id)) id++; }
    const scale = Math.min(1, model.info.width! * .6 / (receipt.width * .75), model.info.height! * .6 / (receipt.height * .75));
    const width = Math.max(1, Math.round(receipt.width * .75 * scale * EMU_PER_POINT)), height = Math.max(1, Math.round(receipt.height * .75 * scale * EMU_PER_POINT));
    const x = Math.round((model.info.width! * EMU_PER_POINT - width) / 2), y = Math.round((model.info.height! * EMU_PER_POINT - height) / 2);
    const object = `<p:pic xmlns:p="${ns}" xmlns:a="${drawing}" xmlns:r="${relNs}"><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    const at = children(tree,'extLst')[0]?.start ?? tree.closeStart;
    edits.push(tree.selfClosing ? doc.replaceContent(tree,object) : {start:at,end:at,value:object});
  }
  const relation = `<${prefix(relations.root)}Relationship Id="${rid}" Type="${relNs}/image" Target="${xmlEscape(posix.relative(posix.dirname(part),media))}"/>`;
  const types = new OfficeXml(file.read('[Content_Types].xml'));
  let registration = `<${prefix(types.root)}Override PartName="/${xmlEscape(media)}" ContentType="${action.image.mime}"/>`;
  if (!children(types.root,'Default').some(node => attribute(node,'Extension')?.toLowerCase() === 'rels')) registration += `<${prefix(types.root)}Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`;
  const changes = new Map<string,Uint8Array>([[part,doc.edit(edits)],[relPart,relations.edit([append(relations,relations.root,relation)])],[media,bytes],['[Content_Types].xml',types.edit([append(types,types.root,registration)])]]);
  const plan:OfficePartPlan = {changed:[...changes.keys()].filter(name => file.has(name)),added:[...changes.keys()].filter(name => !file.has(name)),removed:[]};
  const packageData = file.patch(changes,plan); new OfficePagesModel(packageData);
  return {packageData,plan};
}

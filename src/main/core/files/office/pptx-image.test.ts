import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import { pptxActionSchema } from '@shared/file-pptx';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { OfficeXml,attribute,children,descendants } from './xml';
import { OFFICE_REL,relationshipPart } from './relationships';
import { drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
import { pptxTestImage } from './pptx-image-fixtures';

const part='ppt/slides/slide1.xml',fixture=()=>OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const target=(doc:OfficeXml,id:string)=>pptxDrawingNodes(pptxShapeTree(doc)).find(row=>pptxShapeId(row.node)===id)!.node;
const insert=(file:OfficePackage)=>{const input=pptxTestImage();return editPptx(file,{type:'image-insert',slideId:'256',image:input.image},undefined,input.receipt);};
describe('PPTX original image bytes and exact picture references',()=>{
  it('embeds original PNG bytes, preserves aspect ratio and every existing object and unrelated part',async()=>{
    const file=await fixture(),before=new OfficeXml(file.read(part)),result=insert(file),model=new OfficePagesModel(result.packageData),image=model.info.slides[0].elements!.at(-1)!;
    expect(image.kind).toBe('image');expect(image.box!.width/image.box!.height).toBeCloseTo(1.5,7);
    const after=new OfficeXml(result.packageData.read(part));for(const {node} of pptxDrawingNodes(pptxShapeTree(before)))expect(after.slice(target(after,pptxShapeId(node)!))).toBe(before.slice(node));
    const media=result.plan.added.find(name=>name.endsWith('.png'))!;expect(result.packageData.read(media)).toEqual(pptxTestImage().bytes);expect(model.graph.contentTypes.get(media)).toBe('image/png');
    for(const name of file.names())if(!result.plan.changed.includes(name))expect(result.packageData.hashes()[name],name).toBe(file.hashes()[name]);
    expect(new OfficePagesModel(await OfficePackage.read(await result.packageData.bytes())).info).toEqual(model.info);
  });
  it('replaces only one of two pictures sharing the same image/rId, preserving crop, geometry and original media',async()=>{
    let file=insert(await fixture()).packageData;const doc=new OfficeXml(file.read(part)),pic=pptxDrawingNodes(pptxShapeTree(doc)).at(-1)!.node,id=pptxShapeId(pic)!,clone=new OfficeXml(Buffer.from(doc.slice(pic))),nv=descendants(clone.root,'cNvPr')[0];
    const copy=clone.edit([clone.setAttribute(nv,'id','4000')]).toString();const tree=pptxShapeTree(doc),fill=children(pic,'blipFill')[0],drawing=drawingNamespace(doc.root.uri);
    file=file.patch(new Map([[part,doc.edit([{start:tree.closeStart,end:tree.closeStart,value:copy},{start:children(fill,'stretch',drawing)[0].start,end:children(fill,'stretch',drawing)[0].start,value:`<a:srcRect xmlns:a="${drawing}" l="10000" r="5000"/>`}])]]),{changed:[part],added:[],removed:[]});
    const original=new OfficeXml(file.read(part)),input=pptxTestImage(1),result=editPptx(file,{type:'image-replace',slideId:'256',elementId:id,image:input.image},undefined,input.receipt),after=new OfficeXml(result.packageData.read(part));
    expect(after.slice(target(after,'4000'))).toBe(original.slice(target(original,'4000')));
    const old=target(original,id),updated=target(after,id),oldBlip=descendants(old,'blip',drawing)[0],newBlip=descendants(updated,'blip',drawing)[0];
    expect(after.slice(updated).replace(attribute(newBlip,'embed',OFFICE_REL)!,attribute(oldBlip,'embed',OFFICE_REL)!)).toBe(original.slice(old));
    for(const name of file.names().filter(name=>name.includes('/media/')))expect(result.packageData.read(name)).toEqual(file.read(name));
    const relationOld=new OfficeXml(file.read(relationshipPart(part))),relationNew=new OfficeXml(result.packageData.read(relationshipPart(part)));for(const node of relationOld.root.children)expect(relationNew.slice(relationNew.root.children.find(item=>attribute(item,'Id')===attribute(node,'Id'))!)).toBe(relationOld.slice(node));
  });
  it('treats identical replacement as a no-op and restores all source parts through undo/redo',async()=>{
    const file=await fixture(),doc=new PptxDocument(file),one=pptxTestImage(),two=pptxTestImage(1);const first=doc.edit(0,{type:'image-insert',slideId:'256',image:one.image},one.receipt),id=first.info.slides[0].elements!.at(-1)!.id;
    expect(doc.edit(1,{type:'image-replace',slideId:'256',elementId:id,image:one.image},one.receipt).version).toBe(1);
    doc.edit(1,{type:'image-replace',slideId:'256',elementId:id,image:two.image},two.receipt);const saved=await doc.materialize(2);doc.acknowledge(2,saved.hash);
    expect(doc.history(2,'undo').dirty).toBe(true);expect(doc.history(3,'redo').dirty).toBe(false);doc.history(4,'undo');doc.history(5,'undo');expect(doc.model.packageData.hashes()).toEqual(file.hashes());
  });
  it('rejects missing or mismatched decoder receipts, forged dimensions and renderer receipt fields',async()=>{
    const file=await fixture(),one=pptxTestImage(),action={type:'image-insert' as const,slideId:'256',image:one.image};
    expect(()=>editPptx(file,action)).toThrow('解码');expect(()=>editPptx(file,action,undefined,{...one.receipt,hash:'0'.repeat(64)})).toThrow('回执');expect(()=>editPptx(file,action,undefined,{...one.receipt,width:8192,height:8192})).toThrow();
    expect(()=>pptxActionSchema.parse({...action,receipt:one.receipt})).toThrow();expect(()=>editPptx(file,{...action,image:{...one.image,base64:one.image.base64+'\n'}},undefined,one.receipt)).toThrow('编码');
  });
  it('rejects stale targets and unsupported alternate image sources without dirtying the model',async()=>{
    let file=insert(await fixture()).packageData;const doc=new OfficeXml(file.read(part)),pic=pptxDrawingNodes(pptxShapeTree(doc)).at(-1)!.node,blip=descendants(pic,'blip',drawingNamespace(doc.root.uri))[0],id=pptxShapeId(pic)!;
    file=file.patch(new Map([[part,doc.edit([doc.replaceContent(blip,'<a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:ext uri="future"/></a:extLst>')])]]),{changed:[part],added:[],removed:[]});
    const model=new PptxDocument(file),input=pptxTestImage(1);
    expect(()=>model.edit(0,{type:'image-replace',slideId:'256',elementId:id,image:input.image},input.receipt)).toThrow('扩展');
    expect(()=>model.edit(0,{type:'image-replace',slideId:'256',elementId:'9999',image:input.image},input.receipt)).toThrow('不存在');
    expect(model.state()).toMatchObject({version:0,dirty:false,canUndo:false});expect(model.model.packageData.hashes()).toEqual(file.hashes());
  });
});

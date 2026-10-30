import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { PPTX_PRESETS,PPTX_SHAPES } from '@shared/file-pptx-elements';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { OfficeXml,attribute,children,descendants,type XmlEdit } from './xml';
import { drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const part='ppt/slides/slide1.xml',info=(file:OfficePackage)=>new OfficePagesModel(file).info.slides[0],elements=(file:OfficePackage)=>info(file).elements!;
const changed=(file:OfficePackage,edit:(doc:OfficeXml)=>XmlEdit[])=>{const doc=new OfficeXml(file.read(part)),bytes=doc.edit(edit(doc));return bytes.equals(file.read(part))?file:file.patch(new Map([[part,bytes]]),{changed:[part],added:[],removed:[]});};
const target=(doc:OfficeXml,id:string)=>pptxDrawingNodes(pptxShapeTree(doc)).find(row=>pptxShapeId(row.node)===id)!.node;
describe('PPTX actual object metadata and precise source edits',()=>{
  it('reads real table/chart/text identities and source transforms without using PDF coordinates',async()=>{
    const file=await fixture(),items=elements(file);
    expect(items.some(item=>item.kind==='table'&&item.box&&item.box.width>0)).toBe(true);
    expect(items.some(item=>item.kind==='chart'&&item.box&&item.box.height>0)).toBe(true);
    expect(items.some(item=>item.text==='MASTER_TITLE')).toBe(true);expect(new Set(items.map(item=>item.id)).size).toBe(items.length);
  });
  it('inserts a valid independent textbox, preserving every existing object and unrelated part byte-for-byte',async()=>{
    const file=await fixture(),before=new OfficeXml(file.read(part)),result=editPptx(file,{type:'insert-element',slideId:'256',kind:'text'}),after=new OfficeXml(result.packageData.read(part)),added=elements(result.packageData).at(-1)!;
    expect(added).toMatchObject({kind:'text',text:'双击编辑文本',preset:'rect',hidden:false});expect(added.box?.width).toBeGreaterThan(0);
    expect(result.plan).toEqual({changed:[part],added:[],removed:[]});
    for(const row of pptxDrawingNodes(pptxShapeTree(before))){const node=target(after,pptxShapeId(row.node)!);expect(after.source.slice(node.start,node.end)).toBe(before.source.slice(row.node.start,row.node.end));}
    const hashes=file.hashes();for(const name of file.names())if(name!==part)expect(result.packageData.hashes()[name],name).toBe(hashes[name]);
    expect(elements(await OfficePackage.read(await result.packageData.bytes())).at(-1)).toEqual(added);
  });
  it('maps every approved shape to actual DrawingML geometry, including a horizontal line',async()=>{
    const original=await fixture();
    for(const shape of PPTX_SHAPES){
      const result=editPptx(original,{type:'insert-element',slideId:'256',kind:'shape',shape}),item=elements(result.packageData).at(-1)!;
      expect(item.preset).toBe(PPTX_PRESETS[shape]);expect(item.kind).toBe('shape');expect(item.box!.width).toBeGreaterThan(0);expect(item.box!.height===0).toBe(shape==='line');
    }
    expect(()=>editPptx(original,{type:'insert-element',slideId:'256',kind:'shape',shape:'invalid' as never})).toThrow();
  });
  it('edits only the chosen text body and preserves rich-run properties and paragraph structure',async()=>{
    let file=editPptx(await fixture(),{type:'insert-element',slideId:'256',kind:'text'}).packageData;const id=elements(file).at(-1)!.id;
    file=changed(file,doc=>{const body=children(target(doc,id),'txBody')[0],a=drawingNamespace(doc.root.uri);return [doc.replaceContent(body,`<a:bodyPr xmlns:a="${a}"/><a:lstStyle xmlns:a="${a}"/><a:p xmlns:a="${a}"><a:pPr algn="ctr"/><a:r><a:rPr b="1" sz="2400"/><a:t>AB</a:t></a:r><a:r><a:rPr i="1" sz="3200"/><a:t>CD</a:t></a:r></a:p>`)];});
    const result=editPptx(file,{type:'element-text',slideId:'256',elementId:id,text:'A中文😀BCD\n第二段'}),doc=new OfficeXml(result.packageData.read(part)),body=children(target(doc,id),'txBody')[0];
    expect(elements(result.packageData).find(item=>item.id===id)?.text).toBe('A中文😀BCD\n第二段');expect(info(result.packageData).title).toBe('MASTER_TITLE');
    const a=drawingNamespace(doc.root.uri),paragraph=children(body,'p',a)[0],runs=children(paragraph,'r');
    expect(children(runs[0],'t')[0].text).toBe('A中文😀B');expect(attribute(children(runs[0],'rPr')[0],'b')).toBe('1');expect(children(runs[1],'t')[0].text).toBe('CD');expect(attribute(children(runs[1],'rPr')[0],'i')).toBe('1');expect(attribute(children(paragraph,'pPr')[0],'algn')).toBe('ctr');
    expect(()=>editPptx(file,{type:'element-text',slideId:'256',elementId:id,text:'bad\u0001'})).toThrow();
  });
  it('updates graphic-frame transforms and table grid in EMU while preserving cells, relationships and flip attributes',async()=>{
    let file=await fixture();const item=elements(file).find(row=>row.kind==='table')!;
    file=changed(file,doc=>[doc.setAttribute(children(target(doc,item.id),'xfrm')[0],'flipH','1'),...descendants(target(doc,item.id),'tr',drawingNamespace(doc.root.uri)).map(row=>doc.setAttribute(row,'h',String(89*12700)))]);
    const result=editPptx(file,{type:'element-transform',slideId:'256',elementId:item.id,patch:{x:-12.5,y:37.25,width:180,height:92,rotation:15.5}}),after=elements(result.packageData).find(row=>row.id===item.id)!;
    expect(after.box).toMatchObject({x:-12.5,y:37.25,width:180,height:92,rotation:15.5,flipH:true});
    const a=new OfficeXml(file.read(part)),b=new OfficeXml(result.packageData.read(part)),drawing=drawingNamespace(a.root.uri),tableA=descendants(target(a,item.id),'tbl',drawing)[0],tableB=descendants(target(b,item.id),'tbl',drawing)[0];
    expect(descendants(tableB,'tc',drawing).map(cell=>b.slice(cell))).toEqual(descendants(tableA,'tc',drawing).map(cell=>a.slice(cell)));
    expect(after.table!.widths).toEqual([90,90]);expect(after.table!.heights.reduce((a,b)=>a+b,0)).toBeCloseTo(92,7);
    expect(editPptx(result.packageData,{type:'element-transform',slideId:'256',elementId:item.id,patch:{x:-12.5,rotation:15.5}}).packageData).toBe(result.packageData);
    expect(()=>editPptx(file,{type:'element-transform',slideId:'256',elementId:item.id,patch:{width:0}})).toThrow();
  });
  it('reorders exact objects within their existing parent and treats a boundary move as a no-op',async()=>{
    const file=await fixture(),before=elements(file).filter(item=>!item.parentId),id=before[0].id;
    const front=editPptx(file,{type:'element-layer',slideId:'256',elementId:id,direction:'front'}).packageData;
    expect(elements(front).map(item=>item.id)).toEqual([...before.slice(1).map(item=>item.id),id]);
    expect(editPptx(front,{type:'element-layer',slideId:'256',elementId:id,direction:'front'}).packageData).toBe(front);
    const back=editPptx(front,{type:'element-layer',slideId:'256',elementId:id,direction:'back'}).packageData;expect(back.hashes()).toEqual(file.hashes());
    const forward=editPptx(file,{type:'element-layer',slideId:'256',elementId:id,direction:'forward'}).packageData;
    expect(elements(forward).slice(0,2).map(item=>item.id)).toEqual([before[1].id,id]);expect(editPptx(forward,{type:'element-layer',slideId:'256',elementId:id,direction:'backward'}).packageData.hashes()).toEqual(file.hashes());
  });
  it('does not invent inherited positions or silently rewrite unknown drawing nodes',async()=>{
    const original=await fixture(),id=elements(original).find(item=>item.text==='MASTER_TITLE')!.id;
    const inherited=changed(original,doc=>{const ph=descendants(target(doc,id),'ph',doc.root.uri)[0];return [doc.setAttribute(ph,'idx','4294967295')];});
    expect(elements(inherited).find(item=>item.id===id)?.box).toBeUndefined();expect(()=>editPptx(inherited,{type:'element-transform',slideId:'256',elementId:id,patch:{x:1}})).toThrow('继承');
    const unknown=changed(original,doc=>{const tree=pptxShapeTree(doc);return [{start:tree.closeStart,end:tree.closeStart,value:'<x:futureDrawing xmlns:x="urn:unknown"/>'}];});
    expect(()=>editPptx(unknown,{type:'element-layer',slideId:'256',elementId:id,direction:'front'})).toThrow('未知绘制');
    const duplicate=changed(original,doc=>{const nodes=pptxDrawingNodes(pptxShapeTree(doc)),cn=descendants(nodes[1].node,'cNvPr',doc.root.uri)[0];return [doc.setAttribute(cn,'id',id)];});
    expect(()=>new OfficePagesModel(duplicate)).toThrow('编号重复');
  });
  it('undoes and redoes full object changes at saved history identities',async()=>{
    const file=await fixture(),document=new PptxDocument(file),inserted=document.edit(0,{type:'insert-element',slideId:'256',kind:'shape',shape:'star'}),id=inserted.info.slides[0].elements!.at(-1)!.id;
    document.edit(1,{type:'element-text',slideId:'256',elementId:id,text:'完整对象恢复😀'});const snapshot=await document.materialize(2);document.acknowledge(2,snapshot.hash);
    expect(document.history(2,'undo').dirty).toBe(true);expect(document.history(3,'redo').dirty).toBe(false);document.history(4,'undo');document.history(5,'undo');expect(document.model.packageData.hashes()).toEqual(file.hashes());
  });
  it('keeps child transforms local and reorders inside a group without flattening its transform',async()=>{
    let file=editPptx(await fixture(),{type:'insert-element',slideId:'256',kind:'shape'}).packageData;file=editPptx(file,{type:'insert-element',slideId:'256',kind:'text'}).packageData;
    const ids=elements(file).slice(-2).map(item=>item.id);
    file=changed(file,doc=>{
      const one=target(doc,ids[0]),two=target(doc,ids[1]),ns=doc.root.uri,a=drawingNamespace(ns);
      const group=`<p:grpSp xmlns:p="${ns}" xmlns:a="${a}"><p:nvGrpSpPr><p:cNvPr id="1000" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="900000"><a:off x="1270000" y="635000"/><a:ext cx="5080000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="1270000"/></a:xfrm></p:grpSpPr>${doc.slice(one)}${doc.slice(two)}</p:grpSp>`;
      return [{start:one.start,end:one.start,value:group},{start:one.start,end:one.end,value:''},{start:two.start,end:two.end,value:''}];
    });
    expect(elements(file).find(item=>item.id===ids[0])?.parentId).toBe('1000');const group=elements(file).find(item=>item.id==='1000')!;
    const moved=editPptx(file,{type:'element-transform',slideId:'256',elementId:ids[0],patch:{x:37,y:24}}).packageData;
    expect(elements(moved).find(item=>item.id===ids[0])?.box).toMatchObject({x:37,y:24});expect(elements(moved).find(item=>item.id==='1000')).toEqual(group);
    const layered=editPptx(moved,{type:'element-layer',slideId:'256',elementId:ids[0],direction:'front'}).packageData;
    expect(elements(layered).filter(item=>item.parentId==='1000').map(item=>item.id)).toEqual([ids[1],ids[0]]);
    expect(editPptx(layered,{type:'element-layer',slideId:'256',elementId:ids[0],direction:'back'}).packageData.hashes()).toEqual(moved.hashes());
  });
});

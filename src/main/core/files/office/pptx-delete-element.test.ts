import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { OfficeXml,attribute,children,descendants,copyOfficeNode } from './xml';
import { drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
import { OFFICE_REL,relationshipPart } from './relationships';
const part='ppt/slides/slide1.xml',fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const chart=(file:OfficePackage)=>new OfficePagesModel(file).info.slides[0].elements!.find(element=>element.kind==='chart')!;
const node=(doc:OfficeXml,id:string)=>pptxDrawingNodes(pptxShapeTree(doc)).find(row=>pptxShapeId(row.node)===id)!.node;
const change=(file:OfficePackage,changes:Map<string,Uint8Array>)=>file.patch(changes,{changed:[...changes.keys()],added:[],removed:[]});
const add=(doc:OfficeXml,value:string)=>doc.edit([{start:pptxShapeTree(doc).closeStart,end:pptxShapeTree(doc).closeStart,value}]);
describe('PPTX object deletion and retired resource closure',()=>{
  it('retires a private chart and embedded workbook, preserves all other parts and exactly restores them with undo',async()=>{
    const file=await fixture(),id=chart(file).id,result=editPptx(file,{type:'element-delete',slideId:'256',elementId:id});
    expect([...result.plan.removed].sort()).toEqual(['ppt/charts/_rels/chart1.xml.rels','ppt/charts/chart1.xml','ppt/embeddings/chart-data.xlsx']);
    expect([...result.plan.changed].sort()).toEqual(['[Content_Types].xml','ppt/slides/_rels/slide1.xml.rels',part].sort());
    for(const [name,hash] of Object.entries(file.hashes()))if(![...result.plan.removed,...result.plan.changed].includes(name))expect(result.packageData.hashes()[name],name).toBe(hash);
    expect(new OfficePagesModel(result.packageData).info.slides[0].elements!.some(element=>element.id===id)).toBe(false);
    const document=new PptxDocument(file);document.edit(0,{type:'element-delete',slideId:'256',elementId:id});const saved=await document.materialize(1);document.history(1,'undo');expect((await OfficePackage.read((await document.materialize(2)).bytes)).hashes()).toEqual(file.hashes());document.history(2,'redo');expect((await document.materialize(3)).hash).toBe(saved.hash);
  });
  it('retains a relationship still used by another object on the same page',async()=>{
    let file=await fixture();const id=chart(file).id,doc=new OfficeXml(file.read(part)),copy=new OfficeXml(Buffer.from(copyOfficeNode(doc,node(doc,id)))),identity=descendants(copy.root,'cNvPr',doc.root.uri)[0];
    file=change(file,new Map([[part,add(doc,new OfficeXml(copy.edit([copy.setAttribute(identity,'id','990')])).source)]]));
    const result=editPptx(file,{type:'element-delete',slideId:'256',elementId:id});expect(result.plan).toEqual({changed:[part],added:[],removed:[]});expect(new OfficePagesModel(result.packageData).info.slides[0].elements!.find(element=>element.id==='990')?.kind).toBe('chart');
    expect(result.packageData.read(relationshipPart(part))).toEqual(file.read(relationshipPart(part)));expect(result.packageData.read('ppt/charts/chart1.xml')).toEqual(file.read('ppt/charts/chart1.xml'));
  });
  it('retains resources shared by another page while removing this page’s retired relationship',async()=>{
    let file=await fixture();const id=chart(file).id,doc=new OfficeXml(file.read(part)),other='ppt/slides/slide2.xml',next=new OfficeXml(file.read(other)),relsPart=relationshipPart(other),rels=new OfficeXml(file.read(relsPart));
    const raw=copyOfficeNode(doc,node(doc,id)).replaceAll('rIdChart','rIdSharedChart');
    file=change(file,new Map([[other,add(next,raw)],[relsPart,rels.edit([{start:rels.root.closeStart,end:rels.root.closeStart,value:`<Relationship xmlns="${rels.root.uri}" Id="rIdSharedChart" Type="${OFFICE_REL}/chart" Target="../charts/chart1.xml"/>`}])]]));
    const result=editPptx(file,{type:'element-delete',slideId:'256',elementId:id});expect(result.plan.removed).toEqual([]);expect([...result.plan.changed].sort()).toEqual([part,relationshipPart(part)].sort());
    expect(result.packageData.read('ppt/charts/chart1.xml')).toEqual(file.read('ppt/charts/chart1.xml'));expect(result.packageData.read(other)).toEqual(file.read(other));
  });
  it('deletes a group and its children as one history entry, or a child without deleting its parent',async()=>{
    let file=await fixture();const id=chart(file).id,doc=new OfficeXml(file.read(part)),target=node(doc,id),ns=doc.root.uri,drawing=drawingNamespace(ns),group=`<p:grpSp xmlns:p="${ns}" xmlns:a="${drawing}"><p:nvGrpSpPr><p:cNvPr id="990" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${copyOfficeNode(doc,target)}</p:grpSp>`;
    file=change(file,new Map([[part,doc.edit([{start:target.start,end:target.end,value:group}])]]));
    const child=editPptx(file,{type:'element-delete',slideId:'256',elementId:id}),whole=editPptx(file,{type:'element-delete',slideId:'256',elementId:'990'});
    expect(new OfficePagesModel(child.packageData).info.slides[0].elements!.some(element=>element.id==='990')).toBe(true);expect(new OfficePagesModel(whole.packageData).info.slides[0].elements!.some(element=>[id,'990'].includes(element.id))).toBe(false);expect([...child.plan.removed].sort()).toEqual([...whole.plan.removed].sort());
  });
  it('disconnects only the retired connector endpoint, preserving the other endpoint and geometry',async()=>{
    let file=await fixture();const doc=new OfficeXml(file.read(part)),ns=doc.root.uri,drawing=drawingNamespace(ns),id=new OfficePagesModel(file).info.slides[0].elements!.find(element=>element.text==='MASTER_TITLE')!.id,other=chart(file).id;
    const connector=`<p:cxnSp xmlns:p="${ns}" xmlns:a="${drawing}"><p:nvCxnSpPr><p:cNvPr id="990" name="Connector"/><p:cNvCxnSpPr><a:stCxn id="${id}" idx="0"/><a:endCxn id="${other}" idx="1"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12700" cy="12700"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>`;
    file=change(file,new Map([[part,add(doc,connector)]]));const prior=new OfficeXml(file.read(part)),result=editPptx(file,{type:'element-delete',slideId:'256',elementId:id}),after=new OfficeXml(result.packageData.read(part)),survivor=node(after,'990');
    expect(descendants(survivor,'stCxn',drawing)).toHaveLength(0);expect(attribute(descendants(survivor,'endCxn',drawing)[0],'id')).toBe(other);expect(after.slice(children(survivor,'spPr')[0])).toBe(prior.slice(children(node(prior,'990'),'spPr')[0]));expect(result.plan.changed).toEqual([part]);
  });
  it('refuses animation targets and unknown private relationships without a partial edit',async()=>{
    const file=await fixture(),id=chart(file).id,doc=new OfficeXml(file.read(part)),ns=doc.root.uri;
    const timing=`<p:timing xmlns:p="${ns}"><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set><p:cBhvr><p:cTn id="2"/><p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
    const animated=change(file,new Map([[part,doc.edit([{start:doc.root.closeStart,end:doc.root.closeStart,value:timing}])]])),hashes=animated.hashes();
    expect(()=>editPptx(animated,{type:'element-delete',slideId:'256',elementId:id})).toThrow('动画');expect(animated.hashes()).toEqual(hashes);
    const relPart=relationshipPart('ppt/charts/chart1.xml'),rels=new OfficeXml(file.read(relPart)),link=children(rels.root,'Relationship')[0];
    const unknown=change(file,new Map([[relPart,rels.edit([rels.setAttribute(link,'Type','urn:unknown:private-data')])]]));expect(()=>editPptx(unknown,{type:'element-delete',slideId:'256',elementId:id})).toThrow('未知依赖');expect(unknown.has('ppt/charts/chart1.xml')).toBe(true);
  });
  it('rejects stale object identity instead of deleting a replacement or another page',async()=>{
    const file=await fixture();expect(()=>editPptx(file,{type:'element-delete',slideId:'256',elementId:'4294967295'})).toThrow('已不存在');expect(()=>editPptx(file,{type:'element-delete',slideId:'9999',elementId:'2'})).toThrow('已不存在');
  });
});

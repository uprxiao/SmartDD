import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { OfficeXml,attribute,children,descendants } from './xml';
import { drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
const part='ppt/slides/slide1.xml';
const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const element=(file:OfficePackage,id:string)=>new OfficePagesModel(file).info.slides[0].elements!.find(row=>row.id===id)!;
const target=(doc:OfficeXml,id:string)=>pptxDrawingNodes(pptxShapeTree(doc)).find(row=>pptxShapeId(row.node)===id)!.node;
async function shape(content?:string){
  let file=editPptx(await fixture(),{type:'insert-element',slideId:'256',kind:'shape'}).packageData;const id=new OfficePagesModel(file).info.slides[0].elements!.at(-1)!.id;
  if(content!==undefined){const doc=new OfficeXml(file.read(part)),node=children(target(doc,id),'spPr')[0],drawing=drawingNamespace(doc.root.uri);file=file.patch(new Map([[part,doc.edit([doc.replaceContent(node,content.replaceAll('DRAWING',drawing))])]]),{changed:[part],added:[],removed:[]});}
  return {file,id};
}
describe('PPTX appearance edits',()=>{
  it('changes fill, border and geometry while preserving the body and every unrelated part; repeating it is a no-op',async()=>{
    const {file,id}=await shape(),action={type:'element-appearance',slideId:'256',elementId:id,patch:{fill:'#ab1234',border:true,borderStyle:'dashed',shape:'diamond',shadow:true}} as const;
    const before=new OfficeXml(file.read(part)),result=editPptx(file,action),after=new OfficeXml(result.packageData.read(part));
    expect(element(result.packageData,id)).toMatchObject({preset:'diamond',appearance:{fill:'#ab1234',border:true,borderStyle:'dashed',shadow:true}});
    expect(after.slice(children(target(after,id),'txBody')[0])).toBe(before.slice(children(target(before,id),'txBody')[0]));
    expect(after.slice(children(children(target(after,id),'spPr')[0],'xfrm',drawingNamespace(after.root.uri))[0])).toBe(before.slice(children(children(target(before,id),'spPr')[0],'xfrm',drawingNamespace(before.root.uri))[0]));
    for(const [name,hash] of Object.entries(file.hashes()))if(name!==part)expect(result.packageData.hashes()[name],name).toBe(hash);
    expect(editPptx(result.packageData,action).plan).toEqual({changed:[],added:[],removed:[]});
    expect(element(await OfficePackage.read(await result.packageData.bytes()),id).appearance).toEqual(element(result.packageData,id).appearance);
  });
  it('changes colour without losing alpha and preserves line endpoints, width, joins and extension data',async()=>{
    const {file,id}=await shape('<a:solidFill xmlns:a="DRAWING"><a:srgbClr val="123456"><a:alpha val="40000"/></a:srgbClr></a:solidFill><a:ln xmlns:a="DRAWING" w="38100" cap="rnd"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:custDash><a:ds d="10000" sp="20000"/></a:custDash><a:round/><a:headEnd type="triangle"/><a:tailEnd type="arrow"/><a:extLst><a:ext uri="keep"><q:data xmlns:q="urn:keep" v="1"/></a:ext></a:extLst></a:ln>');
    let result=editPptx(file,{type:'element-appearance',slideId:'256',elementId:id,patch:{fill:'#ffffff',border:false,borderStyle:'dotted'}}).packageData;
    result=editPptx(result,{type:'element-appearance',slideId:'256',elementId:id,patch:{border:true}}).packageData;
    const doc=new OfficeXml(result.read(part)),node=children(target(doc,id),'spPr')[0],drawing=drawingNamespace(doc.root.uri),line=children(node,'ln',drawing)[0];
    expect(attribute(descendants(node,'alpha',drawing)[0],'val')).toBe('40000');expect(attribute(line,'w')).toBe('38100');expect(attribute(line,'cap')).toBe('rnd');expect(children(line,'custDash',drawing)).toHaveLength(0);
    expect(children(line,'headEnd',drawing)).toHaveLength(1);expect(children(line,'tailEnd',drawing)).toHaveLength(1);expect(children(line,'round',drawing)).toHaveLength(1);expect(descendants(line,'data','urn:keep')).toHaveLength(1);
    expect(element(result,id).appearance).toMatchObject({fill:'#ffffff',border:true,borderStyle:'dotted'});
  });
  it('removes only shadow effects, preserving blur, glow, reflection, arbitrary nodes and their raw text',async()=>{
    const {file,id}=await shape('<a:effectLst xmlns:a="DRAWING"><a:blur rad="12700"/><a:glow rad="12700"><a:srgbClr val="223344"/></a:glow><a:innerShdw blurRad="100"><a:srgbClr val="000000"/></a:innerShdw><a:outerShdw><a:srgbClr val="222222"/></a:outerShdw><a:reflection/><x:opaque xmlns:x="urn:keep" flag="stay"/></a:effectLst>');
    const result=editPptx(file,{type:'element-appearance',slideId:'256',elementId:id,patch:{shadow:false}}).packageData;
    const before=new OfficeXml(file.read(part)),after=new OfficeXml(result.read(part)),drawing=drawingNamespace(after.root.uri);
    for(const local of ['blur','glow','reflection'])expect(after.slice(descendants(target(after,id),local,drawing)[0])).toBe(before.slice(descendants(target(before,id),local,drawing)[0]));
    expect(descendants(target(after,id),'innerShdw',drawing)).toHaveLength(0);expect(descendants(target(after,id),'outerShdw',drawing)).toHaveLength(0);expect(descendants(target(after,id),'opaque','urn:keep')).toHaveLength(1);expect(element(result,id).appearance?.shadow).toBe(false);
    expect(editPptx(result,{type:'element-appearance',slideId:'256',elementId:id,patch:{shadow:false}}).plan.changed).toEqual([]);
  });
  it('keeps unresolved gradients and complex effect graphs unknown and refuses destructive shadow conversion',async()=>{
    const {file,id}=await shape('<a:gradFill xmlns:a="DRAWING"><a:gsLst><a:gs pos="0"><a:srgbClr val="112233"/></a:gs></a:gsLst></a:gradFill><a:effectDag xmlns:a="DRAWING"><a:blur rad="100"/></a:effectDag>');
    expect(element(file,id).appearance).toEqual({});const hashes=file.hashes();
    expect(()=>editPptx(file,{type:'element-appearance',slideId:'256',elementId:id,patch:{shadow:false,fill:'#ffffff'}})).toThrow('复杂效果图');expect(file.hashes()).toEqual(hashes);
    const inherited=await fixture(),ph=new OfficePagesModel(inherited).info.slides[0].elements!.find(row=>row.text==='MASTER_TITLE')!;
    expect(()=>editPptx(inherited,{type:'element-appearance',slideId:'256',elementId:ph.id,patch:{shadow:true}})).toThrow('继承');
  });
  it('restores exact source parts with undo and retains redo after materialization',async()=>{
    const {file,id}=await shape(),document=new PptxDocument(file);document.edit(0,{type:'element-appearance',slideId:'256',elementId:id,patch:{fill:null,border:true,shadow:true}});const changed=await document.materialize(1);
    document.history(1,'undo');expect((await OfficePackage.read((await document.materialize(2)).bytes)).hashes()).toEqual(file.hashes());document.history(2,'redo');expect((await document.materialize(3)).hash).toBe(changed.hash);
  });
  it('rejects invalid payloads and non-shape frames without touching the original',async()=>{
    const {file,id}=await shape();for(const patch of [{},{fill:'#123'},{border:'yes'},{opacity:0.4},{shape:'unknown'},{borderStyle:'double'}])expect(()=>editPptx(file,{type:'element-appearance',slideId:'256',elementId:id,patch:patch as never})).toThrow();
    const chart=new OfficePagesModel(file).info.slides[0].elements!.find(row=>row.kind==='chart')!;expect(()=>editPptx(file,{type:'element-appearance',slideId:'256',elementId:chart.id,patch:{fill:'#ffffff'}})).toThrow('外观尚未适配');
  });
});

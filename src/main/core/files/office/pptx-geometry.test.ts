import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { editPptx } from './pptx-edit';
import { OfficeXml,attribute,children,descendants,copyOfficeNode,type XmlEdit } from './xml';
const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const slide='ppt/slides/slide1.xml',layout='ppt/slideLayouts/slideLayout2.xml',master='ppt/slideMasters/slideMaster1.xml',A='http://schemas.openxmlformats.org/drawingml/2006/main';
const title=(file:OfficePackage)=>new OfficePagesModel(file).info.slides[0].elements!.find(item=>item.text==='MASTER_TITLE')!;
const titleNode=(doc:OfficeXml)=>descendants(doc.root,'sp',doc.root.uri).find(shape=>descendants(shape,'ph',doc.root.uri).some(ph=>attribute(ph,'type')==='title'))!;
const patch=(file:OfficePackage,name:string,edit:(doc:OfficeXml)=>XmlEdit[])=>{const doc=new OfficeXml(file.read(name));return file.patch(new Map([[name,doc.edit(edit(doc))]]),{changed:[name],added:[],removed:[]});};
function explicitLayout(file:OfficePackage,extra=''){
  return patch(file,layout,doc=>[doc.replaceContent(children(titleNode(doc),'spPr')[0],`<a:xfrm xmlns:a="${A}" ${extra}><a:off x="635000" y="762000"/><a:ext cx="5080000" cy="635000"/></a:xfrm>`)]);
}
describe('PPTX placeholder geometry inheritance',()=>{
  it('resolves real slide idx through the layout to the matching master placeholder',async()=>{
    const file=await fixture(),item=title(file),doc=new OfficeXml(file.read(master)),transform=children(children(titleNode(doc),'spPr')[0],'xfrm',A)[0];
    const offset=children(transform,'off')[0],extent=children(transform,'ext')[0];
    expect(item.boxSource).toBe('master');expect(item.box).toMatchObject({x:Number(attribute(offset,'x'))/12700,y:Number(attribute(offset,'y'))/12700,width:Number(attribute(extent,'cx'))/12700,height:Number(attribute(extent,'cy'))/12700});
    expect(editPptx(file,{type:'element-transform',slideId:'256',elementId:item.id,patch:{x:item.box!.x}}).packageData).toBe(file);
  });
  it('materializes a local override without changing layout/master, dimensions or other objects',async()=>{
    const file=await fixture(),before=title(file),result=editPptx(file,{type:'element-transform',slideId:'256',elementId:before.id,patch:{x:45,y:30}}),after=title(result.packageData);
    expect(after.boxSource).toBe('local');expect(after.box).toEqual({...before.box,x:45,y:30});expect(result.plan).toEqual({changed:[slide],added:[],removed:[]});
    const hashes=file.hashes();for(const name of file.names())if(name!==slide)expect(result.packageData.hashes()[name],name).toBe(hashes[name]);
    expect(title(await OfficePackage.read(await result.packageData.bytes())).box).toEqual(after.box);
  });
  it('uses an explicit layout before the master and gives a later local override precedence',async()=>{
    const file=explicitLayout(await fixture()),item=title(file);expect(item.boxSource).toBe('layout');expect(item.box).toMatchObject({x:50,y:60,width:400,height:50});
    const changed=editPptx(file,{type:'element-transform',slideId:'256',elementId:item.id,patch:{width:500}}).packageData;
    expect(title(changed).boxSource).toBe('local');expect(title(changed).box).toMatchObject({x:50,y:60,width:500,height:50});expect(changed.read(layout).equals(file.read(layout))).toBe(true);
  });
  it('keeps partial, ambiguous or rotated inherited geometry unresolved instead of guessing',async()=>{
    const file=await fixture(),id=title(file).id;
    const rotated=explicitLayout(file,'rot="60000"');expect(title(rotated).box).toBeUndefined();expect(()=>editPptx(rotated,{type:'element-transform',slideId:'256',elementId:id,patch:{x:10}})).toThrow('尚未适配');
    const ambiguous=patch(file,layout,doc=>{const shape=titleNode(doc),raw=copyOfficeNode(doc,shape).replace(/id="\d+"/,'id="1000"');return [{start:shape.end,end:shape.end,value:raw}];});
    expect(title(ambiguous).box).toBeUndefined();
    const partial=patch(file,slide,doc=>[doc.replaceContent(children(titleNode(doc),'spPr')[0],`<a:xfrm xmlns:a="${A}" rot="0"/>`)]);expect(title(partial).box).toBeUndefined();
  });
});

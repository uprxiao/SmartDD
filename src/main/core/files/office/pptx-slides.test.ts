import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { OfficeXml,attribute,children,descendants,type XmlEdit } from './xml';
import { OFFICE_REL,relationshipKind,relationshipPart } from './relationships';
const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const A='http://schemas.openxmlformats.org/drawingml/2006/main',P14='http://schemas.microsoft.com/office/powerpoint/2010/main';
const apply=(file:OfficePackage,name:string,edits:(doc:OfficeXml)=>XmlEdit[])=>{const doc=new OfficeXml(file.read(name));return file.patch(new Map([[name,doc.edit(edits(doc))]]),{changed:[name],added:[],removed:[]});};
function part(model:OfficePagesModel,id:string){const doc=new OfficeXml(model.packageData.read(model.graph.mainPart)),entry=children(children(doc.root,'sldIdLst')[0],'sldId').find(node=>attribute(node,'id')===id)!;return model.graph.target(model.graph.mainPart,attribute(entry,'id',OFFICE_REL)!);}
const relation=(model:OfficePagesModel,source:string,kind:string)=>model.graph.forPart(source).find(row=>relationshipKind(row.type,kind))!;
describe('PPTX slide structure dependency closures',()=>{
  it('appends a new slide with the selected source layout and empty editable placeholders',async()=>{
    const file=await fixture(),before=new OfficePagesModel(file),result=editPptx(file,{type:'add',slideId:'256'}),model=new OfficePagesModel(result.packageData),newId=model.info.slides[2].id,newPart=part(model,newId);
    expect(model.info.slides.map(s=>s.id)).toEqual(['256','257',newId]);expect(newId).not.toBe('256');expect(newId).not.toBe('257');
    expect(relation(model,newPart,'slideLayout').part).toBe(relation(before,part(before,'256'),'slideLayout').part);
    const xml=new OfficeXml(result.packageData.read(newPart));expect(descendants(xml.root,'ph').length).toBeGreaterThan(0);expect(descendants(xml.root,'t',A)).toHaveLength(0);expect(model.info.slides[2].notes).toBe('');
    const hashes=file.hashes();for(const name of file.names())if(!result.plan.changed.includes(name))expect(result.packageData.hashes()[name],name).toBe(hashes[name]);
    expect(new OfficePagesModel(await OfficePackage.read(await result.packageData.bytes())).info.slides).toHaveLength(3);
  });
  it('duplicates notes, chart and embedded workbook independently while sharing immutable layout resources',async()=>{
    const file=await fixture(),before=new OfficePagesModel(file),result=editPptx(file,{type:'duplicate',slideId:'256'}),model=new OfficePagesModel(result.packageData),newId=model.info.slides[1].id,oldPart=part(before,'256'),newPart=part(model,newId);
    expect(model.info.slides[1]).toMatchObject({title:'MASTER_TITLE',notes:'SLIDE_ONE_NOTES',hidden:false});
    expect(result.packageData.read(newPart).equals(file.read(oldPart))).toBe(true);
    const oldNotes=relation(before,oldPart,'notesSlide').part!,newNotes=relation(model,newPart,'notesSlide').part!;expect(newNotes).not.toBe(oldNotes);expect(relation(model,newNotes,'slide').part).toBe(newPart);
    expect(relation(model,newPart,'slideLayout').part).toBe(relation(before,oldPart,'slideLayout').part);
    const oldChart=relation(before,oldPart,'chart').part!,newChart=relation(model,newPart,'chart').part!;expect(newChart).not.toBe(oldChart);
    const oldBook=relation(before,oldChart,'package').part!,newBook=relation(model,newChart,'package').part!;expect(newBook).not.toBe(oldBook);expect(result.packageData.read(newBook).equals(file.read(oldBook))).toBe(true);
    const changed=editPptx(result.packageData,{type:'notes',slideId:newId,text:'仅副本备注'}).packageData,after=new OfficePagesModel(changed);
    expect(after.info.slides[0].notes).toBe('SLIDE_ONE_NOTES');expect(after.info.slides[1].notes).toBe('仅副本备注');
    const hashes=file.hashes();for(const name of file.names())if(!result.plan.changed.includes(name))expect(changed.hashes()[name],name).toBe(hashes[name]);
  });
  it('deletes the clone private closure without changing originals or leaving a copied chart workbook behind',async()=>{
    const file=await fixture(),cloned=editPptx(file,{type:'duplicate',slideId:'256'}),id=new OfficePagesModel(cloned.packageData).info.slides[1].id;
    const removed=editPptx(cloned.packageData,{type:'delete',slideId:id});
    expect(new Set(removed.plan.removed)).toEqual(new Set(cloned.plan.added));
    expect(removed.packageData.hashes()).toEqual(file.hashes());
  });
  it('repairs custom shows, preserves empty sections, and removes incoming slide hyperlinks',async()=>{
    let file=await fixture();
    file=apply(file,'ppt/presentation.xml',doc=>{
      const ext=children(doc.root,'extLst')[0];
      return [{start:ext.start,end:ext.start,value:'<p:custShowLst><p:custShow name="Test" id="1"><p:sldLst><p:sld r:id="rId2"/><p:sld r:id="rId3"/><p:sld r:id="rId2"/></p:sldLst></p:custShow></p:custShowLst>'},{start:ext.closeStart,end:ext.closeStart,value:`<p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="${P14}"><p14:section name="Keep section" id="{00000000-0000-0000-0000-000000000001}"><p14:sldIdLst><p14:sldId id="256"/></p14:sldIdLst></p14:section><p14:section name="Other"><p14:sldIdLst><p14:sldId id="257"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext>`}];
    });
    file=apply(file,'ppt/slides/_rels/slide2.xml.rels',doc=>[{start:doc.root.closeStart,end:doc.root.closeStart,value:`<Relationship Id="rIdJump" Type="${OFFICE_REL}/slide" Target="slide1.xml"/>`}]);
    file=apply(file,'ppt/slides/slide2.xml',doc=>{const run=descendants(doc.root,'rPr',A)[0];return [doc.replaceContent(run,'<a:hlinkClick r:id="rIdJump" action="ppaction://hlinksldjump"/>')];});
    const result=editPptx(file,{type:'delete',slideId:'256'}),model=new OfficePagesModel(result.packageData),main=new OfficeXml(result.packageData.read(model.graph.mainPart));
    expect(model.info.slides.map(s=>s.id)).toEqual(['257']);
    expect(descendants(main.root,'sld',main.root.uri).map(n=>attribute(n,'id',OFFICE_REL))).toEqual(['rId3']);
    expect(descendants(main.root,'section',P14)).toHaveLength(2);expect(descendants(main.root,'sldId',P14).map(n=>attribute(n,'id'))).toEqual(['257']);
    expect(result.packageData.read('ppt/slides/slide2.xml').toString()).not.toContain('rIdJump');expect(model.graph.forPart('ppt/slides/slide2.xml').some(row=>row.id==='rIdJump')).toBe(false);
    expect(result.plan.removed).toContain('ppt/notesSlides/notesSlide1.xml');expect(result.plan.removed.some(name=>name.includes('chart-data'))).toBe(true);
    expect(result.packageData.has('ppt/slideMasters/slideMaster1.xml')).toBe(true);
  });
  it('inserts cloned ids in the matching section without changing custom show membership',async()=>{
    let file=await fixture();file=apply(file,'ppt/presentation.xml',doc=>{const ext=children(doc.root,'extLst')[0];return [{start:ext.closeStart,end:ext.closeStart,value:`<p:ext uri="section-test"><p14:sectionLst xmlns:p14="${P14}"><p14:section name="Section"><p14:sldIdLst><p14:sldId id="256"/><p14:sldId id="257"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext>`}];});
    const result=editPptx(file,{type:'duplicate',slideId:'256'}),model=new OfficePagesModel(result.packageData),doc=new OfficeXml(result.packageData.read('ppt/presentation.xml'));
    expect(descendants(doc.root,'sldId',P14).map(n=>attribute(n,'id'))).toEqual(model.info.slides.map(s=>s.id));
  });
  it('refuses the last slide and preserves originals when an unknown incoming object references the removed page',async()=>{
    const original=await fixture(),only=editPptx(original,{type:'delete',slideId:'256'}).packageData;
    expect(()=>editPptx(only,{type:'delete',slideId:'257'})).toThrow('至少保留');
    let file=apply(original,'ppt/slides/_rels/slide2.xml.rels',doc=>[{start:doc.root.closeStart,end:doc.root.closeStart,value:`<Relationship Id="rIdUnknown" Type="${OFFICE_REL}/slide" Target="slide1.xml"/>`}]);
    file=apply(file,'ppt/slides/slide2.xml',doc=>[{start:doc.root.closeStart,end:doc.root.closeStart,value:'<p:extLst><p:ext uri="unknown"><x:reference xmlns:x="urn:test" r:id="rIdUnknown"/></p:ext></p:extLst>'}]);
    const hashes=file.hashes();expect(()=>editPptx(file,{type:'delete',slideId:'256'})).toThrow('尚未适配');expect(file.hashes()).toEqual(hashes);
  });
  it('undoes structural changes exactly, and can redo a deleted private closure',async()=>{
    const file=await fixture(),document=new PptxDocument(file),added=document.edit(0,{type:'duplicate',slideId:'256'}),id=added.info.slides[1].id;
    const snapshot=await document.materialize(1);document.acknowledge(1,snapshot.hash);
    expect(document.edit(1,{type:'delete',slideId:id}).info.slides).toHaveLength(2);
    expect(document.history(2,'undo')).toMatchObject({dirty:false,canRedo:true});expect(document.state().info.slides).toHaveLength(3);
    document.history(3,'undo');expect(document.model.packageData.hashes()).toEqual(file.hashes());
    document.history(4,'redo');expect(document.state().info.slides[1].id).toBe(id);
  });
  it('avoids encoded-directory aliases and retains earlier clones when generating another part name',async()=>{
    const source=editPptx(await fixture(),{type:'duplicate',slideId:'256'}).packageData,changes=new Map<string,Uint8Array|null>();
    for(const name of source.names()){
      if(name.startsWith('ppt/')){changes.set(name,null);changes.set(name.replace('ppt/','ppt%20space/'),source.read(name));}
      else if(name==='[Content_Types].xml')changes.set(name,Buffer.from(source.read(name).toString().replaceAll('/ppt/','/ppt%20space/')));
      else if(name==='_rels/.rels')changes.set(name,Buffer.from(source.read(name).toString().replaceAll('ppt/','ppt%20space/')));
    }
    const file=source.patch(changes,{changed:['[Content_Types].xml','_rels/.rels'],added:[...changes.keys()].filter(name=>name.startsWith('ppt%20space/')),removed:[...changes.keys()].filter(name=>name.startsWith('ppt/'))});
    const before=new OfficePagesModel(file),oldClone=part(before,before.info.slides[1].id),hash=file.hashes()[oldClone],result=editPptx(file,{type:'duplicate',slideId:'256'}),after=new OfficePagesModel(result.packageData);
    expect(result.packageData.hashes()[oldClone]).toBe(hash);expect(after.info.slides).toHaveLength(4);expect(part(after,after.info.slides[1].id)).not.toBe(oldClone);
  });
  it('supports packages that declare relationships by explicit overrides instead of an extension default',async()=>{
    let file=await fixture();file=apply(file,'[Content_Types].xml',doc=>{
      const node=children(doc.root,'Default').find(n=>attribute(n,'Extension')==='rels')!;
      return [{start:node.start,end:node.end,value:file.names().filter(name=>name.endsWith('.rels')).map(name=>`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`).join('')}];
    });
    const result=editPptx(file,{type:'duplicate',slideId:'256'});expect(new OfficePagesModel(result.packageData).info.slides).toHaveLength(3);
    expect(new OfficeXml(result.packageData.read('[Content_Types].xml')).source).toContain('Default Extension="rels"');
  });
});

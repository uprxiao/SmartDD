import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { editPptxTextBody } from './pptx-text-edit';
import { OfficeXml, attribute, children, descendants } from './xml';
import { relationshipKind } from './relationships';
import { pptxActionSchema } from '@shared/file-pptx';

const A='http://schemas.openxmlformats.org/drawingml/2006/main';
const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const note='ppt/notesSlides/notesSlide1.xml',slide='ppt/slides/slide1.xml';
function patch(file:OfficePackage,name:string,fn:(xml:string)=>string){
  return file.patch(new Map([[name,Buffer.from(fn(file.read(name).toString()))]]),{changed:[name],added:[],removed:[]});
}
function unchanged(before:OfficePackage,after:OfficePackage,changed:readonly string[]){
  const hashes=before.hashes();
  for(const name of before.names())if(!changed.includes(name))expect(after.hashes()[name],name).toBe(hashes[name]);
}
function body(file:OfficePackage){
  const xml=new OfficeXml(file.read(note));
  const shape=descendants(xml.root,'sp').find(node=>descendants(node,'ph').some(ph=>attribute(ph,'type')==='body'))!;
  return {xml,body:children(shape,'txBody')[0]};
}
function paragraphText(xml:OfficeXml){return children(xml.root,'p',A).map(p=>descendants(p,'t',A).map(t=>t.text).join('')).join('\n');}

describe('PPTX exact slide and notes candidates',()=>{
  it('changes visibility only on the addressed slide and keeps stable ids, notes, charts and media',async()=>{
    const file=await fixture(),before=file.hashes(),result=editPptx(file,{type:'hidden',slideId:'256',hidden:true});
    expect(result.plan).toEqual({changed:[slide],added:[],removed:[]});
    expect(new OfficePagesModel(result.packageData).info.slides.map(s=>[s.id,s.hidden])).toEqual([['256',true],['257',false]]);
    unchanged(file,result.packageData,[slide]);expect(file.hashes()).toEqual(before);
    expect(editPptx(result.packageData,{type:'hidden',slideId:'256',hidden:true}).packageData).toBe(result.packageData);
  });
  it('edits Chinese, emoji and multiline notes without changing the number field or other parts',async()=>{
    const file=await fixture(),text='中文😀 <&>\n第二行\n',result=editPptx(file,{type:'notes',slideId:'256',text});
    expect(result.plan).toEqual({changed:[note],added:[],removed:[]});
    expect(new OfficePagesModel(result.packageData).info.slides[0].notes).toBe(text);
    const old=new OfficeXml(file.read(note)),next=new OfficeXml(result.packageData.read(note));
    expect(next.slice(descendants(next.root,'fld',A)[0])).toBe(old.slice(descendants(old.root,'fld',A)[0]));
    unchanged(file,result.packageData,[note]);
    const reopened=await OfficePackage.read(await result.packageData.bytes());
    expect(new OfficePagesModel(reopened).info.slides[0].notes).toBe(text);
    expect(editPptx(reopened,{type:'notes',slideId:'256',text}).packageData).toBe(reopened);
  });
  it('creates missing notes with independent back-reference, master relation and content type',async()=>{
    const original=await fixture(),relations='ppt/slides/_rels/slide1.xml.rels';
    // The fixture already has notes; remove only its relationship to model a
    // slide without notes. Existing orphan bytes must remain untouched.
    const file=patch(original,relations,xml=>{
      const doc=new OfficeXml(Buffer.from(xml)),nodes=children(doc.root,'Relationship').filter(n=>attribute(n,'Type')?.endsWith('/notesSlide'));
      return doc.edit(nodes.map(n=>({start:n.start,end:n.end,value:''}))).toString();
    });
    const result=editPptx(file,{type:'notes',slideId:'256',text:'新备注😀\n第二段'}),model=new OfficePagesModel(result.packageData);
    expect(model.info.slides[0].notes).toBe('新备注😀\n第二段');
    const relation=model.graph.forPart('ppt/slides/slide1.xml').find(r=>relationshipKind(r.type,'notesSlide'))!;
    expect(model.graph.forPart(relation.part!).some(r=>r.part==='ppt/slides/slide1.xml'&&relationshipKind(r.type,'slide'))).toBe(true);
    expect(model.graph.contentTypes.get(relation.part!)).toContain('notesSlide+xml');
    expect(result.plan.added).toHaveLength(2);
    unchanged(file,result.packageData,result.plan.changed);
  });
  it('changes local background while retaining effects, and creates an absent local background',async()=>{
    const source=await fixture(),file=patch(source,slide,xml=>xml.replace('</p:bgPr>','<a:effectLst><a:softEdge rad="12700"/></a:effectLst></p:bgPr>'));
    const result=editPptx(file,{type:'background',slideId:'256',color:'#123abc'});
    const after=result.packageData.read(slide).toString();
    expect(after).toContain('val="123ABC"');expect(after).toContain('<a:softEdge rad="12700"/>');
    unchanged(file,result.packageData,[slide]);
    expect(editPptx(result.packageData,{type:'background',slideId:'256',color:'#123AbC'}).packageData).toBe(result.packageData);
    const second=editPptx(result.packageData,{type:'background',slideId:'257',color:'#ffffff'});
    expect(second.plan.changed).toEqual(['ppt/slides/slide2.xml']);
    const xml=new OfficeXml(second.packageData.read('ppt/slides/slide2.xml')),common=children(xml.root,'cSld')[0];
    expect(common.children[0].local).toBe('bg');
    expect(attribute(descendants(common,'srgbClr',A)[0],'val')).toBe('FFFFFF');
  });
  it('rejects absent slides, protected presentations and unknown note objects without mutation',async()=>{
    const file=await fixture(),hashes=file.hashes();
    expect(()=>editPptx(file,{type:'hidden',slideId:'999',hidden:true})).toThrow('不存在');
    const protectedFile=patch(file,'ppt/presentation.xml',xml=>xml.replace('</p:presentation>','<p:modifyVerifier/></p:presentation>'));
    expect(()=>editPptx(protectedFile,{type:'hidden',slideId:'256',hidden:true})).toThrow('保护');
    const complex=patch(file,note,xml=>xml.replace('<a:t>SLIDE_ONE_NOTES</a:t>','<a:t>SLIDE_ONE_NOTES</a:t><a:unknown/>'));
    expect(()=>editPptx(complex,{type:'notes',slideId:'256',text:'changed'})).toThrow('未知文本');
    expect(file.hashes()).toEqual(hashes);
    expect(pptxActionSchema.safeParse({type:'notes',slideId:'256',text:'\ud800'}).success).toBe(false);
    expect(pptxActionSchema.safeParse({type:'notes',slideId:'256',text:'\u0001'}).success).toBe(false);
    expect(pptxActionSchema.safeParse({type:'notes',slideId:'256',text:'a'.repeat(65537)}).success).toBe(false);
  });
  it('preserves unchanged note suffix paragraphs and original rich run properties across edits',async()=>{
    const file=await fixture(),{xml,body:node}=body(file),original=children(node,'p',A)[0];
    const paragraphs='<a:p><a:pPr algn="ctr"/><a:r><a:rPr b="1"/><a:t>hello</a:t></a:r><a:r><a:rPr i="1"/><a:t>世界😀</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p><a:p><a:r><a:t>KEEP_SUFFIX</a:t></a:r></a:p>';
    const rich=file.patch(new Map([[note,xml.edit([{start:original.start,end:original.end,value:paragraphs}])]]),{changed:[note],added:[],removed:[]});
    const result=editPptx(rich,{type:'notes',slideId:'256',text:'hello新世界😁\nadded\nKEEP_SUFFIX'}),next=body(result.packageData);
    expect(new OfficePagesModel(result.packageData).info.slides[0].notes).toBe('hello新世界😁\nadded\nKEEP_SUFFIX');
    expect(next.xml.source).toContain('<a:rPr b="1"/><a:t>hello</a:t>');
    expect(next.xml.source).toContain('<a:rPr i="1"/><a:t>新世界😁</a:t>');
    expect(next.xml.source).toContain('<a:p><a:r><a:t>KEEP_SUFFIX</a:t></a:r></a:p>');
  });
  it('handles insertion/deletion at every rich-run boundary, empty paragraphs and surrogate pairs',()=>{
    const cases=[['abcdef','abXcdef'],['abcdef','abcdXef'],['abcdef','abef'],['abcdef','X'],['abcdef',''],['abcdef','abcdefEND'],['😀😃','😁😃'],['😀😃','😀😁']];
    for(const [before,after] of cases){
      const runs=[before.slice(0,2),before.slice(2,4),before.slice(4)].map(t=>`<a:r><a:rPr b="1"/><a:t>${t}</a:t></a:r>`).join('');
      const xml=new OfficeXml(Buffer.from(`<body xmlns:a="${A}"><a:p>${runs}</a:p></body>`));
      const output=new OfficeXml(xml.edit(editPptxTextBody(xml,xml.root,after,A)));
      expect(paragraphText(output),`${before} → ${after}`).toBe(after);
      expect(descendants(output.root,'rPr',A)).toHaveLength(3);
    }
    const empty=new OfficeXml(Buffer.from(`<body xmlns:a="${A}"><a:p/></body>`));
    expect(paragraphText(new OfficeXml(empty.edit(editPptxTextBody(empty,empty.root,'one\ntwo',A))))).toBe('one\ntwo');
  });
});

describe('PPTX history and save identity',()=>{
  it('keeps saved positions, undo, redo and branched histories separate',async()=>{
    const document=new PptxDocument(await fixture());
    expect(document.edit(0,{type:'hidden',slideId:'256',hidden:false})).toMatchObject({version:0,dirty:false});
    document.edit(0,{type:'notes',slideId:'256',text:'first'});
    const saved=await document.materialize(1);
    expect(document.acknowledge(1,saved.hash)).toMatchObject({dirty:false});
    expect(document.history(1,'undo')).toMatchObject({version:2,dirty:true,canRedo:true});
    expect(document.history(2,'redo')).toMatchObject({version:3,dirty:false});
    document.history(3,'undo');
    expect(document.edit(4,{type:'notes',slideId:'256',text:'branch'})).toMatchObject({version:5,dirty:true,canRedo:false});
    expect(()=>document.acknowledge(1,saved.hash)).toThrow('不一致');
    expect(()=>document.edit(1,{type:'hidden',slideId:'256',hidden:true})).toThrow('版本');
  });
  it('never assigns a compressed old snapshot to an edit made while compression is pending',async()=>{
    const file=await fixture(),document=new PptxDocument(file),bytes=await file.bytes();let complete!:(bytes:Buffer)=>void;
    const spy=vi.spyOn(file,'bytes').mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    const pending=document.materialize(0);
    document.edit(0,{type:'notes',slideId:'256',text:'newer'});complete(bytes);
    await expect(pending).rejects.toThrow('版本');spy.mockRestore();
    const current=await document.materialize(1);
    expect(new OfficePagesModel(await OfficePackage.read(current.bytes)).info.slides[0].notes).toBe('newer');
    expect(()=>document.acknowledge(1,'0'.repeat(64))).toThrow('不一致');
    expect(document.state().dirty).toBe(true);
  });
  it('restores a candidate as undoable content and retains the original package',async()=>{
    const original=await fixture(),edited=editPptx(original,{type:'hidden',slideId:'257',hidden:true}).packageData,document=new PptxDocument(original);
    expect(document.restore(0,edited)).toMatchObject({version:1,dirty:true,canUndo:true});
    expect(document.state().info.slides[1].hidden).toBe(true);
    expect(document.history(1,'undo')).toMatchObject({dirty:false});
    expect(document.state().info.slides[1].hidden).toBe(false);
  });
});

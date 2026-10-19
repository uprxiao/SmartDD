import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficePagesModel } from './pages-model';
import { PptxDocument } from './pptx-document';
import { editPptx } from './pptx-edit';
import { OfficeXml,children,attribute,descendants } from './xml';
import { drawingNamespace,pptxDrawingNodes,pptxShapeId,pptxShapeTree } from './pptx-elements';
const part='ppt/slides/slide1.xml';
const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx'));
const info=(file:OfficePackage)=>new OfficePagesModel(file).info.slides[0];
const target=(doc:OfficeXml,id:string)=>pptxDrawingNodes(pptxShapeTree(doc)).find(row=>pptxShapeId(row.node)===id)!.node;
async function withBody(content:string){
  let file=editPptx(await fixture(),{type:'insert-element',slideId:'256',kind:'text'}).packageData;const id=info(file).elements!.at(-1)!.id,doc=new OfficeXml(file.read(part)),body=children(target(doc,id),'txBody')[0],drawing=drawingNamespace(doc.root.uri);
  file=file.patch(new Map([[part,doc.edit([doc.replaceContent(body,`<a:bodyPr xmlns:a="${drawing}" anchor="ctr"/><a:lstStyle xmlns:a="${drawing}"/>${content.replaceAll('DRAWING',drawing)}`)])]]),{changed:[part],added:[],removed:[]});return {file,id};
}
describe('PPTX real text format patches',()=>{
  it('distinguishes mixed rich runs and unresolved theme properties without inventing defaults',async()=>{
    const {file,id}=await withBody('<a:p xmlns:a="DRAWING"><a:pPr><a:defRPr sz="2400"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:r><a:rPr b="1"/><a:t>A</a:t></a:r><a:r><a:rPr b="0"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>B</a:t></a:r></a:p>');
    expect(info(file).elements!.find(element=>element.id===id)!.textStyle).toEqual({points:24,mixed:['family','bold','color']});
  });
  it('formats every run and future insertion defaults while retaining original text, extensions and unrelated parts',async()=>{
    const {file,id}=await withBody('<a:p xmlns:a="DRAWING" xmlns:u="urn:keep"><a:pPr lvl="0" marL="12345"><a:spcAft><a:spcPts val="400"/></a:spcAft><a:buChar char="–"/></a:pPr><a:r><a:rPr lang="zh-CN" baseline="12000"><a:effectLst/><a:hlinkClick action="keep"/><a:extLst><a:ext uri="test"><u:tag value="unchanged"/></a:ext></a:extLst></a:rPr><a:t>中文😀</a:t></a:r><a:r><a:rPr i="0"/><a:t> keep</a:t></a:r></a:p>');
    const patch={font:{family:'Arial',points:22.5,bold:true,italic:true,underline:true,strike:true,color:'#1234ab'},align:'right',list:'number'} as const;
    const result=editPptx(file,{type:'element-format',slideId:'256',elementId:id,patch}),after=info(result.packageData).elements!.find(element=>element.id===id)!;
    expect(after.text).toBe('中文😀 keep');expect(after.textStyle).toEqual({family:'Arial',points:22.5,bold:true,italic:true,underline:true,strike:true,color:'#1234ab',align:'right',list:'number'});
    const doc=new OfficeXml(result.packageData.read(part)),drawing=drawingNamespace(doc.root.uri),body=children(target(doc,id),'txBody')[0],p=children(body,'p',drawing)[0],ppr=children(p,'pPr')[0],runs=children(p,'r');
    expect(attribute(children(body,'bodyPr',drawing)[0],'anchor')).toBe('ctr');expect(attribute(ppr,'marL')).toBe('12345');expect(descendants(body,'tag','urn:keep')).toHaveLength(1);
    expect(attribute(children(runs[0],'rPr')[0],'lang')).toBe('zh-CN');expect(attribute(children(runs[0],'rPr')[0],'baseline')).toBe('12000');expect(descendants(body,'hlinkClick',drawing)).toHaveLength(1);
    expect(children(ppr,'defRPr')[0]).toBeTruthy();expect(children(p,'endParaRPr')[0]).toBeTruthy();expect(children(ppr,'buChar')).toHaveLength(0);
    const hashes=file.hashes();for(const name of file.names())if(name!==part)expect(result.packageData.hashes()[name],name).toBe(hashes[name]);
    expect(info(await OfficePackage.read(await result.packageData.bytes())).elements!.find(element=>element.id===id)!.textStyle).toEqual(after.textStyle);
    expect(editPptx(result.packageData,{type:'element-format',slideId:'256',elementId:id,patch}).plan).toEqual({changed:[],added:[],removed:[]});
  });
  it('preserves soft breaks/fields and supports empty paragraph defaults, explicit false and font inheritance reset',async()=>{
    const {file,id}=await withBody('<a:p xmlns:a="DRAWING"/><a:p xmlns:a="DRAWING"><a:fld id="field-identity" type="slidenum"><a:rPr lang="en-US"/><a:t>1</a:t></a:fld><a:br><a:rPr sz="2000"/></a:br><a:r><a:t>tail</a:t></a:r></a:p>');
    const formatted=editPptx(file,{type:'element-format',slideId:'256',elementId:id,patch:{font:{family:'Georgia',bold:true,underline:true},list:'bullet'}}).packageData;
    const reset=editPptx(formatted,{type:'element-format',slideId:'256',elementId:id,patch:{font:{family:null,bold:false,italic:false,underline:false,strike:false},list:'none'}}).packageData;
    const element=info(reset).elements!.find(element=>element.id===id)!;expect(element.text).toBe('\n1\ntail');expect(element.textStyle).toMatchObject({bold:false,italic:false,underline:false,strike:false,list:'none'});expect(element.textStyle?.family).toBeUndefined();
    const doc=new OfficeXml(reset.read(part)),body=children(target(doc,id),'txBody')[0],drawing=drawingNamespace(doc.root.uri);
    expect(descendants(body,'latin',drawing)).toHaveLength(0);expect(descendants(body,'br',drawing)).toHaveLength(1);expect(attribute(descendants(body,'fld',drawing)[0],'id')).toBe('field-identity');expect(descendants(body,'defRPr',drawing)).toHaveLength(2);
  });
  it('preserves East Asian and complex-script faces when choosing a Latin font or restoring its inheritance',async()=>{
    const {file,id}=await withBody('<a:p xmlns:a="DRAWING"><a:r><a:rPr><a:latin typeface="Georgia"/><a:ea typeface="PingFang SC"/><a:cs typeface="Geeza Pro"/></a:rPr><a:t>中文 العربية Latin</a:t></a:r></a:p>');
    let edited=editPptx(file,{type:'element-format',slideId:'256',elementId:id,patch:{font:{family:'Arial'}}}).packageData;
    for(const reset of [false,true]){
      if(reset)edited=editPptx(edited,{type:'element-format',slideId:'256',elementId:id,patch:{font:{family:null}}}).packageData;
      const doc=new OfficeXml(edited.read(part)),body=children(target(doc,id),'txBody')[0],drawing=drawingNamespace(doc.root.uri);
      expect(attribute(descendants(body,'ea',drawing)[0],'typeface')).toBe('PingFang SC');expect(attribute(descendants(body,'cs',drawing)[0],'typeface')).toBe('Geeza Pro');
      expect(descendants(body,'ea',drawing)).toHaveLength(1);expect(descendants(body,'cs',drawing)).toHaveLength(1);expect(info(edited).elements!.find(element=>element.id===id)?.text).toBe('中文 العربية Latin');
    }
  });
  it('rejects invalid format payloads and non-text objects without changing any part',async()=>{
    const file=await fixture(),id=info(file).elements!.find(element=>element.kind==='chart')!.id;
    for(const patch of [{},{font:{}},{font:{points:0}},{font:{family:'bad\u0000'}},{font:{color:'#12'}},{align:'unknown'}])expect(()=>editPptx(file,{type:'element-format',slideId:'256',elementId:id,patch:patch as never})).toThrow();
    expect(()=>editPptx(file,{type:'element-format',slideId:'256',elementId:id,patch:{font:{bold:true}}})).toThrow('普通文本框');
  });
  it('undoes formatting to the exact original package and keeps redo after native candidate materialization',async()=>{
    const file=await fixture(),id=info(file).elements!.find(element=>element.text==='MASTER_TITLE')!.id,document=new PptxDocument(file);
    document.edit(0,{type:'element-format',slideId:'256',elementId:id,patch:{font:{points:32,color:'#ab1234'},align:'center'}});const edited=await document.materialize(1);
    document.history(1,'undo');const restored=await document.materialize(2);expect((await OfficePackage.read(restored.bytes)).hashes()).toEqual(file.hashes());
    document.history(2,'redo');expect((await document.materialize(3)).hash).toBe(edited.hash);
  });
});

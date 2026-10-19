import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { editOfficeFormats } from './format-edit';
import { editOfficeRange } from './range-edit';
import { OfficeXml,attribute,children,descendants } from './xml';

const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
const range=(r1:number,c1:number,r2=r1,c2=c1)=>({firstRow:r1,firstColumn:c1,lastRow:r2,lastColumn:c2});
const patch=(file:OfficePackage,raw:[string,string][])=>{const data=raw.filter(([name,text])=>!file.has(name) || file.read(name).toString()!==text);return file.patch(new Map(data.map(([path,xml])=>[path,Buffer.from(xml)])),{changed:data.filter(([path])=>file.has(path)).map(([path])=>path),added:data.filter(([path])=>!file.has(path)).map(([path])=>path),removed:[]});};
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const styles=`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><color theme="1"/></font><font><b/><sz val="15"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="14" fontId="1" fillId="0" borderId="0"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`;
describe('precise format copies and inherited styles',()=>{
  it('changes shared font/fill/border/xf references only inside the range, preserving original resources and formula caches',async()=>{
    const original=await fixture(),before=new OfficeWorkbook(original),input={font:{bold:true,color:'#123456',points:14},fill:'#fff0c8',border:true,alignment:{horizontal:'center' as const,wrap:true}};
    const changed=editOfficeFormats(original,'1',range(1,1,2,1),input),model=new OfficeWorkbook(await OfficePackage.read(await changed.bytes()));
    expect(model.cell('1',1,1).value).toBe('3');expect(model.cell('1',2,1).style).toBe(model.cell('1',1,1).style);
    expect(model.styles.get(model.cell('1',1,1).style)).toMatchObject({font:{bold:true,color:'#123456',points:14},fill:'#FFF0C8',borders:{left:{style:'thin',color:'#557B73'}},alignment:{horizontal:'center',wrap:true}});
    expect(model.cell('1',0,0)).toEqual(before.cell('1',0,0));
    const old=new OfficeXml(original.read('xl/styles.xml')),next=new OfficeXml(changed.read('xl/styles.xml'));
    for(const table of ['fonts','fills','borders','cellXfs']){const a=children(old.root,table)[0],b=children(next.root,table)[0];expect(b.children.slice(0,a.children.length).map(node=>next.slice(node)),table).toEqual(a.children.map(node=>old.slice(node)));}
    for(const name of original.names())if(!['xl/styles.xml','xl/worksheets/sheet1.xml'].includes(name))expect(changed.read(name),name).toEqual(original.read(name));
    expect(editOfficeFormats(changed,'1',range(1,1,2,1),input)).toBe(changed);
  });
  it('preserves numeric storage and unrelated date formats while changing display type and precision',async()=>{
    let source=await fixture();source=patch(source,[['xl/styles.xml',styles],['xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1"><v>0.1234</v></c><c r="B1" s="1"><v>45292</v></c></row></sheetData></worksheet>`]]);
    const percent=editOfficeFormats(source,'1',range(0,0),{numberFormat:'percent',decimals:2});let model=new OfficeWorkbook(percent);
    expect(model.window('1',0,0,1,2).cells.map(cell=>cell.display)).toEqual(['12.34%','1/1/24']);expect(model.cell('1',0,0).value).toBe('0.1234');
    const font=editOfficeFormats(percent,'1',range(0,1),{font:{color:'#abcdef'}});model=new OfficeWorkbook(font);expect(model.styles.get(model.cell('1',0,1).style).numberFormat).toBe(14);
    expect(()=>editOfficeFormats(font,'1',range(0,1),{decimals:3})).toThrow('自定义格式');
    const currency=editOfficeFormats(font,'1',range(0,0),{numberFormat:'currency',decimals:3});model=new OfficeWorkbook(currency);expect(model.window('1',0,0,1,1).cells[0].display).toBe('¥0.123');
    expect(new OfficeWorkbook(editOfficeFormats(currency,'1',range(0,0),{numberFormat:'general'})).cell('1',0,0).value).toBe('0.1234');
  });
  it('resolves column then row default styles, respects explicit zero and clears inherited styles without editing whole rows/columns',async()=>{
    const original=await fixture(),sheet=`<worksheet xmlns="${ns}"><cols><col min="2" max="2" style="2" width="12"/></cols><sheetData><row r="1" s="1" customFormat="1"><c r="A1"><v>45292</v></c><c r="B1"><v>0.5</v></c><c r="C1" s="0"><v>2</v></c></row><row r="2" s="1" customFormat="1"/></sheetData></worksheet>`;
    const source=patch(original,[['xl/styles.xml',styles],['xl/worksheets/sheet1.xml',sheet]]),before=new OfficeWorkbook(source);
    expect([before.cell('1',0,0).style,before.cell('1',0,1).style,before.cell('1',0,2).style,before.cell('1',1,0).style,before.cell('1',1,1).style]).toEqual([1,2,0,1,2]);
    const cleared=editOfficeRange(source,{type:'clear',mode:'format',sheetId:'1',range:range(0,1,1,1)}),model=new OfficeWorkbook(cleared);
    expect(model.cell('1',0,1)).toMatchObject({style:0,value:'0.5'});expect(model.cell('1',1,1).style).toBe(0);expect(model.cell('1',1,0).style).toBe(1);
    const xml=cleared.read('xl/worksheets/sheet1.xml').toString();expect(xml).toContain('<col min="2" max="2" style="2" width="12"/>');expect(xml).toContain('<row r="1" s="1" customFormat="1">');expect(cleared.read('xl/styles.xml')).toEqual(source.read('xl/styles.xml'));
  });
  it('copies a rich shared string for the selected cell and preserves neighboring text/runs and unknown run metadata',async()=>{
    const original=await fixture(),rel='xl/_rels/workbook.xml.rels',types='[Content_Types].xml',sheet='xl/worksheets/sheet1.xml';
    const source=patch(original,[[rel,original.read(rel).toString().replace('</Relationships>','<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')],[types,original.read(types).toString().replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')],['xl/sharedStrings.xml',`<sst xmlns="${ns}" xmlns:k="urn:keep" count="2" uniqueCount="1"><si><r><rPr><b/><i/><k:original/></rPr><t xml:space="preserve">中文 </t></r><r><t>😀</t></r></si></sst>`],[sheet,`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row></sheetData></worksheet>`]]);
    const changed=editOfficeFormats(source,'1',range(0,0),{font:{bold:false,color:'#aa3300'}}),doc=new OfficeXml(changed.read('xl/sharedStrings.xml')),items=children(doc.root,'si'),model=new OfficeWorkbook(changed);
    expect(items).toHaveLength(2);expect(attribute(doc.root,'count')).toBe('2');expect(attribute(doc.root,'uniqueCount')).toBe('2');expect(doc.slice(items[0])).toBe(new OfficeXml(source.read('xl/sharedStrings.xml')).slice(items[0]));
    expect(descendants(items[1],'b').map(node=>attribute(node,'val'))).toEqual(['0','0']);expect(descendants(items[1],'i')).toHaveLength(1);expect(descendants(items[1],'original','urn:keep')).toHaveLength(1);
    expect(model.window('1',0,0,1,2).cells[0].runs).toMatchObject([{text:'中文 ',font:{bold:false,italic:true,color:'#AA3300'}},{text:'😀',font:{bold:false,color:'#AA3300'}}]);
    expect(model.cell('1',0,0).value).toBe('中文 😀');expect(model.cell('1',0,1).value).toBe('中文 😀');
    const cleared=editOfficeRange(changed,{type:'clear',mode:'format',sheetId:'1',range:range(0,0)}),clearDoc=new OfficeXml(cleared.read('xl/sharedStrings.xml')),clearItems=children(clearDoc.root,'si');
    expect(descendants(clearItems.at(-1)!,'b')).toHaveLength(0);expect(descendants(clearItems.at(-1)!,'i')).toHaveLength(0);expect(descendants(clearItems.at(-1)!,'original','urn:keep')).toHaveLength(1);
    expect(new OfficeWorkbook(cleared).cell('1',0,1).style).toBe(0);
  });
  it('retains inherited xf fields and unknown attributes while overriding only explicit font/alignment choices',async()=>{
    const original=await fixture(),styleXml=styles.replace('<xf numFmtId="14" fontId="1" fillId="0" borderId="0"/>','<xf numFmtId="14" fontId="1" fillId="0" borderId="0" applyFont="0" custom="retain"><alignment horizontal="right" indent="2"/><protection locked="0"/></xf>');
    const source=patch(original,[['xl/styles.xml',styleXml],['xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" s="1"><v>45292</v></c></row></sheetData></worksheet>`]]);
    const before=new OfficeWorkbook(source);expect(before.styles.get(1).font?.bold).toBe(false);
    const changed=editOfficeFormats(source,'1',range(0,0),{font:{italic:true},alignment:{wrap:true}}),model=new OfficeWorkbook(changed),style=model.styles.get(model.cell('1',0,0).style);
    expect(style).toMatchObject({font:{family:'Calibri',bold:false,italic:true},alignment:{horizontal:'right',indent:2,wrap:true},numberFormat:14});
    const doc=new OfficeXml(changed.read('xl/styles.xml')),last=children(children(doc.root,'cellXfs')[0],'xf').at(-1)!;expect(attribute(last,'custom')).toBe('retain');expect(attribute(children(last,'protection')[0],'locked')).toBe('0');
  });
  it('adds a missing styles part with valid relationships and preserves original bytes on rejection',async()=>{
    const original=await fixture(),relations='xl/_rels/workbook.xml.rels',types='[Content_Types].xml',r=new OfficeXml(original.read(relations)),t=new OfficeXml(original.read(types)),rr=r.root.children.find(node=>attribute(node,'Target')?.includes('styles'))!,tt=t.root.children.find(node=>attribute(node,'PartName')==='/xl/styles.xml')!;
    const noStyles=original.patch(new Map([[relations,r.edit([{start:rr.start,end:rr.end,value:''}])],[types,t.edit([{start:tt.start,end:tt.end,value:''}])],['xl/styles.xml',null]]),{changed:[relations,types],added:[],removed:['xl/styles.xml']});
    expect(()=>new OfficeWorkbook(noStyles)).toThrow('样式索引');
    const source=patch(noStyles,noStyles.names().filter(name=>/^xl\/worksheets\/sheet[0-9]+\.xml$/.test(name)).map(name=>{const xml=new OfficeXml(noStyles.read(name));return [name,xml.edit(descendants(xml.root,'c').filter(node=>attribute(node,'s')!==undefined).map(node=>xml.setAttribute(node,'s','0'))).toString()];}));
    const changed=editOfficeFormats(source,'1',range(2,1),{font:{bold:true}}),model=new OfficeWorkbook(await OfficePackage.read(await changed.bytes()));expect(model.styles.get(model.cell('1',2,1).style).font?.bold).toBe(true);expect(changed.has('xl/styles.xml')).toBe(true);
    const hashes=source.hashes();expect(()=>editOfficeFormats(source,'1',range(0,0),{font:{points:1000}})).toThrow();expect(source.hashes()).toEqual(hashes);
  });
});

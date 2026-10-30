import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeDocument } from './document';
import { editOfficeSheet } from './sheet-edit';
import { OfficeXml,attribute,children,descendants } from './xml';

const fixture=async()=>OfficePackage.read(await readFile('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
const patchBook=(file:OfficePackage,text:string)=>file.patch(new Map([['xl/workbook.xml',Buffer.from(text)]]),{changed:['xl/workbook.xml'],added:[],removed:[]});
describe('precise worksheet addition and reordering',()=>{
  it('adds a real empty worksheet with distinct relationships/names and preserves every existing sheet and resource',async()=>{
    const original=await fixture(),before=original.hashes(),first=editOfficeSheet(original,{type:'add'});
    expect([...first.plan.changed].sort()).toEqual(['[Content_Types].xml','xl/_rels/workbook.xml.rels','xl/workbook.xml']);
    expect(first.plan.added).toHaveLength(1);expect(first.plan.removed).toEqual([]);
    const reopened=await OfficePackage.read(await first.packageData.bytes()),model=new OfficeWorkbook(reopened);
    expect(model.info.sheets.at(-1)).toMatchObject({id:first.sheetId,name:'Sheet1',rows:0,columns:0,hidden:'visible'});
    expect(model.cell(first.sheetId,0,0)).toMatchObject({type:'blank',value:''});
    for(const name of original.names()) if(!first.plan.changed.includes(name)) expect(reopened.read(name),name).toEqual(original.read(name));
    const second=editOfficeSheet(reopened,{type:'add'}),secondModel=new OfficeWorkbook(second.packageData);
    expect(secondModel.info.sheets.at(-1)?.name).toBe('Sheet2');expect(second.sheetId).not.toBe(first.sheetId);
    expect(original.hashes()).toEqual(before);
  });
  it('preserves sheet identities for local names, implicit and explicit views while only reordering raw sheet nodes',async()=>{
    const original=await fixture(),raw=new OfficeXml(original.read('xl/workbook.xml'));
    const additions='<customWorkbookViews><customWorkbookView name="Keep" guid="{12345678-1234-1234-1234-123456789ABC}" activeSheetId="1"/></customWorkbookViews>';
    const source=patchBook(original,raw.source.replace(/<bookViews>[\s\S]*?<\/bookViews>/,'<bookViews><workbookView/><workbookView activeTab="1" firstSheet="2"/></bookViews>').replace('</workbook>',additions+'</workbook>'));
    const before=new OfficeXml(source.read('xl/workbook.xml')),result=editOfficeSheet(source,{type:'move',sheetId:'1',index:2}),after=new OfficeXml(result.packageData.read('xl/workbook.xml'));
    expect(new OfficeWorkbook(result.packageData).info.sheets.map(sheet=>sheet.id)).toEqual(['2','3','1']);
    const map=[2,0,1],oldNames=descendants(before.root,'definedName'),newNames=descendants(after.root,'definedName');
    oldNames.forEach((name,index)=>{const local=attribute(name,'localSheetId');expect(attribute(newNames[index],'localSheetId')).toBe(local === undefined ? undefined : String(map[Number(local)]));expect(newNames[index].text).toBe(name.text);});
    const views=descendants(after.root,'workbookView');expect(attribute(views[0],'activeTab')).toBe('2');expect(attribute(views[0],'firstSheet')).toBe('2');
    expect(attribute(views[1],'activeTab')).toBe('0');expect(attribute(views[1],'firstSheet')).toBe('1');
    expect(attribute(descendants(after.root,'customWorkbookView')[0],'activeSheetId')).toBe('1');
    expect(result.plan).toEqual({changed:['xl/workbook.xml'],added:[],removed:[]});
    for(const name of source.names()) if(name !== 'xl/workbook.xml') expect(result.packageData.read(name),name).toEqual(source.read(name));
    expect(children(children(after.root,'sheets')[0],'sheet').map(node=>after.slice(node)).sort()).toEqual(children(children(before.root,'sheets')[0],'sheet').map(node=>before.slice(node)).sort());
  });
  it('supports prefixed workbook XML and inserts calculation settings before later schema elements',async()=>{
    const original=await fixture(),raw=new OfficeXml(original.read('xl/workbook.xml'));
    let text=raw.source.replace(/<calcPr\b[^>]*\/>/,'').replace('</workbook>','<customWorkbookViews/></workbook>');
    text=text.replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g,'<$1x:$2').replace('<x:workbook ','<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ');
    const result=editOfficeSheet(patchBook(original,text),{type:'add'}),book=new OfficeXml(result.packageData.read('xl/workbook.xml'));
    expect(book.root.children.map(node=>node.local).indexOf('calcPr')).toBeLessThan(book.root.children.map(node=>node.local).indexOf('customWorkbookViews'));
    expect(new OfficeWorkbook(await OfficePackage.read(await result.packageData.bytes())).info.sheets).toHaveLength(4);
  });
  it('rejects locked structure, stale identities and invalid indexes without modifying the original',async()=>{
    const original=await fixture(),text=original.read('xl/workbook.xml').toString(),hashes=original.hashes();
    const locked=patchBook(original,text.replace('<sheets>','<workbookProtection lockStructure="1"/><sheets>'));
    expect(()=>editOfficeSheet(locked,{type:'add'})).toThrow('结构受保护');
    expect(()=>editOfficeSheet(original,{type:'move',sheetId:'missing',index:0})).toThrow('不存在');
    expect(()=>editOfficeSheet(original,{type:'move',sheetId:'1',index:3})).toThrow('位置无效');
    expect(editOfficeSheet(original,{type:'move',sheetId:'1',index:0}).packageData).toBe(original);
    const windowsOnly=patchBook(original,text.replace('<sheets>','<workbookProtection lockWindows="1"/><sheets>'));
    expect(new OfficeWorkbook(editOfficeSheet(windowsOnly,{type:'add'}).packageData).info.sheets).toHaveLength(4);
    expect(original.hashes()).toEqual(hashes);
  });
  it('keeps structural history and save receipts consistent through add, move, undo and redo',async()=>{
    const doc=new OfficeDocument(await fixture()),added=doc.sheetAction(0,{type:'add'});
    expect(added.state).toMatchObject({version:1,dirty:true,canUndo:true});
    doc.sheetAction(1,{type:'move',sheetId:added.sheetId,index:0});
    const saved=await doc.materialize(2);doc.acknowledge(2,saved.hash);
    expect(doc.state().dirty).toBe(false);expect(doc.workbook.info.sheets[0].id).toBe(added.sheetId);
    doc.undo(2,'undo');expect(doc.state().dirty).toBe(true);expect(doc.workbook.info.sheets.at(-1)?.id).toBe(added.sheetId);
    doc.undo(3,'undo');expect(doc.workbook.info.sheets).toHaveLength(3);
    doc.undo(4,'redo');doc.undo(5,'redo');expect(doc.state().dirty).toBe(false);
    expect(()=>doc.sheetAction(1,{type:'add'})).toThrow('版本已改变');
  });
  it('renames real formula dependencies without normalizing structured references or rewriting literal INDIRECT arguments',async()=>{
    const original=await fixture(),result=editOfficeSheet(original,{type:'rename',sheetId:'1',name:"新表 O'Brien😀"}),model=new OfficeWorkbook(result.packageData);
    expect(model.info.sheets[0]).toMatchObject({id:'1',name:"新表 O'Brien😀"});
    expect(model.cell('2',1,1).formula?.text).toBe("'新表 O''Brien😀'!$B$2+'新表 O''Brien😀'!B3");
    expect(model.cell('2',8,1).formula?.text).toBe('SUM(Sales[Value])');
    expect(model.cell('2',10,1).formula?.text).toBe("'新表 O''Brien😀'!B2*2");
    expect(model.cell('2',11,1).formula?.text).toBe("'新表 O''Brien😀'!B3*2");
    expect(model.cell('2',15,1).formula?.text).toContain('"Data!B2"');
    expect(model.cell('2',2,3).value).toBe('');
    const book=new OfficeXml(result.packageData.read('xl/workbook.xml'));
    expect(descendants(book.root,'definedName').some(node=>node.text.includes("'新表 O''Brien😀'!"))).toBe(true);
    for(const name of original.names())if(!result.plan.changed.includes(name)&&!result.plan.removed.includes(name))expect(result.packageData.read(name),name).toEqual(original.read(name));
    const restored=await OfficePackage.read(await result.packageData.bytes());expect(new OfficeWorkbook(restored).cell('2',11,1).formula?.text).toBe(model.cell('2',11,1).formula?.text);
  });
  it('rejects invalid/colliding sheet names and keeps same-name rename a no-op',async()=>{
    const original=await fixture(),hashes=original.hashes();
    for(const name of ['', 'x'.repeat(32),'bad/name',"'bad",'bad\0name','calc'])expect(()=>editOfficeSheet(original,{type:'rename',sheetId:'1',name})).toThrow();
    expect(editOfficeSheet(original,{type:'rename',sheetId:'1',name:'Data'}).packageData).toBe(original);
    expect(original.hashes()).toEqual(hashes);
  });
});

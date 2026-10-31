import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';
import {OfficePackage} from './package';
import {OfficeWorkbook} from './workbook';
import {OfficeDocument} from './document';
import {OfficeXml,children,attribute,descendants} from './xml';
import {insertWorkbookDrawing} from './workbook-drawing-insert';
import {editWorkbookDrawingText} from './workbook-drawing-text';
import type {OfficeFloatingVector} from '@shared/file-office';
const source=()=>readFile(new URL('./__fixtures__/ordinary-drawing.xlsx',import.meta.url)).then(bytes=>OfficePackage.read(bytes));
const range={firstRow:1,lastRow:1,firstColumn:1,lastColumn:1},frame={x:125.5,y:74,width:233,height:99};
const text=(file:OfficePackage,sheetId='1')=>new OfficeWorkbook(file).window(sheetId,0,0,1,1).objects!.find((value):value is OfficeFloatingVector=>value.kind==='shape'&&value.shape?.textBox===true)!;
describe('worksheet text-box placement, text and original package protection',()=>{
  it.each([false,true])('creates an actual text box and retains the placement/autosize=%s through text, history and complete reopen',async autoSize=>{
    const original=await source(),inserted=insertWorkbookDrawing(original,{kind:'text',sheetId:'1',range,frame,autoSize}),object=text(inserted.packageData);
    expect(object).toMatchObject({kind:'shape',shape:{textBox:true,text:''},anchor:{kind:'absoluteAnchor',position:{y:74},extent:{width:233,height:99}}});
    expect(object.anchor.kind).toBe('absoluteAnchor');if(object.anchor.kind!=='absoluteAnchor')throw new Error('expected absolute text frame');expect(object.anchor.position.x).toBeCloseTo(125.5,3); // OOXML positions are integral EMUs (1/9525 px).
    const drawing=new OfficeXml(inserted.packageData.read(inserted.object.part)),uri='http://schemas.openxmlformats.org/drawingml/2006/main';
    expect(descendants(drawing.root,autoSize?'spAutoFit':'noAutofit',uri)).toHaveLength(1);
    const value='中文 & <hello> 😀\n_x000A_\r\t\ud800',doc=new OfficeDocument(inserted.packageData),candidate=await doc.prepareRange(0,{type:'drawing-text',sheetId:'1',objectId:object.id,text:value});doc.commitRange(0,candidate.token);
    const changed=doc.workbook.packageData;expect(text(changed)).toMatchObject({id:object.id,shape:{text:value}});
    for(const part of inserted.packageData.names())if(part!==object.source.part)expect(changed.read(part),part).toEqual(inserted.packageData.read(part));
    const reopened=await OfficePackage.read((await doc.materialize(1)).bytes);expect(text(reopened)).toMatchObject({id:object.id,shape:{text:value}});
    doc.undo(1,'undo');expect(doc.workbook.packageData.hashes()).toEqual(inserted.packageData.hashes());doc.undo(2,'redo');expect(text(doc.workbook.packageData)).toMatchObject({shape:{text:value}});
    expect(original.read('xl/media/image1.png')).toEqual(changed.read('xl/media/image1.png'));expect(editWorkbookDrawingText(changed,{sheetId:'1',objectId:object.id,text:value})).toBe(changed);
  });
  it('clones a shared drawing for the selected worksheet, keeps its text identity and leaves the other sheet and orphan relationship bytes intact',async()=>{
    const original=await source(),inserted=insertWorkbookDrawing(original,{kind:'text',sheetId:'1',range,frame,autoSize:false}),file=inserted.packageData;
    const workbook=new OfficeXml(file.read('xl/workbook.xml')),sheets=children(workbook.root,'sheets')[0],other='<sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="Other" sheetId="2" r:id="rIdOther"/>';
    const rels=new OfficeXml(file.read('xl/_rels/workbook.xml.rels')),relation='<Relationship Id="rIdOther" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>';
    const reserved='xl/drawings/WILLYOU-TEXT-1.XML',orphan='xl/drawings/_rels/WILLYOU-TEXT-1.XML.rels',shared=file.patch(new Map([
      ['xl/workbook.xml',workbook.edit([{start:sheets.closeStart,end:sheets.closeStart,value:other}])],['xl/_rels/workbook.xml.rels',rels.edit([{start:rels.root.closeStart,end:rels.root.closeStart,value:relation}])],
      ['xl/worksheets/sheet2.xml',file.read('xl/worksheets/sheet1.xml')],['xl/worksheets/_rels/sheet2.xml.rels',file.read('xl/worksheets/_rels/sheet1.xml.rels')],[reserved,Buffer.from('<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>')],[orphan,Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')]
    ]),{changed:['xl/workbook.xml','xl/_rels/workbook.xml.rels'],added:['xl/worksheets/sheet2.xml','xl/worksheets/_rels/sheet2.xml.rels',reserved,orphan],removed:[]});
    const selected=text(shared),otherBefore=text(shared,'2'),changed=editWorkbookDrawingText(shared,{sheetId:'1',objectId:selected.id,text:'only this sheet'});
    expect(text(changed)).toMatchObject({id:selected.id,shape:{text:'only this sheet'}});expect(text(changed).source.part).not.toBe(selected.source.part);
    expect(text(changed,'2')).toEqual(otherBefore);expect(changed.read(selected.source.part)).toEqual(shared.read(selected.source.part));expect(changed.read(orphan)).toEqual(shared.read(orphan));
    expect(text(changed).source.part).toMatch(/willyou-text-2\.xml$/);
    const second=editWorkbookDrawingText(changed,{sheetId:'1',objectId:selected.id,text:'second edit'});expect(text(second)).toMatchObject({id:selected.id,shape:{text:'second edit'}});expect(text(second,'2')).toEqual(otherBefore);
    expect(text(await OfficePackage.read(await second.bytes())).shape?.text).toBe('second edit');
  });
  it('rejects stale or non-text identities, invalid placement and protected sheets without changing bytes',async()=>{
    const original=await source(),before=original.hashes();
    expect(()=>editWorkbookDrawingText(original,{sheetId:'1',objectId:'0'.repeat(64),text:'no'})).toThrow('文本框');
    expect(()=>insertWorkbookDrawing(original,{kind:'text',sheetId:'1',range,frame:{...frame,width:0},autoSize:true})).toThrow();
    const inserted=insertWorkbookDrawing(original,{kind:'text',sheetId:'1',range,frame,autoSize:false}).packageData,object=text(inserted),part='xl/worksheets/sheet1.xml',sheet=new OfficeXml(inserted.read(part));
    const locked=inserted.patch(new Map([[part,sheet.edit([{start:sheet.root.closeStart,end:sheet.root.closeStart,value:`<sheetProtection xmlns="${sheet.root.uri}" sheet="1"/>` }])]]),{changed:[part],added:[],removed:[]});
    expect(()=>editWorkbookDrawingText(locked,{sheetId:'1',objectId:object.id,text:'no'})).toThrow('受保护');expect(original.hashes()).toEqual(before);
  });
});

import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {WORKBOOK_SHAPES} from '@shared/file-workbook-drawing';
import {PPTX_BASIC_CHARTS} from '@shared/file-pptx-chart';
import {OfficePackage} from './package';
import {OfficeWorkbook} from './workbook';
import {OfficeXml,attribute,children,descendants} from './xml';
import {OFFICE_REL,relationshipKind} from './relationships';
import {insertWorkbookDrawing,workbookChartData} from './workbook-drawing-insert';

const part='xl/worksheets/sheet1.xml',draw='xl/drawings/drawing1.xml',XDR='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',DRAW='http://schemas.openxmlformats.org/drawingml/2006/main';
const range={firstRow:0,lastRow:2,firstColumn:0,lastColumn:2};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
  const file=await OfficePackage.read(await readFile(new URL('./__fixtures__/ordinary-drawing.xlsx',import.meta.url)));
  const doc=new OfficeXml(file.read(part)),data=children(doc.root,'sheetData')[0];
  const rows='<row r="1"><c r="A1" t="inlineStr"><is><t>分类</t></is></c><c r="B1" t="inlineStr"><is><t>测量&amp;值</t></is></c><c r="C1" t="inlineStr"><is><t>第二系列</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>42</v></c><c r="C2"><v>2</v></c></row><row r="3"><c r="A3"><v>2</v></c><c r="B3"><v>43</v></c><c r="C3"><v>8</v></c></row>';
  return file.patch(new Map([[part,doc.edit([doc.replaceContent(data,rows)])]]),{changed:[part],added:[],removed:[]});
}
function unchangedOutside(before:OfficePackage,after:OfficePackage,allowed:readonly string[]){
  const a=before.hashes(),b=after.hashes();
  for(const name of before.names())if(!allowed.includes(name))expect(b[name],name).toBe(a[name]);
}
function lastObject(file:OfficePackage,drawing:string){return new OfficeXml(file.read(drawing)).root.children.filter(node=>node.local==='oneCellAnchor').at(-1)!;}

describe('real XLSX drawing insert parts',()=>{
  it.each(PPTX_BASIC_CHARTS)('inserts %s from actual two-series selected cells, preserves original media and reopens the complete OPC',async chartType=>{
    const source=await fixture(),original=source.hashes(),result=insertWorkbookDrawing(source,{kind:'chart',chartType,sheetId:'1',range});
    const book=new OfficeWorkbook(result.packageData),relation=book.graph.forPart(result.object.part).find(row=>relationshipKind(row.type,'chart'))!;
    const projected=book.window('1',0,0,6,6).objects!.find(value=>value.source.id===result.object.id);
    expect(projected).toMatchObject({kind:'chart',chart:{type:chartType,series:[{name:'测量&值',values:[42,43]},{name:'第二系列',values:[2,8]}]}});
    expect(relation.external).toBe(false);expect(relation.part).toBeTruthy();
    const chart=new OfficeXml(result.packageData.read(relation.part!));
    const series=descendants(chart.root,'ser');expect(series).toHaveLength(2);
    const yTag=chartType==='scatter'?'yVal':'val';
    expect(descendants(children(series[0],yTag)[0],'numCache')[0].children.filter(node=>node.local==='pt').map(node=>children(node,'v')[0].text)).toEqual(['42','43']);
    expect(descendants(children(series[1],yTag)[0],'numCache')[0].children.filter(node=>node.local==='pt').map(node=>children(node,'v')[0].text)).toEqual(['2','8']);
    if(chartType==='scatter')expect(descendants(children(series[0],'xVal')[0],'numCache')[0].children.filter(node=>node.local==='pt').map(node=>children(node,'v')[0].text)).toEqual(['1','2']);
    expect(descendants(series[0],'f').some(node=>node.text.endsWith('!$B$2:$B$3'))).toBe(true);
    expect(descendants(descendants(series[0],'tx')[0],'v')[0].text).toBe('测量&值');
    expect(book.cell('1',1,1).value).toBe('42');expect(book.cell('1',2,2).value).toBe('8');
    expect(children(lastObject(result.packageData,result.object.part),'graphicFrame')).toHaveLength(1);
    unchangedOutside(source,result.packageData,result.plan.changed);
    expect(source.hashes()).toEqual(original);
    const reopen=await OfficePackage.read(await result.packageData.bytes());expect(reopen.hashes()).toEqual(result.packageData.hashes());
    expect(new OfficeWorkbook(reopen).cell('1',1,1).value).toBe('42');
  });

  it('serializes all twelve real shape choices, including rounded callout and diagonal arrow, without changing selected cells',async()=>{
    const source=await fixture();let current=source;
    for(const shape of WORKBOOK_SHAPES){
      const result=insertWorkbookDrawing(current,{kind:'shape',shape,sheetId:'1',range});
      const object=lastObject(result.packageData,result.object.part),sp=children(object,'sp')[0];
      expect(attribute(descendants(sp,'prstGeom',DRAW)[0],'prst')).toBe(shape==='lineInv'?'line':shape);
      expect(descendants(sp,'headEnd',DRAW).map(node=>attribute(node,'type'))).toEqual(shape==='lineInv'?['triangle']:[]);
      expect(new OfficeWorkbook(result.packageData).cell('1',1,1).value).toBe('42');
      expect(new OfficeWorkbook(result.packageData).window('1',0,0,6,6).objects!.find(value=>value.source.id===result.object.id)).toMatchObject({kind:'shape',shape:{geometry:shape==='lineInv'?'line':shape,arrow:shape==='lineInv'}});
      expect(result.plan.added).toEqual([]);expect(result.plan.changed).toEqual([draw]);
      current=result.packageData;
    }
    unchangedOutside(source,current,[draw]);
    const reopened=await OfficePackage.read(await current.bytes());expect(reopened.hashes()).toEqual(current.hashes());
    const ids=descendants(new OfficeXml(reopened.read(draw)).root,'cNvPr',XDR).map(node=>attribute(node,'id'));
    expect(ids).toHaveLength(13);expect(new Set(ids).size).toBe(ids.length);
  });

  it('retains exact selected image bytes only after a matching decoded hash and dimensions receipt',async()=>{
    const source=await fixture(),bytes=source.read('xl/media/image1.png'),image={mime:'image/png' as const,base64:bytes.toString('base64')};
    const action={kind:'image' as const,image,sheetId:'1',range};
    expect(()=>insertWorkbookDrawing(source,action)).toThrow('本机解码');
    expect(()=>insertWorkbookDrawing(source,action,{hash:sha(bytes),width:3,height:2})).toThrow('回执不一致');
    expect(()=>insertWorkbookDrawing(source,action,{hash:'0'.repeat(64),width:2,height:2})).toThrow('回执不一致');
    const result=insertWorkbookDrawing(source,action,{hash:sha(bytes),width:2,height:2}),book=new OfficeWorkbook(result.packageData);
    const object=book.window('1',0,0,6,6).objects!.find(object=>object.source.id===result.object.id)!;
    expect(object.kind).toBe('image');if(object.kind!=='image')throw new Error('expected inserted image');
    expect(object.media.sha256).toBe(sha(bytes));expect(result.packageData.read(object.media.part)).toEqual(bytes);
    expect(object.anchor).toEqual({kind:'oneCellAnchor',from:{row:0,column:0,x:0,y:0},extent:{width:2,height:2}});
    unchangedOutside(source,result.packageData,result.plan.changed);
    expect((await OfficePackage.read(await result.packageData.bytes())).hashes()).toEqual(result.packageData.hashes());
  });

  it('rejects empty/non-numeric, invalid types, protected sheets and invalid ranges before any source change',async()=>{
    const source=await fixture(),original=source.hashes(),model=new OfficeWorkbook(source);
    expect(()=>workbookChartData(model,'1',{...range,lastRow:0},'bar')).toThrow('有限数值');
    expect(()=>insertWorkbookDrawing(source,{kind:'chart',chartType:'histogram' as never,sheetId:'1',range})).toThrow('图表类型');
    expect(()=>insertWorkbookDrawing(source,{kind:'shape',shape:'arbitrary' as never,sheetId:'1',range})).toThrow('形状类型');
    expect(()=>insertWorkbookDrawing(source,{kind:'shape',shape:'rect',sheetId:'1',range:{...range,firstRow:-1}})).toThrow();
    const doc=new OfficeXml(source.read(part)),protectedBytes=doc.edit([{start:doc.root.closeStart,end:doc.root.closeStart,value:`<sheetProtection xmlns="${doc.root.uri}" sheet="1"/>`}]);
    const locked=source.patch(new Map([[part,protectedBytes]]),{changed:[part],added:[],removed:[]});
    expect(()=>insertWorkbookDrawing(locked,{kind:'shape',shape:'rect',sheetId:'1',range})).toThrow('受保护');
    expect(source.hashes()).toEqual(original);
  });

  it('clones a shared drawing for only the selected sheet while retaining its relative media base and every other sheet',async()=>{
    const source=await fixture(),book=new OfficeWorkbook(source),mainPart=book.graph.mainPart,main=new OfficeXml(source.read(mainPart)),sheets=children(main.root,'sheets')[0];
    const relPart='xl/_rels/workbook.xml.rels',rels=new OfficeXml(source.read(relPart)),types=new OfficeXml(source.read('[Content_Types].xml'));
    const changes=new Map<string,Uint8Array>([
      [mainPart,main.edit([{start:sheets.closeStart,end:sheets.closeStart,value:`<sheet xmlns="${main.root.uri}" xmlns:r="${OFFICE_REL}" name="Second" sheetId="2" r:id="rIdSecond"/>`}])],
      [relPart,rels.edit([{start:rels.root.closeStart,end:rels.root.closeStart,value:`<Relationship xmlns="${rels.root.uri}" Id="rIdSecond" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet2.xml"/>`}])],
      ['xl/worksheets/sheet2.xml',source.read(part)],
      ['xl/worksheets/_rels/sheet2.xml.rels',source.read('xl/worksheets/_rels/sheet1.xml.rels')],
      ['[Content_Types].xml',types.edit([{start:types.root.closeStart,end:types.root.closeStart,value:`<Override xmlns="${types.root.uri}" PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`}])],
    ]);
    const shared=source.patch(changes,{changed:[mainPart,relPart,'[Content_Types].xml'],added:['xl/worksheets/sheet2.xml','xl/worksheets/_rels/sheet2.xml.rels'],removed:[]});
    const before=new OfficeWorkbook(shared),other=before.window('2',0,0,6,6).objects;
    const result=insertWorkbookDrawing(shared,{kind:'shape',shape:'rect',sheetId:'1',range});
    expect(result.object.part).not.toBe(draw);expect(result.packageData.read(draw)).toEqual(shared.read(draw));
    expect(new OfficeWorkbook(result.packageData).window('2',0,0,6,6).objects).toEqual(other);
    unchangedOutside(shared,result.packageData,[part,'xl/worksheets/_rels/sheet1.xml.rels','[Content_Types].xml']);
    expect((await OfficePackage.read(await result.packageData.bytes())).hashes()).toEqual(result.packageData.hashes());
  });
});

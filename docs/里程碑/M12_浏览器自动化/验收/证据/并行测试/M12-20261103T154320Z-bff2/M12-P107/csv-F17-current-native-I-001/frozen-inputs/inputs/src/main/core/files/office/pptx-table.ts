import { FileError } from '@shared/files';
import type { PptxTableInfo } from '@shared/file-pptx-table';
import { pptxTableRangeCells } from '@shared/file-pptx-table';
import type { PptxAction } from '@shared/file-pptx';
import { OfficeXml,attribute,children,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';
import { pptxTextStyle } from './pptx-format';
import { editPptxTextBody } from './pptx-text-edit';

const truth=(value:string|undefined)=>value==='true'||value==='1';
const integer=(value:string|undefined,fallback?:number)=>{
  if(value===undefined&&fallback!==undefined)return fallback;
  if(value===undefined||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new FileError('UNSUPPORTED','表格尺寸或合并属性无效，未应用修改');return Number(value);
};
export function pptxTableNode(node:OfficeXmlNode,drawing:string):OfficeXmlNode|undefined{
  if(node.local!=='graphicFrame')return;
  const graphic=children(node,'graphic',drawing)[0],data=graphic&&children(graphic,'graphicData',drawing)[0];
  if(!data||attribute(data,'uri')!==drawing.replace(/\/main$/,'/table'))return;
  const tables=children(data,'tbl',drawing);if(tables.length!==1)throw new FileError('UNSUPPORTED','绘图框的表格结构无法解析');return tables[0];
}
const bodyText=(body:OfficeXmlNode,drawing:string)=>children(body,'p',drawing).map(p=>{
  const values:string[]=[];const walk=(node:OfficeXmlNode)=>{if(node.uri===drawing&&node.local==='t')values.push(node.text);else if(node.uri===drawing&&node.local==='br')values.push('\n');else node.children.forEach(walk);};walk(p);return values.join('');
}).join('\n');
export function pptxTable(node:OfficeXmlNode,drawing:string):PptxTableInfo|undefined{
  const table=pptxTableNode(node,drawing);if(!table)return;
  const grid=children(table,'tblGrid',drawing),rows=children(table,'tr',drawing),props=children(table,'tblPr',drawing)[0];
  if(grid.length!==1||!rows.length)throw new FileError('UNSUPPORTED','表格缺少行或列尺寸');
  const columns=children(grid[0],'gridCol',drawing);
  if(!columns.length||columns.length*rows.length>65536)throw new FileError('TOO_LARGE','幻灯片表格单元格数量超过预算');
  const widths=columns.map(col=>integer(attribute(col,'w'))/12700),heights=rows.map(row=>integer(attribute(row,'h'))/12700);
  const cells=rows.map((row,r)=>{
    const entries=children(row,'tc',drawing);if(entries.length!==columns.length)throw new FileError('UNSUPPORTED','表格列与单元格数量不一致');
    return entries.map((cell,column)=>{
      const body=children(cell,'txBody',drawing)[0];if(!body)throw new FileError('UNSUPPORTED','表格单元格缺少正文');
      const rowSpan=integer(attribute(cell,'rowSpan'),1),columnSpan=integer(attribute(cell,'gridSpan'),1);
      if(rowSpan<1||columnSpan<1||r+rowSpan>rows.length||column+columnSpan>columns.length)throw new FileError('UNSUPPORTED','表格合并范围越界');
      return {row:r,column,text:bodyText(body,drawing),textStyle:pptxTextStyle(body,drawing),rowSpan,columnSpan,horizontalMerge:truth(attribute(cell,'hMerge')),verticalMerge:truth(attribute(cell,'vMerge'))};
    });
  });
  return {widths,heights,cells,headerRow:props?truth(attribute(props,'firstRow')):false,headerColumn:props?truth(attribute(props,'firstCol')):false,styleId:props?children(props,'tableStyleId',drawing)[0]?.text:undefined,explicitGrid:widths.every(value=>value>0)&&heights.every(value=>value>0)};
}
export function editPptxTable(doc:OfficeXml,node:OfficeXmlNode,action:Extract<PptxAction,{type:'table-cell'|'table-clear'|'table-flags'}>,drawing:string):XmlEdit[]{
  const table=pptxTableNode(node,drawing),info=pptxTable(node,drawing);if(!table||!info)throw new FileError('UNSUPPORTED','此对象不是可编辑表格');
  const rows=children(table,'tr',drawing).map(row=>children(row,'tc',drawing));
  const changeText=(row:number,column:number,text:string):XmlEdit[]=>{
    const entry=info.cells[row]?.[column];if(!entry)throw new FileError('CHANGED','表格单元格已不存在');
    if(entry.horizontalMerge||entry.verticalMerge)throw new FileError('UNSUPPORTED','请编辑合并单元格的起始格');
    if(entry.text===text.replace(/\r\n?/g,'\n'))return [];
    return editPptxTextBody(doc,children(rows[row][column],'txBody',drawing)[0],text,drawing,'表格单元格');
  };
  if(action.type==='table-clear'){
    for(const address of [action.range.start,action.range.end])if(!info.cells[address.row]?.[address.column])throw new FileError('CHANGED','表格选区已超出当前范围');
    // Validate every selected body before applying one atomic XML patch. A
    // rejected rich cell cannot leave earlier cells cleared or add history.
    return pptxTableRangeCells(info,action.range).flatMap(cell=>changeText(cell.row,cell.column,''));
  }
  if(action.type==='table-cell')return changeText(action.row,action.column,action.text);
  const props=children(table,'tblPr',drawing)[0],pairs=[['headerRow','firstRow'],['headerColumn','firstCol']] as const;
  const updates=pairs.filter(([key])=>action.patch[key]!==undefined&&action.patch[key]!==info[key]);if(!updates.length)return [];
  if(props)return updates.map(([key,name])=>doc.setAttribute(props,name,action.patch[key]?'1':'0'));
  const xml=`<a:tblPr xmlns:a="${drawing}"${updates.map(([key,name])=>` ${name}="${action.patch[key]?'1':'0'}"`).join('')}/>`;
  return [{start:table.openEnd,end:table.openEnd,value:xml}];
}

/** DrawingML tables lay out from grid widths and row heights, independently of
 * the graphic frame extent. Resize the actual grid, preserving its proportions.
 * Automatic dimensions need measured layout before they can be resized. */
export function resizePptxTable(doc:OfficeXml,node:OfficeXmlNode,drawing:string,width?:number,height?:number,measuredRows?:readonly number[]):XmlEdit[]{
  const table=pptxTableNode(node,drawing);if(!table)return [];
  const edits:XmlEdit[]=[];
  const resize=(entries:OfficeXmlNode[],name:string,size:number|undefined)=>{
    if(size===undefined)return;
    let values=entries.map(entry=>integer(attribute(entry,name)));
    if(name==='h'&&values.some(value=>value===0)&&measuredRows){
      if(measuredRows.length!==entries.length||measuredRows.some(value=>!Number.isFinite(value)||value<=0||value>1000000))throw new FileError('UNSUPPORTED','表格实测行边界不完整，未调整高度');
      values=measuredRows.map(value=>Math.max(1,Math.round(value*12700)));
    }
    const total=values.reduce((sum,value)=>sum+value,0),target=Math.round(size*12700);
    if(!values.length||values.some(value=>value===0)||!Number.isSafeInteger(total))throw new FileError('UNSUPPORTED','表格包含自动尺寸，需要实际排版尺寸后才能调整大小');
    if(!Number.isSafeInteger(target)||target<values.length)throw new FileError('INVALID_INPUT','表格尺寸过小或超出文件格式范围');
    let source=0,previous=0;
    for(let i=0;i<entries.length;i++){
      source+=values[i];
      const boundary=i===entries.length-1?target:Math.max(previous+1,Math.min(target-(entries.length-i-1),Math.round(source/total*target)));
      const value=boundary-previous;previous=boundary;
      if(value!==integer(attribute(entries[i],name)))edits.push(doc.setAttribute(entries[i],name,String(value)));
    }
  };
  const grid=children(table,'tblGrid',drawing)[0];if(!grid)throw new FileError('UNSUPPORTED','表格缺少列尺寸');
  resize(children(grid,'gridCol',drawing),'w',width);resize(children(table,'tr',drawing),'h',height);
  return edits;
}

/** The reviewed insert action creates a 3×2 source table. It uses the selected
 * document's existing default style when present; no global style is changed. */
export function newPptxTable(ns:string,drawing:string,id:number,x:number,y:number,width:number,height:number,fontSize:number,styleId:string){
  const widths=[Math.floor(width/2),width-Math.floor(width/2)],heights=[Math.floor(height/3),Math.floor(height/3),height-2*Math.floor(height/3)];
  const rows=[['项目','数量'],['A','3'],['B','5']].map((values,r)=>`<a:tr h="${heights[r]}">${values.map(value=>`<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="${fontSize}"/><a:t>${xmlEscape(value)}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`).join('');
  return `<p:graphicFrame xmlns:p="${ns}" xmlns:a="${drawing}"><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></p:xfrm><a:graphic><a:graphicData uri="${drawing.replace(/\/main$/,'/table')}"><a:tbl><a:tblPr firstRow="0" firstCol="0" bandRow="0"><a:tableStyleId>${xmlEscape(styleId)}</a:tableStyleId></a:tblPr><a:tblGrid>${widths.map(value=>`<a:gridCol w="${value}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

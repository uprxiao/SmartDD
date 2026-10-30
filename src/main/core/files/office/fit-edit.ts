import { FileError } from '@shared/files';
import type { OfficeRange,OfficeRangeAction } from '@shared/file-office';
import { officeMeasureInputSchema,officeMeasureResultSchema,officeColumnPixels,officeColumnUnits,type OfficeMeasureFont,type OfficeMeasureInput,type OfficeMeasureResult } from '@shared/office-measure';
import { OfficeWorkbook,officeCellAddress,officeRange } from './workbook';
import type { OfficePackage } from './package';
import { worksheetParts } from './calculation';
import { OfficeXml,attribute,children,copyOfficeNode,type OfficeXmlNode,type XmlEdit } from './xml';
import { officePrefix } from './worksheet-edits';

type FitAction=Extract<OfficeRangeAction,{type:'fit'}>;
const enabled=(text?:string)=>text==='1' || text==='true';
function font(value:Partial<OfficeMeasureFont>|undefined,normal:OfficeMeasureFont):OfficeMeasureFont {
  return {family:value?.family || normal.family,points:value?.points ?? normal.points,bold:value?.bold ?? normal.bold,italic:value?.italic ?? normal.italic};
}
/** Measure all used content in the selected rows/columns, including content
 * outside the viewport. Merged anchors constrain the combined visible extent. */
export function prepareOfficeFit(model:OfficeWorkbook,action:FitAction) {
  const sheet=model.info.sheets.find(sheet=>sheet.id===action.sheetId);
  if(!sheet)throw new FileError('CHANGED','工作表已不存在');
  if(model.info.kind!=='xlsx' || model.info.signed)throw new FileError('UNSUPPORTED','此工作簿尚不支持适应尺寸');
  if(sheet.protected)throw new FileError('PERMISSION','工作表受保护，不能修改尺寸');
  const {range,axis}=action,first=axis==='column' ? range.firstColumn : range.firstRow,last=axis==='column' ? range.lastColumn : range.lastRow;
  if(last-first+1>10000)throw new FileError('TOO_LARGE','单次最多适应 10000 行或列');
  const part=worksheetParts(model.packageData).get(sheet.name)!,doc=new OfficeXml(model.packageData.read(part)),mdw=model.fontMetric.digitWidth;
  const format=children(doc.root,'sheetFormatPr')[0],defaultUnits=Number(format && attribute(format,'defaultColWidth') || Number(format && attribute(format,'baseColWidth') || 8)+5/mdw);
  const widths=new Map<number,number>(),rows=new Map<number,number>();
  for(const container of children(doc.root,'cols'))for(const col of children(container,'col'))for(let i=Number(attribute(col,'min'))-1;i<Number(attribute(col,'max'));i++)widths.set(i,enabled(attribute(col,'hidden')) ? 0 : Number(attribute(col,'width') ?? defaultUnits));
  for(const row of sheet.rowSizes)rows.set(row.index,row.pixels);
  const columnWidth=(index:number)=>widths.get(index) ?? defaultUnits,rowHeight=(index:number)=>rows.get(index) ?? sheet.defaultRowHeight;
  const current=(index:number)=>axis==='column' ? officeColumnPixels(columnWidth(index),mdw) : rowHeight(index);
  const targets=Array.from({length:last-first+1},(_,i)=>i+first).filter(i=>current(i)>0);
  const relevant=(r:OfficeRange)=>axis==='column' ? r.lastColumn>=first && r.firstColumn<=last : r.lastRow>=first && r.firstRow<=last;
  const merges=children(doc.root,'mergeCells').flatMap(node=>children(node,'mergeCell').map(node=>officeRange(attribute(node,'ref')!))).filter(relevant),covered=new Map<string,OfficeRange>();
  let coverage=0;
  for(const merge of merges){coverage+=(merge.lastRow-merge.firstRow+1)*(merge.lastColumn-merge.firstColumn+1);if(coverage>50000)throw new FileError('TOO_LARGE','合并区域尺寸测量超过 50000 格预算');for(let r=merge.firstRow;r<=merge.lastRow;r++)for(let c=merge.firstColumn;c<=merge.lastColumn;c++){const address=officeCellAddress(r,c);if(covered.has(address))throw new FileError('INVALID_INPUT','合并区域重叠');covered.set(address,merge);}}
  const selected=new Map<string,{row:number;column:number;merge?:OfficeRange}>();
  for(const cell of model.storedCells(sheet.id))if(relevant({firstRow:cell.row,lastRow:cell.row,firstColumn:cell.column,lastColumn:cell.column}) && !covered.has(cell.address))selected.set(cell.address,cell);
  for(const merge of merges)selected.set(officeCellAddress(merge.firstRow,merge.firstColumn),{row:merge.firstRow,column:merge.firstColumn,merge});
  const input:OfficeMeasureInput={normalFont:model.styles.normalFont,items:[]},spans:{first:number;last:number}[]=[];
  let characters=0,runs=0;
  for(const {row,column,merge} of selected.values()) {
    if(!rowHeight(row) || !columnWidth(column))continue;
    const cell=model.cell(sheet.id,row,column),style=model.styles.get(cell.style),text=model.styles.display(cell,model.info.date1904);
    if(!text)continue;
    if(input.items.length>=10000)throw new FileError('TOO_LARGE','尺寸测量内容超过 10000 格');
    if(style.alignment?.rotation===255)throw new FileError('UNSUPPORTED','竖排文字的尺寸测量尚未接入，原尺寸保留');
    const base=font(style.font,input.normalFont),parts=cell.runs?.map(run=>({text:run.text,font:font(run.font,base)})) ?? [{text,font:base}];
    characters+=parts.reduce((sum,part)=>sum+part.text.length,0);runs+=parts.length;
    if(characters>1_048_576 || runs>16384)throw new FileError('TOO_LARGE','尺寸测量超过 1 Mi 字符或 16384 段富文本预算');
    const widths=Array.from({length:merge ? merge.lastColumn-merge.firstColumn+1 : 1},(_,i)=>columnWidth(column+i));
    input.items.push({runs:parts,widths,wrap:axis==='row' && !!style.alignment?.wrap,indent:style.alignment?.indent ?? 0,rotation:style.alignment?.rotation ?? 0});
    spans.push({first:axis==='column' ? merge?.firstColumn ?? column : merge?.firstRow ?? row,last:axis==='column' ? merge?.lastColumn ?? column : merge?.lastRow ?? row});
  }
  officeMeasureInputSchema.parse(input);
  if(Buffer.byteLength(JSON.stringify(input),'utf8')>8*1024*1024)throw new FileError('TOO_LARGE','字体测量请求超过 8 MiB');
  return {input,spans,targets,current,part,doc};
}
function changedNode(doc:OfficeXml,node:OfficeXmlNode,attrs:Record<string,string>):string {
  const local=new OfficeXml(Buffer.from(copyOfficeNode(doc,node)));return local.edit(Object.entries(attrs).map(([key,value])=>local.setAttribute(local.root,key,value))).toString();
}
function writeSizes(doc:OfficeXml,axis:'row'|'column',sizes:Map<number,number>):Buffer {
  const edits:XmlEdit[]=[],additions=new Map<number,string[]>(),add=(at:number,value:string)=>{const list=additions.get(at) ?? [];list.push(value);additions.set(at,list);};
  if(axis==='column') {
    const containers=children(doc.root,'cols');if(containers.length>1)throw new FileError('UNSUPPORTED','多组列定义需要独立适配，原尺寸保留');
    const container=containers[0],columns=container ? children(container,'col') : [],occupied=new Set<number>(),prefix=officePrefix(container ?? doc.root);
    let previous=0;
    for(const col of columns) {
      const first=Number(attribute(col,'min'))-1,last=Number(attribute(col,'max'))-1;
      if(first<previous)throw new FileError('UNSUPPORTED','重叠或无序列定义不能适应尺寸');previous=last+1;
      const targets=[...sizes.keys()].filter(index=>index>=first && index<=last);if(!targets.length)continue;
      const fragments:string[]=[];let start=first;
      for(const index of targets){if(start<index)fragments.push(changedNode(doc,col,{min:String(start+1),max:String(index)}));fragments.push(changedNode(doc,col,{min:String(index+1),max:String(index+1),width:String(sizes.get(index)),customWidth:'1',bestFit:'1'}));occupied.add(index);start=index+1;}
      if(start<=last)fragments.push(changedNode(doc,col,{min:String(start+1),max:String(last+1)}));edits.push({start:col.start,end:col.end,value:fragments.join('')});
    }
    const newColumns=[...sizes].filter(([index])=>!occupied.has(index));
    if(!container) {
      const values=newColumns.map(([index,width])=>`<${prefix}col min="${index+1}" max="${index+1}" width="${width}" customWidth="1" bestFit="1"/>`).join('');
      const data=children(doc.root,'sheetData')[0];add(data.start,`<${prefix}cols>${values}</${prefix}cols>`);
    } else for(const [index,width] of newColumns)add(columns.find(col=>Number(attribute(col,'min'))-1>index)?.start ?? container.closeStart,`<${prefix}col min="${index+1}" max="${index+1}" width="${width}" customWidth="1" bestFit="1"/>`);
    for(const [at,values] of additions)edits.push(container?.selfClosing && at===container.closeStart ? {start:container.openEnd-2,end:container.openEnd,value:`>${values.join('')}</${container.name}>`} : {start:at,end:at,value:values.join('')});
  } else {
    const data=children(doc.root,'sheetData')[0],indexed=new Map<number,OfficeXmlNode>();let index=-1;
    for(const row of children(data,'row')){index=Number(attribute(row,'r') ?? index+2)-1;indexed.set(index,row);}
    for(const [index,points] of sizes){const row=indexed.get(index);if(row)edits.push(doc.setAttribute(row,'ht',String(points)),doc.setAttribute(row,'customHeight','1'));else add([...indexed].find(([i])=>i>index)?.[1].start ?? data.closeStart,`<${officePrefix(data)}row r="${index+1}" ht="${points}" customHeight="1"/>`);}
    for(const [at,values] of additions)edits.push(data.selfClosing && at===data.closeStart ? {start:data.openEnd-2,end:data.openEnd,value:`>${values.join('')}</${data.name}>`} : {start:at,end:at,value:values.join('')});
  }
  return doc.edit(edits);
}
export function editOfficeFit(file:OfficePackage,action:FitAction,raw:OfficeMeasureResult):OfficePackage {
  const measured=officeMeasureResultSchema.parse(raw),model=new OfficeWorkbook(file,{digitWidth:measured.digitWidth,measured:true}),plan=prepareOfficeFit(model,action);
  if(measured.items.length!==plan.spans.length)throw new FileError('IO','字体测量结果与单元格数量不一致');
  const targets=new Set(plan.targets),sizes=new Map<number,number>(),constraints:{span:{first:number;last:number};size:number}[]=[];
  for(let i=0;i<plan.spans.length;i++){
    const span=plan.spans[i],size=Math.ceil(action.axis==='column' ? measured.items[i].width : measured.items[i].height);
    if(span.first===span.last && targets.has(span.first))sizes.set(span.first,Math.max(sizes.get(span.first) ?? 0,size));else constraints.push({span,size});
  }
  for(const index of targets)if(!sizes.has(index))sizes.set(index,action.axis==='row' ? Math.ceil(measured.lineHeight+5) : plan.current(index));
  for(const {span,size} of constraints){let total=0,last=-1;for(let index=span.first;index<=span.last;index++){total+=sizes.get(index) ?? plan.current(index);if(targets.has(index))last=index;}if(last>=0 && size>total)sizes.set(last,sizes.get(last)!+size-total);}
  const stored=new Map<number,number>();
  for(const [index,pixels] of [...sizes].sort((a,b)=>a[0]-b[0])){
    if(Math.abs(plan.current(index)-pixels)<.001)continue;
    const value=action.axis==='column' ? officeColumnUnits(pixels,measured.digitWidth) : Math.ceil(pixels*.75*20)/20;
    if(value>(action.axis==='column' ? 255 : 409))throw new FileError('TOO_LARGE','内容所需尺寸超过工作表行列上限，原尺寸保留');
    stored.set(index,value);
  }
  if(!stored.size)return file;
  const bytes=writeSizes(plan.doc,action.axis,stored),output=file.patch(new Map([[plan.part,bytes]]),{changed:[plan.part],added:[],removed:[]});new OfficeWorkbook(output,model.fontMetric);return output;
}

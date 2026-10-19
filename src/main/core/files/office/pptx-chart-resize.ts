import { FileError } from '@shared/files';
import type { OfficeCell } from '@shared/file-office';
import type { PptxChartSource } from './pptx-chart';
import { OfficePackage } from './package';
import { OfficeWorkbook } from './workbook';
import { OfficeXml,attribute,children,descendants,copyOfficeNode,xmlEscape,type OfficeXmlNode,type XmlEdit } from './xml';
import { chartWorkbookRange } from './pptx-chart-workbook';
import { modernChartDisplay } from './pptx-chartex-display';
import { MODERN_CHART_COLORS,MODERN_DRAWING } from './pptx-chartex-create';
import { editOfficeSheet } from './sheet-edit';
import { worksheetParts } from './calculation';
import { officePrefix } from './worksheet-edits';
import { encodeOfficeString } from './xstring';

const fail=(message:string):never=>{throw new FileError('UNSUPPORTED',`图表数据项数量调整${message}，原图表保留`);};
const one=(node:OfficeXmlNode,name:string)=>{const found=children(node,name);if(found.length!==1)fail(`需要完整的 ${name} 来源`);return found[0];};
type Category={type:'number'|'string';value:string;style:number};

/** Existing labels are retained. Generated ordinal/letter labels continue their
 * sequence; arbitrary text receives a fresh ordinal. Numeric coordinates extend
 * a positive uniform step, otherwise add one above the largest existing x. */
function extendedCategories(cells:OfficeCell[],count:number):Category[]{
  const result:Category[]=cells.slice(0,count).map(cell=>({type:cell.type as Category['type'],value:cell.value,style:cell.style}));
  const numeric=cells.every(cell=>cell.type==='number'),numbers=cells.map(cell=>Number(cell.value)),used=new Set(cells.map(cell=>cell.value));
  const alphabet=cells.every((cell,index)=>cell.type==='string'&&cell.value===String.fromCharCode(65+index));
  const difference=numbers.length>1?numbers[1]-numbers[0]:1;
  const step=numeric&&difference>0&&Number.isFinite(difference)&&numbers.every((n,i)=>!i||Math.abs((n-numbers[i-1])-difference)<=Math.max(1,Math.abs(n))*1e-12)?difference:1;
  let last=numeric?Math.max(...numbers):0;
  for(let index=result.length;index<count;index++){
    let value:string;
    if(numeric){const next=last+step;if(!Number.isFinite(next)||next<=last)fail('无法生成新的有限横坐标');last=next;value=String(next);}
    else if(alphabet)value=String.fromCharCode(65+index);
    else{let ordinal=index+1;while(used.has(String(ordinal)))ordinal++;value=String(ordinal);}
    used.add(value);result.push({type:numeric?'number':'string',value,style:cells.at(-1)!.style});
  }
  return result;
}

function cachePoints(prefix:string,values:readonly (number|string)[],modern:boolean){
  return values.map((value,index)=>`<${prefix}pt idx="${index}">${modern?xmlEscape(String(value)):`<${prefix}v>${xmlEscape(String(value))}</${prefix}v>`}</${prefix}pt>`).join('');
}
function basicCache(doc:OfficeXml,ref:OfficeXmlNode,cache:OfficeXmlNode,formula:string,values:readonly (number|string)[]):XmlEdit[]{
  if(cache.children.some(node=>node.uri!==cache.uri||!['formatCode','ptCount','pt'].includes(node.local)))fail('包含未适配的缓存内容');
  const p=officePrefix(cache),format=children(cache,'formatCode').map(node=>doc.slice(node)).join('');
  return [doc.replaceContent(one(ref,'f'),xmlEscape(formula)),doc.replaceContent(cache,`${format}<${p}ptCount val="${values.length}"/>${cachePoints(p,values,false)}`)];
}
function modernCache(doc:OfficeXml,dimension:OfficeXmlNode,formula:string,values:readonly (number|string)[]):XmlEdit[]{
  const level=one(dimension,'lvl');return [doc.replaceContent(one(dimension,'f'),xmlEscape(formula)),doc.setAttribute(level,'ptCount',String(values.length)),doc.replaceContent(level,cachePoints(officePrefix(level),values,true))];
}

/** Resize a real source series while preserving all old embedded worksheets.
 * A new local data sheet avoids overwriting adjacent cells or redirecting other
 * formulas. The outer chart adapter forks the selected chart and workbook. */
export async function resizePptxChartValues(file:OfficePackage,source:PptxChartSource,values:readonly number[]){
  const {doc}=source,oldCount=source.values.length;
  let categoryFormula:string,labels:string[],numericCache=false;
  let categoryRef:OfficeXmlNode|undefined,categoryCache:OfficeXmlNode|undefined,categoryDimension:OfficeXmlNode|undefined;
  if(source.family==='modern'){
    const dimensions=children(source.data,'strDim');if(dimensions.length!==1)fail('需要明确的分类数据');
    const display=modernChartDisplay(source);if(display.histogram?.kind==='bins'||display.rectangles.length!==oldCount)fail('的分箱或聚合格式尚未适配');
    categoryDimension=dimensions[0];categoryFormula=one(categoryDimension,'f').text;labels=display.labels;
  }else{
    const series=one(source.chartPlot,'ser'),category=one(series,source.type==='scatter'?'xVal':'cat');
    if(category.children.length!==1||!['numRef','strRef'].includes(category.children[0].local))fail('需要本机分类引用');
    if(children(series,'errBars').length)fail('的误差范围尚未适配');
    categoryRef=category.children[0];numericCache=categoryRef.local==='numRef';categoryCache=one(categoryRef,numericCache?'numCache':'strCache');categoryFormula=one(categoryRef,'f').text;
    const points=children(categoryCache,'pt');if(Number(attribute(one(categoryCache,'ptCount'),'val'))!==oldCount||points.length!==oldCount)fail('的分类缓存不完整');
    labels=points.map((node,index)=>{if(attribute(node,'idx')!==String(index))fail('的分类缓存不连续');return one(node,'v').text;});
  }
  const originalBook=await OfficePackage.read(file.read(source.embedded.part!)),book=new OfficeWorkbook(originalBook);
  if(book.info.kind!=='xlsx'||book.info.signed)fail('的内嵌工作簿类型或签名尚未适配');
  for(const part of worksheetParts(originalBook).values())if(descendants(new OfficeXml(originalBook.read(part)).root,'f').length)fail('存在公式依赖');
  const valueRange=chartWorkbookRange(book,source.formula,oldCount),categoryRange=chartWorkbookRange(book,categoryFormula,oldCount);
  if(valueRange.sheet.protected||categoryRange.sheet.protected)throw new FileError('PERMISSION','图表内嵌工作表受保护');
  if(valueRange.cells.some((cell,index)=>cell.formula||cell.type!=='number'||Number(cell.value)!==source.values[index])||categoryRange.cells.some((cell,index)=>cell.formula||!['number','string'].includes(cell.type)||(numericCache?(cell.type!=='number'||!labels[index].trim()||!Number.isFinite(Number(labels[index]))||Number(cell.value)!==Number(labels[index])):cell.value!==labels[index])))fail('的缓存与内嵌工作簿不一致');
  if([...valueRange.cells,...categoryRange.cells].some(cell=>cell.validation))fail('的数据验证迁移尚未适配');
  const categories=extendedCategories(categoryRange.cells,values.length);
  const added=editOfficeSheet(originalBook,{type:'add'}),nextModel=new OfficeWorkbook(added.packageData),sheet=nextModel.info.sheets.find(row=>row.id===added.sheetId)!,part=worksheetParts(added.packageData).get(sheet.name)!,sheetDoc=new OfficeXml(added.packageData.read(part)),p=officePrefix(sheetDoc.root);
  const cell=(address:string,value:string,type:'number'|'string',style=0)=>`<${p}c r="${address}"${style?` s="${style}"`:''}${type==='string'?' t="inlineStr"':''}>${type==='number'?`<${p}v>${xmlEscape(value)}</${p}v>`:`<${p}is><${p}t xml:space="preserve">${xmlEscape(encodeOfficeString(value))}</${p}t></${p}is>`}</${p}c>`;
  const rows=`<${p}row r="1">${cell('A1','Category','string')}${cell('B1','Value','string')}</${p}row>`+values.map((value,index)=>`<${p}row r="${index+2}">${cell(`A${index+2}`,categories[index].value,categories[index].type,categories[index].style)}${cell(`B${index+2}`,String(value),'number',valueRange.cells[Math.min(index,oldCount-1)].style)}</${p}row>`).join('');
  const data=one(sheetDoc.root,'sheetData'),sheetBytes=sheetDoc.edit([{start:data.start,end:data.end,value:`<${p}dimension ref="A1:B${values.length+1}"/><${p}sheetData>${rows}</${p}sheetData>`}]);
  const nextBook=added.packageData.patch(new Map([[part,sheetBytes]]),{changed:[part],added:[],removed:[]});new OfficeWorkbook(nextBook);
  const formula=(column:string)=>`${sheet.name}!$${column}$2:$${column}$${values.length+1}`,edits:XmlEdit[]=[];
  if(source.family==='modern')edits.push(...modernCache(doc,source.dimension,formula('B'),values),...modernCache(doc,categoryDimension!,formula('A'),categories.map(row=>row.value)));
  else{
    const series=one(source.chartPlot,'ser'),ref=one(one(series,source.type==='scatter'?'yVal':'val'),'numRef');
    edits.push(...basicCache(doc,ref,one(ref,'numCache'),formula('B'),values),...basicCache(doc,categoryRef!,categoryCache!,formula('A'),categories.map(row=>row.value)));
    for(const owner of [source.chartPlot,series])for(const container of children(owner,'dLbls'))for(const label of children(container,'dLbl')){
      const index=Number(attribute(one(label,'idx'),'val'));if(!Number.isInteger(index)||index<0||index>=oldCount)fail('的逐点标签索引无效');if(index>=values.length)edits.push({start:label.start,end:label.end,value:''});
    }
  }
  const parent=source.family==='modern'?source.chartPlot:one(source.chartPlot,'ser'),styles=children(parent,source.family==='modern'?'dataPt':'dPt');
  const indexOf=(node:OfficeXmlNode)=>Number(source.family==='modern'?attribute(node,'idx'):attribute(one(node,'idx'),'val'));
  const indexes=styles.map(indexOf);if(new Set(indexes).size!==indexes.length||indexes.some(index=>!Number.isInteger(index)||index<0||index>=oldCount))fail('的逐点样式索引无效');
  for(const style of styles)if(indexOf(style)>=values.length)edits.push({start:style.start,end:style.end,value:''});
  if(styles.length===oldCount&&values.length>oldCount){
    const ordered=[...styles].sort((a,b)=>indexOf(a)-indexOf(b));
    const drawing=source.doc.root.uri.includes('purl.oclc.org')?'http://purl.oclc.org/ooxml/drawingml/main':MODERN_DRAWING;
    const palette=ordered.every((node,index)=>{const colors=descendants(node,'srgbClr',drawing);return colors.length>0&&colors.every(color=>attribute(color,'val')?.toUpperCase()===MODERN_CHART_COLORS[index%4]);});
    let extra='';for(let index=oldCount;index<values.length;index++){
      const copy=new OfficeXml(Buffer.from(copyOfficeNode(doc,ordered[index%oldCount]))),changes=[copy.setAttribute(source.family==='modern'?copy.root:one(copy.root,'idx'),source.family==='modern'?'idx':'val',String(index))];
      if(palette)for(const color of descendants(copy.root,'srgbClr',drawing))changes.push(copy.setAttribute(color,'val',MODERN_CHART_COLORS[index%4]));extra+=copy.edit(changes).toString();
    }
    const at=styles.at(-1)!.end;edits.push({start:at,end:at,value:extra});
  }
  return {chartBytes:doc.edit(edits),bookBytes:await nextBook.bytes()};
}

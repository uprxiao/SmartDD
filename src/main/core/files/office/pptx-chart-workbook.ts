import { FileError } from '@shared/files';
import { OfficePackage } from './package';
import { OfficeWorkbook,officeRange } from './workbook';
import type { ModernChartSource } from './pptx-chartex-data';
import type { modernChartDisplay } from './pptx-chartex-display';
const fail=(message:string):never=>{throw new FileError('UNSUPPORTED',`此图表预览或转换尚未接入：${message}。原图表保留。`);};
export function chartWorkbookRange(book:OfficeWorkbook,formula:string,length:number){
  const match=/^(?:'((?:[^']|'')+)'|([^'!\[\]]+))!(\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?)$/.exec(formula);
  if(!match)fail('数据引用不是本机连续区域');
  const range=officeRange(match![3]),name=match![1]?.replace(/''/g,"'")??match![2],sheet=book.info.sheets.find(row=>row.name===name);
  if(!sheet||range.firstRow!==range.lastRow&&range.firstColumn!==range.lastColumn||(range.lastRow-range.firstRow+1)*(range.lastColumn-range.firstColumn+1)!==length)fail('数据区域与缓存不一致');
  return {sheet:sheet!,range,cells:Array.from({length},(_,index)=>book.cell(sheet!.id,range.firstRow+(range.firstRow===range.lastRow?0:index),range.firstColumn+(range.firstColumn===range.lastColumn?0:index)))};
}
/** A numeric-looking label is not a numeric x value: inspect its actual cell. */
export async function verifyModernChartWorkbook(file:OfficePackage,source:ModernChartSource,display:ReturnType<typeof modernChartDisplay>){
  const book=new OfficeWorkbook(await OfficePackage.read(file.read(source.embedded.part!)));
  if(book.info.kind!=='xlsx')fail('内嵌数据类型尚未适配');
  const values=chartWorkbookRange(book,source.formula,source.values.length).cells,labels=display.categoryFormula?chartWorkbookRange(book,display.categoryFormula,display.labels.length).cells:[];
  if(values.some((cell,index)=>cell.formula||cell.type!=='number'||Number(cell.value)!==source.values[index])||labels.some((cell,index)=>cell.formula||!['number','string'].includes(cell.type)||String(cell.value)!==display.labels[index]))fail('内嵌工作簿与图表缓存不一致');
  return {numericCategories:labels.length&&labels.every(cell=>cell.type==='number'&&Number.isFinite(Number(cell.value)))?labels.map(cell=>Number(cell.value)):undefined};
}

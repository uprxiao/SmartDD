import { pptxChartValuesSchema,type PptxModernChart } from '@shared/file-pptx-chart';
import { FileError } from '@shared/files';
import { CHARTEX } from './preview-capabilities';
import { OFFICE_REL } from './relationships';
import { xmlEscape } from './xml';

export const MODERN_CHART_COLORS=['14806E','C35B55','5779A8','B68538'] as const;
export const CHARTEX_CONTENT_TYPE='application/vnd.ms-office.chartex+xml';
export const MODERN_AXIS_COLOR='9CAFAB',MODERN_GRID_COLOR='D5E5DE';
export const MODERN_DRAWING='http://schemas.openxmlformats.org/drawingml/2006/main';
export const MODERN_FONT_XML='<cx:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="263D3A"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p></cx:txPr>';
export interface ModernChartDefinition {
  values:readonly number[];categories:readonly string[];valueFormula:string;categoryFormula:string;embeddedId:string;
  axes?:boolean;gridLines?:boolean;legend?:boolean;
}
/** Real ChartEx source, not a legacy chart renamed to a modern type. The
 * categorical histogram uses CT_Aggregation; numerical binning is separate. */
export function modernChartXml(type:PptxModernChart,input:ModernChartDefinition):string{
  const values=pptxChartValuesSchema.parse(input.values),categories=input.categories;
  if(categories.length!==values.length||categories.some(value=>!value||value.length>256))throw new FileError('INVALID_INPUT','图表分类与数据不一致');
  const count=values.length,dim=type==='treemap'?'size':'val';
  const cached=(data:readonly (number|string)[])=>`<cx:lvl ptCount="${count}">${data.map((value,index)=>`<cx:pt idx="${index}">${xmlEscape(String(value))}</cx:pt>`).join('')}</cx:lvl>`;
  const line=(color:string)=>`<a:ln w="12700"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>`;
  const axis=(index:number)=>`<cx:axis id="${index+1}" hidden="${input.axes?'0':'1'}">${index?'<cx:valScaling/>':`<cx:catScaling gapWidth="${type==='histogram'?2/190:30/190}"/>`}${index&&input.gridLines?`<cx:majorGridlines><cx:spPr>${line(MODERN_GRID_COLOR)}</cx:spPr></cx:majorGridlines>`:''}<cx:spPr>${line(MODERN_AXIS_COLOR)}</cx:spPr></cx:axis>`;
  const points=values.map((_,index)=>`<cx:dataPt idx="${index}"><cx:spPr><a:solidFill><a:srgbClr val="${MODERN_CHART_COLORS[index%4]}"/></a:solidFill><a:ln><a:noFill/></a:ln></cx:spPr></cx:dataPt>`).join('');
  return `<cx:chartSpace xmlns:cx="${CHARTEX}" xmlns:a="${MODERN_DRAWING}" xmlns:r="${OFFICE_REL}"><cx:chartData><cx:externalData r:id="${xmlEscape(input.embeddedId)}" autoUpdate="0"/><cx:data id="0"><cx:strDim type="cat"><cx:f>${xmlEscape(input.categoryFormula)}</cx:f>${cached(categories)}</cx:strDim><cx:numDim type="${dim}"><cx:f>${xmlEscape(input.valueFormula)}</cx:f>${cached(values)}</cx:numDim></cx:data></cx:chartData><cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="${type==='histogram'?'clusteredColumn':type}">${points}<cx:dataId val="0"/><cx:layoutPr>${type==='histogram'?'<cx:aggregation/>':''}</cx:layoutPr><cx:axisId>1</cx:axisId><cx:axisId>2</cx:axisId></cx:series></cx:plotAreaRegion>${axis(0)}${axis(1)}</cx:plotArea>${input.legend?'<cx:legend pos="b" align="ctr" overlay="0"/>':''}</cx:chart><cx:spPr><a:noFill/><a:ln><a:noFill/></a:ln></cx:spPr>${MODERN_FONT_XML}</cx:chartSpace>`;
}

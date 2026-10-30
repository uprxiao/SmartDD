import { FileError } from '@shared/files';
import { pptxChartValuesSchema,type PptxModernChart } from '@shared/file-pptx-chart';
import { OFFICE_REL,STRICT_REL,relationshipKind,type OfficeRelationships } from './relationships';
import { CHARTEX,CHARTEX_REL } from './preview-capabilities';
import { OfficeXml,attribute,children,descendants,type OfficeXmlNode } from './xml';

const unsupported=(message:string):never=>{throw new FileError('UNSUPPORTED',message);};
const invalid=(message:string):never=>{throw new FileError('INVALID_INPUT',message);};
const one=(node:OfficeXmlNode,name:string)=>{
  const found=children(node,name,CHARTEX);if(found.length!==1)invalid(`扩展图表 ${name} 节点缺失或重复`);return found[0];
};
const rid=(node:OfficeXmlNode)=>attribute(node,'id',OFFICE_REL)??attribute(node,'id',STRICT_REL);

/** Source data adapter only. It never substitutes a legacy chart or a picture.
 * Values are editable independently of the still-guarded native preview.
 * MS-ODRAWXML CT_Series/CT_Data: dataId -> data -> numDim/lvl/pt text. */
export function modernChartSource(graph:OfficeRelationships,slidePart:string,frame:OfficeXmlNode,read:(part:string)=>OfficeXml){
  const chartRef=one(frame,'chart'),relation=graph.forPart(slidePart).find(row=>row.id===rid(chartRef));
  if(!relation?.part||relation.external||relation.type!==CHARTEX_REL)invalid('扩展图表来源关系无效');
  const part=relation!.part!,doc=read(part),ns=CHARTEX;
  if(doc.root.local!=='chartSpace'||doc.root.uri!==ns)invalid('扩展图表部件类型与来源不匹配');
  if(descendants(doc.root,'extLst',ns).length)unsupported('扩展图表含未适配的扩展数据，原内容保留');
  const chart=one(doc.root,'chart'),plot=one(chart,'plotArea'),region=one(plot,'plotAreaRegion'),series=children(region,'series',ns);
  if(series.length!==1)unsupported('多系列扩展图表尚未接入当前数据编辑');
  const chartPlot=series[0],layout=attribute(chartPlot,'layoutId');
  const histogram=layout==='clusteredColumn'&&(descendants(chartPlot,'binning',ns).length===1||descendants(chartPlot,'aggregation',ns).length===1);
  if(!histogram&&layout!=='funnel'&&layout!=='waterfall'&&layout!=='treemap')unsupported('此扩展图表类型尚未接入数据编辑');
  const type:PptxModernChart=histogram?'histogram':layout as PptxModernChart;
  const dataId=attribute(one(chartPlot,'dataId'),'val'),chartData=one(doc.root,'chartData'),datasets=children(chartData,'data',ns);
  if(!dataId||!/^\d+$/.test(dataId)||Number(dataId)>4294967295)invalid('扩展图表数据编号无效');
  const ids=datasets.map(node=>attribute(node,'id'));
  if(ids.some(id=>!id||!/^\d+$/.test(id)||Number(id)>4294967295)||new Set(ids.map(Number)).size!==ids.length)invalid('扩展图表数据编号重复或无效');
  const data=datasets.find(node=>Number(attribute(node,'id'))===Number(dataId));if(!data)invalid('扩展图表数据来源不存在');
  const dimensions=children(data!,'numDim',ns);
  if(dimensions.length!==1||attribute(dimensions[0],'type')!==(type==='treemap'?'size':'val'))unsupported('扩展图表包含未适配的数值维度');
  const dimension=dimensions[0],formula=one(dimension,'f').text,levels=children(dimension,'lvl',ns);
  if(levels.length!==1)unsupported('多层或缺失的扩展图表数值缓存尚未适配');
  const points=children(levels[0],'pt',ns),rawCount=attribute(levels[0],'ptCount');
  if(!rawCount||!/^\d+$/.test(rawCount)||Number(rawCount)<1||Number(rawCount)>8||Number(rawCount)!==points.length)unsupported('当前扩展图表数据编辑支持 1–8 个连续数值');
  const values=points.map((point,index)=>{
    if(attribute(point,'idx')!==String(index)||point.children.length)unsupported('扩展图表缓存含稀疏、无序或未适配的点');
    const raw=point.text.trim();
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))invalid('扩展图表数值缓存不是有效十进制数');return Number(raw);
  });
  if(!pptxChartValuesSchema.safeParse(values).success)unsupported('当前扩展图表数据编辑只支持有限非负数值');
  const external=one(chartData,'externalData'),embedded=graph.forPart(part).find(row=>row.id===rid(external));
  if(!embedded?.part||embedded.external||!relationshipKind(embedded.type,'package'))unsupported('扩展图表不是本机内嵌工作簿数据，未读取外部来源');
  return {family:'modern' as const,part,doc,chartRef,relation:relation!,embedded:embedded!,type,values,formula,points,ns,chart,plot,chartPlot,data:data!,dimension};
}
export type ModernChartSource=ReturnType<typeof modernChartSource>;

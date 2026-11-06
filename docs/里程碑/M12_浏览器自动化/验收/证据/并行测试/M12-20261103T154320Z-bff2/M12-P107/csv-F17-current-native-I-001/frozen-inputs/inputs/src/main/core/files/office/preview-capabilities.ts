import { FileError } from '@shared/files';
import type { OfficePagesInfo } from '@shared/file-office-pages';
import type { OfficeRelationships } from './relationships';
import { OFFICE_REL,STRICT_REL } from './relationships';
import { OfficeXml,attribute,descendants } from './xml';

export const CHARTEX='http://schemas.microsoft.com/office/drawing/2014/chartex';
export const CHARTEX_REL='http://schemas.microsoft.com/office/2014/relationships/chartEx';
const labels:Readonly<Record<string,string>>={funnel:'漏斗图',waterfall:'瀑布图',treemap:'矩形树图',boxWhisker:'箱线图',paretoLine:'帕累托图',sunburst:'旭日图',regionMap:'地图图表'};

/** The pinned 26.2.4.2 engine imports ChartEx but draws its unknown chart types
 * using a line plotter. Identify live chart references in the validated source
 * Worker; successful PDF export alone does not establish visual support.
 * This is an interim error boundary, not completion of the modern chart scope. */
export function unsupportedOfficeCharts(graph:OfficeRelationships,read:(part:string)=>OfficeXml):string[]{
  const found=new Set<string>();
  for(const part of graph.reachable([graph.mainPart])){
    if(part.endsWith('.rels')||!/(?:\+xml|\/xml)$/.test(graph.contentTypes.get(part)??''))continue;
    const doc=read(part);
    for(const ref of descendants(doc.root,'chart',CHARTEX)){
      const id=attribute(ref,'id',OFFICE_REL)??attribute(ref,'id',STRICT_REL);
      // chartSpace/chart is the chart definition, not a document reference.
      if(!id)continue;
      const relation=graph.forPart(part).find(row=>row.id===id);
      if(!relation?.part||relation.external||relation.type!==CHARTEX_REL)throw new FileError('INVALID_INPUT','扩展图表来源关系无效，未读取外部来源');
      const chart=read(relation.part).root;
      if(chart.local!=='chartSpace'||chart.uri!==CHARTEX)throw new FileError('INVALID_INPUT','扩展图表来源内容不匹配');
      const series=descendants(chart,'series',CHARTEX);
      if(!series.length)found.add('扩展图表');
      for(const item of series){
        const type=attribute(item,'layoutId')??'';
        found.add(type==='clusteredColumn'?(descendants(item,'binning',CHARTEX).length?'直方图':'扩展柱状图'):Object.hasOwn(labels,type)?labels[type]:'扩展图表');
      }
    }
  }
  return [...found].sort();
}

export function assertOfficePreviewSupported(info:OfficePagesInfo):void{
  if(info.unsupportedCharts?.length)throw new FileError('UNSUPPORTED',`暂不支持此文档中的图表预览（${info.unsupportedCharts.join('、')}）。文档内容已保留，可使用其他应用打开。`);
}

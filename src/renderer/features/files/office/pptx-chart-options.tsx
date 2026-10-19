import type { PptxElementInfo } from '@shared/file-pptx-elements';
import type { PptxBuffer } from './pptx-buffer';
import { PPTX_CHARTS,type PptxChartType } from '@shared/file-pptx-chart';

export function PptxChartOptions({pptx,slideId,element}:{pptx:PptxBuffer;slideId:string;element:PptxElementInfo}){
  const options=element.chart?.options;
  if(!options)return null;
  return <>{(['axes','gridLines','legend'] as const).map((key,index)=><label key={key}><input type="checkbox" checked={options[key]} disabled={!pptx.editable||pptx.controlsBusy||pptx.composing||(key!=='legend'&&!options.hasAxes)} onChange={event=>{void pptx.action({type:'chart-options',slideId,elementId:element.id,patch:{[key]:event.currentTarget.checked}});}}/>{['坐标轴','网格线','图例'][index]}</label>)}</>;
}

export function PptxChartType({pptx,slideId,element}:{pptx:PptxBuffer;slideId:string;element:PptxElementInfo}){
  if(!element.chart?.options)return null;
  return <label className="fw-office-field"><span>图表</span><select aria-label="图表类型" value={element.chart.type} disabled={!pptx.editable||pptx.controlsBusy||pptx.composing} onChange={event=>{void pptx.action({type:'chart-type',slideId,elementId:element.id,chartType:event.currentTarget.value as PptxChartType});}}>{PPTX_CHARTS.map(type=><option key={type}>{type}</option>)}</select></label>;
}

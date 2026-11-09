import { FileError } from '@shared/files';
import { pptxChartValuesSchema,type PptxModernChart } from '@shared/file-pptx-chart';

export type HistogramLayout={kind:'category';categories:readonly string[]}|{kind:'bins';count:number;closed:'l'|'r'};
export interface ChartRectangle {x:number;y:number;width:number;height:number;pointIndex:number;label:string}
/** Normalised 220x130 chart coordinates. Normalize before adding values so
 * even eight Number.MAX_VALUE inputs have finite proportional geometry. */
export function modernChartGeometry(type:PptxModernChart,raw:readonly number[],labels:readonly string[],histogram?:HistogramLayout):ChartRectangle[]{
  const values=pptxChartValuesSchema.parse(raw);
  if(labels.length!==values.length)throw new FileError('INVALID_INPUT','图表分类与数值数量不一致');
  const maximum=Math.max(...values)||1,normalized=values.map(value=>value/maximum);
  let plotted=normalized.map((value,index)=>({value,pointIndex:index,label:labels[index]}));
  if(type==='histogram'){
    if(!histogram)throw new FileError('UNSUPPORTED','直方图分组规则缺失');
    if(histogram.kind==='category'){
      if(histogram.categories.length!==values.length)throw new FileError('INVALID_INPUT','直方图分类与数据不一致');
      const groups=new Map<string,{value:number;pointIndex:number;label:string}>();
      histogram.categories.forEach((label,index)=>{const group=groups.get(label);if(group)group.value+=normalized[index];else groups.set(label,{value:normalized[index],pointIndex:groups.size,label});});
      plotted=[...groups.values()];
    }else{
      if(!Number.isInteger(histogram.count)||histogram.count<1||histogram.count>8||!['l','r'].includes(histogram.closed))throw new FileError('UNSUPPORTED','直方图分箱设置尚未适配');
      const low=Math.min(...values),high=Math.max(...values),count=high===low?1:histogram.count;
      plotted=Array.from({length:count},(_,index)=>({value:0,pointIndex:index,label:high===low?String(low):`${low+(high-low)*(index/count)}–${low+(high-low)*((index+1)/count)}`}));
      for(const value of values){const relative=high===low?0:(value-low)/(high-low)*count,index=histogram.closed==='r'?Math.ceil(relative)-1:Math.floor(relative);plotted[Math.max(0,Math.min(count-1,index))].value++;}
    }
  }
  const total=plotted.reduce((sum,row)=>sum+row.value,0)||1,max=Math.max(...plotted.map(row=>row.value))||1,count=plotted.length;
  let accumulated=0;
  return plotted.map((row,index)=>{
    let x:number,y:number,width:number,height:number;
    switch(type){
      case 'funnel':width=row.value/max*180;height=90/count;x=110-width/2;y=15+index*95/count;break;
      case 'waterfall':x=15+index*190/count;width=160/count;height=row.value/total*90;y=110-(accumulated+row.value)/total*90;accumulated+=row.value;break;
      case 'treemap':x=15+accumulated/total*190;y=15;width=row.value/total*190;height=95;accumulated+=row.value;break;
      case 'histogram':x=15+index*190/count;width=(histogram?.kind==='bins'?190:188)/count;height=row.value/max*85;y=110-height;break;
    }
    return {x,y,width,height,pointIndex:row.pointIndex,label:row.label};
  });
}

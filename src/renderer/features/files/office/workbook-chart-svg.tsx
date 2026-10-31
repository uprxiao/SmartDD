import type {OfficeFloatingVector} from '@shared/file-office';
const colours=['#14806e','#c35b55','#5779a8','#b68538','#8e63a8','#4c909b'];
const finite=(value:number|null):value is number=>value!==null&&Number.isFinite(value);

export function WorkbookChart({object}:{object:OfficeFloatingVector}){
 const chart=object.chart;if(!chart)return null;
 const all=chart.series.flatMap(series=>series.values.filter(finite)),magnitude=Math.max(1,...all.map(Math.abs)),scaled=all.map(value=>value/magnitude),min=Math.min(0,...scaled),max=Math.max(0,...scaled),span=max-min||1,n=chart.categories.length;
 const y=(value:number)=>145-(value/magnitude-min)/span*125,base=y(0),x=(index:number)=>35+(index+.5)*270/n;
 const xs=chart.x?.filter(finite)??[],xMagnitude=Math.max(1,...xs.map(Math.abs)),minX=xs.length?Math.min(...xs.map(value=>value/xMagnitude)):0,maxX=xs.length?Math.max(...xs.map(value=>value/xMagnitude)):1;
 const plotX=(index:number)=>chart.x?(chart.x[index]===null?null:35+(chart.x[index]!/xMagnitude-minX)/(maxX-minX||1)*270):x(index);
 if(chart.type==='pie')return <svg viewBox="0 0 320 180" width="100%" height="100%" fill="currentColor" role="img" aria-label={object.name}>
  {chart.series.map((series,index)=>{
   const total=series.values.reduce<number>((sum,value)=>sum+(finite(value)?Math.max(0,value)/magnitude:0),0);let angle=-Math.PI/2;
   const cx=(index+.5)*320/chart.series.length,r=Math.min(65,145/chart.series.length);
   return <g key={index}>{total?series.values.map((value,i)=>{
    if(!finite(value)||value<=0)return null;const fraction=value/magnitude/total,start=angle;angle+=fraction*Math.PI*2;
    const d=fraction===1?`M${cx-r},90a${r},${r} 0 1,0 ${2*r},0a${r},${r} 0 1,0 ${-2*r},0`:`M${cx},90L${cx+r*Math.cos(start)},${90+r*Math.sin(start)}A${r},${r} 0 ${angle-start>Math.PI?1:0},1 ${cx+r*Math.cos(angle)},${90+r*Math.sin(angle)}Z`;
    return <path key={i} d={d} fill={colours[i%colours.length]}><title>{`${chart.categories[i]}: ${value}`}</title></path>;
   }):<text x={cx} y="90" textAnchor="middle" fontSize="11">没有可绘制的数值</text>}<text x={cx} y="172" textAnchor="middle" fontSize="11">{series.name}</text></g>;
  })}
 </svg>;
 return <svg viewBox="0 0 320 180" width="100%" height="100%" fill="currentColor" role="img" aria-label={object.name}>
  <path d={`M30 15V145H310M30 ${base}H310`} fill="none" stroke="#9cafab"/>
  <text x="27" y="18" textAnchor="end" fontSize="9">{(max*magnitude).toPrecision(3)}</text><text x="27" y="146" textAnchor="end" fontSize="9">{(min*magnitude).toPrecision(3)}</text>
  {chart.series.map((series,index)=>{
   const colour=colours[index%colours.length],segments:{index:number;value:number;x:number}[][]=[];let segment:typeof segments[number]=[];
   series.values.forEach((value,i)=>{const px=plotX(i);if(!finite(value)||px===null){segment=[];return;}if(!segment.length)segments.push(segment);segment.push({index:i,value,x:px});});
   return <g key={index}>{chart.type==='bar'?series.values.map((value,i)=>{
    if(!finite(value))return null;const width=270/n/(chart.series.length+1);return <rect key={i} x={x(i)-270/n/2+width*(index+.5)} y={Math.min(base,y(value))} width={width} height={Math.abs(y(value)-base)} fill={colour}><title>{`${series.name} · ${chart.categories[i]}: ${value}`}</title></rect>;
   }):<>{segments.map((part,i)=>{
    const points=part.map(point=>`${point.x},${y(point.value)}`).join(' ');
    return chart.type==='area'?<polygon key={i} points={`${part[0].x},${base} ${points} ${part.at(-1)!.x},${base}`} fill={colour} opacity=".45"/>:chart.type==='line'?<polyline key={i} points={points} fill="none" stroke={colour} strokeWidth="1.5"/>:null;
   })}{segments.flat().map(point=><circle key={point.index} cx={point.x} cy={y(point.value)} r="2" fill={colour}><title>{`${series.name} · ${chart.categories[point.index]}: ${point.value}`}</title></circle>)}</>}</g>;
  })}
  {chart.categories.filter((_,i)=>i===0||i===n-1).map((label,i)=><text key={i} x={i?305:35} y="160" textAnchor={i?'end':'start'} fontSize="10">{label.slice(0,24)}</text>)}
 </svg>;
}

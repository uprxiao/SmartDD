import type {OfficeFloatingVector} from '@shared/file-office';
import {WorkbookChart} from './workbook-chart-svg';

export function WorkbookVector({object,scale=1}:{object:OfficeFloatingVector;scale?:number}){
  if(object.shape?.textBox)return <div role="img" aria-label={object.name} style={{width:'100%',height:'100%',boxSizing:'border-box',padding:4*scale,whiteSpace:'pre-wrap',textAlign:'left',fontSize:14*scale,lineHeight:1.2,overflow:'hidden'}}>{object.shape.text}</div>;
  if(object.kind==='shape'&&object.shape){
    const {geometry,fill,stroke,arrow,text}=object.shape,props={fill,stroke,strokeWidth:1.5,vectorEffect:'non-scaling-stroke' as const};
    const star=Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,r=i%2?35:80;return `${160+Math.cos(a)*r},${90+Math.sin(a)*r}`;}).join(' ');
    const polygons:Record<string,string>={triangle:'160,8 310,172 10,172',diamond:'160,8 310,90 160,172 10,90',star5:star,rightArrow:'10,55 220,55 220,10 310,90 220,170 220,125 10,125',leftArrow:'310,55 100,55 100,10 10,90 100,170 100,125 310,125',plus:'125,10 195,10 195,55 310,55 310,125 195,125 195,170 125,170 125,125 10,125 10,55 125,55',chevron:'10,10 225,10 310,90 225,170 10,170 95,90'};
    return <svg viewBox="0 0 320 180" width="100%" height="100%" preserveAspectRatio="none" aria-label={object.name}>
      {geometry==='ellipse'?<ellipse cx="160" cy="90" rx="150" ry="80" {...props}/>:geometry==='line'?<><line x1="10" y1="10" x2="310" y2="170" {...props}/>{arrow&&<polygon points="310,170 288,145 279,162" fill={stroke}/>}</>:polygons[geometry]?<polygon points={polygons[geometry]} {...props}/>:geometry==='wedgeRoundRectCallout'?<path d="M20 10H300Q310 10 310 20V135Q310 145 300 145H95L55 175L65 145H20Q10 145 10 135V20Q10 10 20 10Z" {...props}/>:<rect x="10" y="10" width="300" height="160" {...props}/>}
      {text&&<text x="160" y="90" dominantBaseline="middle" textAnchor="middle" fontSize="14" fill="#1f1f1f">{text}</text>}
    </svg>;
  }
  return <WorkbookChart object={object}/>;
}

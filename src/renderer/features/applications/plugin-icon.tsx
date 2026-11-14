import {useEffect,useId,useState} from 'react';
import './plugin-icon.css';

type Images={light:string|null;dark:string|null}|null;
const accents:Record<string,string>={mail:'#0d8a80',browser:'#5b5df0',zentao:'#1a8fff'};
export const pluginAccent=(id:string)=>accents[id]??'#6d46e0';
const fallback=[['#f7b23b','#ea7a12'],['#a67cf5','#6d46e0'],['#f27a9b','#d9456f'],['#5cc6f2','#2b8ad6'],['#7fd18b','#3a9f52']];
const hash=(s:string)=>Array.from(s).reduce((h,c)=>(h*31+c.codePointAt(0)!)>>>0,7);

/** Exact approved M13 icon geometry. Package images stay in passive SVG image
 * contexts; no markup from a plugin is inserted into the document. */
export function PluginIcon({id,name='',size=36,images=null}:{id:string;name?:string;size?:number;images?:Images}){
  const gid='wy-plugin-'+useId().replaceAll(':',''),[failed,setFailed]=useState(false);
  const r=size>=56?14:size>=30?9:size>=20?6:3.5,rv=r*36/size;
  const light=images?.light??images?.dark,dark=images?.dark??images?.light;
  useEffect(()=>setFailed(false),[light,dark]);
  if(light&&!failed){const inset=size<=16?1:5;return <svg className="m13-icon m13-plugin-icon image" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{borderRadius:r}}>
    {size>16&&<rect x=".5" y=".5" width="35" height="35" rx={rv-.5} fill="#fff" stroke="#ededed"/>}
    <image className="wy-plugin-image-light" href={light} x={inset} y={inset} width={36-inset*2} height={36-inset*2} preserveAspectRatio="xMidYMid meet" onError={()=>setFailed(true)}/>
    <image className="wy-plugin-image-dark" href={dark!} x={inset} y={inset} width={36-inset*2} height={36-inset*2} preserveAspectRatio="xMidYMid meet" onError={()=>setFailed(true)}/>
  </svg>;}
  const [from,to]=id==='mail'?['#2cc3b2','#0d8a80']:id==='browser'?['#6aa2ff','#6a4ff0']:fallback[hash(id||name)%fallback.length];
  return <svg className="m13-icon m13-plugin-icon" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{borderRadius:r}}>
    <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from}/><stop offset="1" stopColor={to}/></linearGradient></defs>
    <rect width="36" height="36" rx={rv} fill={`url(#${gid})`}/><rect x=".5" y=".5" width="35" height="35" rx={rv-.5} fill="none" stroke="#fff" strokeOpacity=".18"/>
    {id==='mail'?<><rect x="8.5" y="11" width="19" height="14" rx="3" fill="#fff"/><path d="M9.6 12.6 18 19l8.4-6.4" fill="none" stroke="#0f978b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></>:id==='browser'?<><circle cx="18" cy="18" r="9.2" fill="none" stroke="#fff" strokeWidth="2"/><ellipse cx="18" cy="18" rx="4" ry="9.2" fill="none" stroke="#fff" strokeWidth="1.8"/><path d="M9 18h18M10.6 13.4h14.8M10.6 22.6h14.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></>:<text x="18" y="24.2" textAnchor="middle" fontSize="17" fontWeight="600" fill="#fff" fontFamily="-apple-system,system-ui,sans-serif">{Array.from((name||id||'?').trim())[0]?.toUpperCase()}</text>}
  </svg>;
}

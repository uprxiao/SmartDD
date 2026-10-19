import {textFingerprint} from './file-reference-model.mjs';
// Synthetic prototype content revision. Native App uses trusted SHA256 instead.
const normalized=text=>String(text).replace(/\r\n?/g,'\n');
const offset=(n,length)=>Number.isSafeInteger(n)&&n>=0&&n<=length;
const axis=n=>Number.isFinite(n)&&n>=0&&n<=1e9;
export function readPrototypeReading(state,key,text){
 const value=state.readings?.[key],length=normalized(text).length;
 if(!value||value.version!==1||value.hash!==textFingerprint(text)||value.length!==length||!offset(value.selection?.anchor,length)||!offset(value.selection?.head,length)||!value.views||typeof value.views!=='object')return null;
 if(Object.keys(value).some(k=>!['version','hash','length','selection','views'].includes(k))||Object.keys(value.selection).some(k=>!['anchor','head'].includes(k)))return null;
 for(const[mode,position]of Object.entries(value.views))if(!['source','render'].includes(mode)||!position||!axis(position.top)||!axis(position.left)||Object.keys(position).some(k=>!['top','left'].includes(k)))return null;
 return value;
}
export function rememberPrototypeReading(state,key,text,{selection,view}={}){
 if(!state.tabs?.some(t=>!t.attachment&&t.root+'\u0000'+t.path===key))return state;
 const before=readPrototypeReading(state,key,text),length=normalized(text).length;
 if(selection&&(!offset(selection.anchor,length)||!offset(selection.head,length)))return state;
 if(view&&(!['source','render'].includes(view.mode)||!axis(view.top)||!axis(view.left)))return state;
 const next={version:1,hash:textFingerprint(text),length,selection:selection?{anchor:selection.anchor,head:selection.head}:before?.selection??{anchor:0,head:0},views:{...before?.views,...(view?{[view.mode]:{top:view.top,left:view.left}}:{})}};
 if(JSON.stringify(next)===JSON.stringify(before))return state;
 return {...state,readings:{...state.readings,[key]:next}};
}
export function durablePrototypeReadings(state,tabs,closed=[]){
 const allowed=new Set([...tabs,...closed].map(t=>t.root+'\u0000'+t.path));
 return Object.fromEntries(Object.entries(state.readings||{}).filter(([key])=>allowed.has(key)));
}

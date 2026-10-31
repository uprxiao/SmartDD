import {z} from 'zod';
const timestamp=z.iso.datetime({offset:true});
/** Approved M10 minute display in this machine's timezone;source timestamps stay intact. */
export function applicationTimeText(value:string|null|undefined,missing='尚未检查'):string{
 if(value===null||value===undefined||value==='')return missing;
 if(!timestamp.safeParse(value).success)return '时间不可用';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '时间不可用';
 const pad=(part:number)=>String(part).padStart(2,'0');
 return `${String(date.getFullYear()).padStart(4,'0')}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

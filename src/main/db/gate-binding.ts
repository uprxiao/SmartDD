/** macOS assigns st_dev at mount, so it changes across reboots; a persisted gate binding is matched by path and inodes only. */
export function sameGateBinding(stored:unknown,current:string):boolean{
  if(typeof stored!=='string')return false;
  const stable=(text:string)=>{try{return JSON.stringify(JSON.parse(text),(key,value)=>key==='dev'?undefined:value);}catch{return null;}};
  const value=stable(stored);return value!==null&&value===stable(current);
}

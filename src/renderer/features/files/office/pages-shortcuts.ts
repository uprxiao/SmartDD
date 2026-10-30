/** Port of the reviewed M9 presentationShortcut contract (W11/W12). */
export function presentationShortcut(event:{key:string;code?:string;keyCode?:number;metaKey?:boolean;ctrlKey?:boolean;altKey?:boolean;shiftKey?:boolean;defaultPrevented?:boolean;repeat?:boolean;isComposing?:boolean;editableTarget?:boolean}) {
  if(event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.editableTarget)return null;
  const primary=!!event.metaKey!==!!event.ctrlKey,anyPrimary=event.metaKey||event.ctrlKey;
  if(primary&&event.altKey&&!event.shiftKey&&(event.code==='Digit1'||event.key==='1'))return 'grid';
  if(event.altKey)return null;
  if(!anyPrimary&&event.shiftKey&&(event.code==='Digit1'||['1','!'].includes(event.key)))return 'fit';
  if(!primary)return null;
  if(event.key==='0'&&!event.shiftKey)return 'actual';
  if(event.key==='+'||event.key==='='&&!event.shiftKey)return 'zoom-in';
  if(event.key==='-'&&!event.shiftKey)return 'zoom-out';
  return null;
}

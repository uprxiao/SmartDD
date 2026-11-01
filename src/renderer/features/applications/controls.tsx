import {useEffect,useRef,type ComponentType,type ReactNode} from 'react';
import {CircleAlert,LoaderCircle,Mail,Link2,Search,X} from 'lucide-react';
import type {ApplicationId} from '@shared/application-connections';
import {applicationMetadata} from '@shared/application-provider-metadata';
export function AppMark({app,large=false}:{app:ApplicationId;large?:boolean}){const mark=applicationMetadata(app).presentation.mark;return <span className={'m10-appmark '+app+(large?' large':'')}>{mark==='envelope'?<Mail size={large?31:23} strokeWidth={1.7}/>:mark==='zigzag'?<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 10h16L10 22h14M7 16h6" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>:<Link2 size={large?31:23} strokeWidth={1.7}/>}</span>;}
export function IconButton({icon:Icon,label,onClick,disabled=false,expanded}:{icon:ComponentType<{size?:number;strokeWidth?:number}>;label:string;onClick:()=>void;disabled?:boolean;expanded?:boolean}){return <button type="button" className="m10-icon" title={label} aria-label={label} aria-expanded={expanded} disabled={disabled} onClick={onClick}><Icon size={17} strokeWidth={1.6}/></button>;}
export function AppSwitch({checked,label,disabled,onChange}:{checked:boolean;label:string;disabled?:boolean;onChange:(checked:boolean)=>void}){return <button type="button" className={'m10-switch '+(checked?'on':'')} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={()=>onChange(!checked)}><span/></button>;}
export function AppDialog({title,children,onClose,wide=false,closingDisabled=false,className='',heading}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean;closingDisabled?:boolean;className?:string;heading?:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const before=document.activeElement,dialog=ref.current;dialog?.showModal();return()=>{
  // Keep an explicit transfer (for example, a successful terminal insertion).
  // React may run this cleanup after that destination has already focused.
  const active=document.activeElement,restore=active===document.body||active===before||!!dialog?.contains(active);dialog?.close();if(restore&&before instanceof HTMLElement&&before.isConnected)before.focus();
 };},[]);
 return <dialog ref={ref} className={'m10-dialog '+(wide?'wide':'')+(className?' '+className:'')} aria-label={title} data-file-focus-owner="dialog" onCancel={event=>{event.preventDefault();event.stopPropagation();if(event.target===event.currentTarget&&!closingDisabled)close.current();}} onClick={event=>{if(event.target!==event.currentTarget||closingDisabled)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>=r.right||event.clientY<r.top||event.clientY>=r.bottom)close.current();}}><header>{heading??<h2>{title}</h2>}<IconButton icon={X} label="关闭弹窗" disabled={closingDisabled} onClick={onClose}/></header>{children}</dialog>;
}
export function Field({title,children,note}:{title:string;children:ReactNode;note?:string}){return <label className="m10-field"><span>{title}</span>{children}{note&&<small>{note}</small>}</label>;}
export function AppEmpty({title,text,loading=false,error=false,action,onAction}:{title:string;text:string;loading?:boolean;error?:boolean;action?:string;onAction?:()=>void}){const Icon=loading?LoaderCircle:error?CircleAlert:Search;return <div className={'m10-empty '+(loading?'loading':error?'error':'empty')} role={error?'alert':'status'}><Icon size={28}/><h3>{title}</h3><p>{text}</p>{action&&<button type="button" className="m10-button secondary" onClick={onAction}>{action}</button>}</div>;}
export const connectionState=(c:{enabled:boolean;authorization:string;health:string;healthCode?:string|null})=>!c.enabled?'已停用':c.authorization!=='connected'||(c.health==='unavailable'&&['AUTH_FAILED','AUTH_REQUIRED'].includes(c.healthCode??''))?'需要重新连接':c.health==='healthy'?'已验证连接':c.health==='unavailable'?'当前不可用':'待检查';
export {applicationTimeText as timeText} from '@shared/application-time';

/** Keyboard and pointer behavior shared by the catalog and connection menus. */
export function useApplicationMenu(open:string|null,onClose:()=>void){
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  if(!open)return;const menu=document.querySelector<HTMLElement>('.m10-shell [role="menu"]');if(!menu)return;
  const wrapper=menu.closest('.m10-menu-wrap'),trigger=wrapper?.querySelector<HTMLElement>('[aria-expanded="true"]');
  const items=()=>Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  items()[0]?.focus();
  const pointer=(event:PointerEvent)=>{if(event.target instanceof Node&&!wrapper?.contains(event.target))close.current();};
  const click=(event:MouseEvent)=>{if(event.target instanceof Element&&menu.contains(event.target)&&event.target.closest('button'))trigger?.focus();};
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();trigger?.focus();return;}
   if(event.key==='Tab'){close.current();trigger?.focus();return;}
   if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();
   const all=items(),index=all.indexOf(document.activeElement as HTMLButtonElement);all[event.key==='Home'?0:event.key==='End'?all.length-1:(index+(event.key==='ArrowDown'?1:-1)+all.length)%all.length]?.focus();
  };
  document.addEventListener('pointerdown',pointer);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true);};
 },[open]);
}

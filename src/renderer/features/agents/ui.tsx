import { Dialog as Primitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** Keep the approved prototype geometry; the existing Base UI primitive adds
 * production focus trapping, Escape handling and focus return. */
export function AgentDialog({title,sub,onClose,children,footer,wide=false}:{title:string;sub?:string;onClose:()=>void;children:ReactNode;footer?:ReactNode;wide?:boolean}){
  return <Primitive.Root open onOpenChange={open=>{if(!open)onClose();}}>
    <Primitive.Portal><div className="m13-shell">
      <Primitive.Backdrop className="m13-overlay" />
      <Primitive.Popup className={'m13-dialog'+(wide?' wide':'')} style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',zIndex:61}}>
        <div className="m13-dialog-head"><div><Primitive.Title render={<h2/>}>{title}</Primitive.Title>{sub&&<Primitive.Description render={<p/>}>{sub}</Primitive.Description>}</div>
          <Primitive.Close className="m10-icon" aria-label="关闭" title="关闭"><X size={16}/></Primitive.Close></div>
        <div className="m13-dialog-body">{children}</div>{footer&&<div className="m13-dialog-foot">{footer}</div>}
      </Primitive.Popup>
    </div></Primitive.Portal>
  </Primitive.Root>;
}
export function Pill({tone='muted',children}:{tone?:'muted'|'ok'|'warn'|'info';children:ReactNode}){return <span className={'m13-pill '+tone}>{children}</span>;}
export function AgentSwitch({on,label,disabled,title,onChange}:{on:boolean;label:string;disabled?:boolean;title?:string;onChange:()=>void}){
  return <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} disabled={disabled} className={'m13-switch'+(on?' on':'')} onClick={onChange}><i/></button>;
}

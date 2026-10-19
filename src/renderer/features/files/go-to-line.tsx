import{useLayoutEffect,useRef,useState,useId}from'react';
import{ListOrdered,X}from'lucide-react';
import{resolveLineTarget,type LineTarget}from'./line-target';
export interface LineNavigator{
 readonly initialLine:number;readonly lineCount:number;
 preview(value:string):LineTarget;commit(value:string):LineTarget;cancel(focus?:boolean):boolean;
}
export function GoToLineButton({onOpen,disabled=false}:{onOpen:()=>void;disabled?:boolean}){
 return <button type="button" className="fw-icon" title="跳转到行" aria-label="跳转到行" disabled={disabled} onMouseDown={event=>{if(event.button===0)event.preventDefault()}} onClick={onOpen}><ListOrdered size={17} strokeWidth={1.65}/></button>;
}
/** Shared prototype/App controls. Only the supplied navigation adapter differs. */
export function GoToLinePanel({navigator,onClose}:{navigator:LineNavigator;onClose:()=>void}){
 const input=useRef<HTMLInputElement>(null),composing=useRef(false),id=useId(),[value,setValue]=useState(String(navigator.initialLine)),[result,setResult]=useState<LineTarget>(()=>resolveLineTarget(String(navigator.initialLine),navigator.lineCount));
 useLayoutEffect(()=>{input.current?.focus();input.current?.select();return()=>{navigator.cancel(false)}},[navigator]);
 const preview=(next:string)=>{setValue(next);if(!composing.current)setResult(navigator.preview(next))};
 const finish=()=>{const next=navigator.commit(value);setResult(next);if(next.valid)onClose()};
 const cancel=()=>{navigator.cancel(true);onClose()};
 return <section className="fw-line-navigation" role="group" aria-label="跳转到行"><div className="fw-find"><label htmlFor={id}>行号</label><input ref={input} id={id} aria-label="行号" value={value} maxLength={64} aria-invalid={!result.valid} aria-describedby={`${id}-hint${result.valid?'':` ${id}-error`}`} onChange={event=>preview(event.target.value)} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={event=>{composing.current=false;preview(event.currentTarget.value)}} onKeyDown={event=>{if(composing.current||event.nativeEvent.isComposing||event.keyCode===229)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();finish()}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel()}}}/><button type="button" aria-label="关闭跳行" onMouseDown={event=>{if(event.button===0)event.preventDefault()}} onClick={cancel}><X size={15}/></button></div><p className="fw-line-hint" id={`${id}-hint`} role="status">1–{navigator.lineCount} 行，负数从末尾计数{result.valid?` · 第 ${result.line} 行${result.clamped?'（已限制到文档范围）':''}`:''}</p>{!result.valid&&<p className="fw-line-error" role="alert" id={`${id}-error`}>{result.error}</p>}</section>;
}

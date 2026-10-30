import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { createSourceField } from './editor-source';
import { fileConflictDiffGuard, syncFileConflictDiff } from './conflict-diff';
import { codeHighlight } from './code/editor';
import './source-view.css';

interface Props {text:string;original?:string|null;filename?:string;readOnly?:boolean;label:string;onEdit?:(raw:string)=>void;onSelect?:(from:number,to:number)=>void;onComposition?:(active:boolean)=>void}
/** Pure source presentation. No file capability, IPC, save or version decision.
 * Native disk fallback and synthetic prototype hosts share the same CM core. */
export const FileSourceView=forwardRef(function FileSourceView(props:Props,ref){
 const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),source=useRef<ReturnType<typeof createSourceField>|null>(null),slot=useRef(new Compartment()),callbacks=useRef(props);callbacks.current=props;
 const lastReadOnly=useRef(props.readOnly??true);
 const [status,setStatus]=useState(''),syntax=useMemo(()=>props.filename?codeHighlight(props.filename,setStatus):[],[props.filename]);
 const makeState=(raw:string)=>{
  const field=createSourceField(raw);source.current=field;lastReadOnly.current=callbacks.current.readOnly??true;
  return EditorState.create({doc:field.normalized,extensions:[field.extensions,history(),syntax,drawSelection(),highlightSpecialChars(),lineNumbers(),keymap.of([...historyKeymap,...defaultKeymap]),slot.current.of([]),fileConflictDiffGuard(slot.current,field),EditorState.readOnly.of(lastReadOnly.current),EditorView.editable.of(!lastReadOnly.current),EditorView.contentAttributes.of({'aria-label':callbacks.current.label,tabindex:'0',spellcheck:'false'}),EditorView.domEventObservers({compositionstart:()=>callbacks.current.onComposition?.(true),compositionend:()=>callbacks.current.onComposition?.(false)}),EditorView.theme({'&':{height:'100%',backgroundColor:'var(--bg)',color:'var(--fw-code-text)'},'.cm-scroller':{overflow:'auto',fontFamily:'var(--fw-code-font)',fontSize:'var(--fw-code-size)',lineHeight:'var(--fw-code-line)'},'.cm-content':{padding:'4px 0'},'.cm-line':{padding:'0 12px'},'.cm-gutters':{backgroundColor:'var(--bg)',color:'var(--fw-code-comment)',border:'none'},'.cm-cursor':{borderLeftColor:'var(--text)'},'&.cm-focused':{outline:'none'},'&.cm-focused .cm-selectionBackground, .cm-selectionBackground':{backgroundColor:'var(--selected)'}})]});
 };
 useLayoutEffect(()=>{
  const editor=new EditorView({parent:host.current!,state:makeState(callbacks.current.text),dispatchTransactions(transactions,current){
   current.update(transactions);const field=source.current!,value=current.state.field(field.field),selection=current.state.selection.main;
   if(transactions.some(tr=>tr.docChanged))callbacks.current.onEdit?.(value.raw);
   if(transactions.some(tr=>tr.docChanged||tr.selection))callbacks.current.onSelect?.(value.map.cmToRaw(selection.from),value.map.cmToRaw(selection.to));
  }});view.current=editor;
  return()=>{editor.destroy();view.current=null;source.current=null;};
 },[]);
 useLayoutEffect(()=>{
  const editor=view.current;if(!editor)return;
  const current=editor.state.field(source.current!.field);
  if(current.raw!==props.text||lastReadOnly.current!==(props.readOnly??true)){
   const top=editor.scrollDOM.scrollTop,left=editor.scrollDOM.scrollLeft,selected=editor.state.selection.main;
   editor.setState(makeState(props.text));editor.dispatch({selection:{anchor:Math.min(selected.anchor,editor.state.doc.length),head:Math.min(selected.head,editor.state.doc.length)}});editor.scrollDOM.scrollTop=top;editor.scrollDOM.scrollLeft=left;
  }
  const policy=syncFileConflictDiff(editor,slot.current,props.original??null,props.text);host.current!.dataset.inlineDiffState=policy.state;
 });
 useImperativeHandle(ref,()=>({
  focus:()=>view.current?.focus(),get value(){return view.current?.state.doc.toString()??'';},get selectionStart(){return view.current?.state.selection.main.from??0;},get selectionEnd(){return view.current?.state.selection.main.to??0;},get selectionDirection(){const s=view.current?.state.selection.main;return s&&s.anchor>s.head?'backward':'forward';},get isConnected(){return host.current?.isConnected??false;},get scrollTop(){return view.current?.scrollDOM.scrollTop??0;},set scrollTop(value:number){if(view.current)view.current.scrollDOM.scrollTop=value;},get scrollLeft(){return view.current?.scrollDOM.scrollLeft??0;},set scrollLeft(value:number){if(view.current)view.current.scrollDOM.scrollLeft=value;},setSelectionRange(from:number,to:number,direction='forward'){const editor=view.current;if(editor)editor.dispatch({selection:{anchor:direction==='backward'?to:from,head:direction==='backward'?from:to}});},
 }),[]);
 return <div className="fw-source-container">{status&&<div className="fw-save-strip" role="status">{status}</div>}<div className="fw-source-view" ref={host}/></div>;
});

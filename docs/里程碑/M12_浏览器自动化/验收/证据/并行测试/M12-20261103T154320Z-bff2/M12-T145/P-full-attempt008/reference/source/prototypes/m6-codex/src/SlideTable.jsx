import { useRef, useState } from 'react';

// Synthetic design state only. Production cells use measured native geometry.
export function SlideTable({element,editable,onCell,onCells}) {
  const root=useRef(null),composition=useRef(false),currentInput=useRef(null),[active,setActive]=useState(null),[anchor,setAnchor]=useState(null),[input,setInput]=useState(null);
  const changeInput=value=>{currentInput.current=value;setInput(value);};
  const commitInput=cancel=>{const value=currentInput.current;if(!value||composition.current)return null;changeInput(null);if(!cancel)onCell(value.row,value.col,value.text);return value;};
  const rows=element.cells.length,cols=element.cells[0].length;
  const focus=(row,col)=>root.current?.querySelector(`[data-cell="${row}:${col}"]`)?.focus();
  const select=(row,col,extend=false)=>{if(composition.current)return;const prior=currentInput.current;if(prior&&(prior.row!==row||prior.col!==col))commitInput(false);setActive({row,col});if(!extend)setAnchor({row,col});focus(row,col);};
  const move=(key,reverse=false)=>{
    if(!active)return {row:0,col:0};let {row,col}=active;
    if(key==='Tab'){const next=Math.max(0,Math.min(rows*cols-1,row*cols+col+(reverse?-1:1)));return {row:Math.floor(next/cols),col:next%cols};}
    return {row:Math.max(0,Math.min(rows-1,row+(key==='ArrowDown'?1:key==='ArrowUp'?-1:0))),col:Math.max(0,Math.min(cols-1,col+(key==='ArrowRight'?1:key==='ArrowLeft'?-1:0)))};
  };
  const selected=(r,c)=>active&&anchor&&r>=Math.min(active.row,anchor.row)&&r<=Math.max(active.row,anchor.row)&&c>=Math.min(active.col,anchor.col)&&c<=Math.max(active.col,anchor.col);
  const finish=(cancel=false,key)=>{const prior=commitInput(cancel);if(!prior)return;const next=key?move(key):prior;select(next.row,next.col);};
  return <table ref={root} role="grid" aria-label="幻灯片表格" aria-readonly={!editable} className="fo-slide-table" onKeyDown={event=>{
    if(!editable||event.target.tagName==='TEXTAREA'||event.nativeEvent.isComposing||composition.current)return;
    const key=event.key,primary=event.metaKey!==event.ctrlKey;
    if(key==='Escape'){event.preventDefault();event.stopPropagation();setActive(null);setAnchor(null);root.current.closest('.fo-element')?.focus();return;}
    if(!active)return;
    if(primary&&!event.altKey&&!event.shiftKey&&key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();setAnchor({row:0,col:0});setActive({row:rows-1,col:cols-1});return;}
    if(event.metaKey||event.ctrlKey||event.altKey)return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab'].includes(key)){event.preventDefault();event.stopPropagation();const next=move(key,event.shiftKey);select(next.row,next.col,key!=='Tab'&&event.shiftKey);}
    else if(['Enter','F2'].includes(key)){event.preventDefault();event.stopPropagation();changeInput({...active,text:element.cells[active.row][active.col]});}
    else if(['Delete','Backspace'].includes(key)){event.preventDefault();event.stopPropagation();onCells(element.cells.map((row,r)=>row.map((value,c)=>selected(r,c)?'':value)));}
  }}><tbody>{element.cells.map((row,r)=><tr key={r}>{row.map((value,c)=><td key={c} role="gridcell" data-cell={`${r}:${c}`} aria-label={`幻灯片表格 ${r+1}:${c+1}`} aria-selected={Boolean(selected(r,c))} tabIndex={editable&&active?.row===r&&active?.col===c?0:-1} className={(element.headerRow&&r===0||element.headerColumn&&c===0?'header ':'')+(selected(r,c)?'selected':'')}
    onPointerDown={event=>{if(!editable||event.target.tagName==='TEXTAREA')return;event.preventDefault();event.stopPropagation();if(!composition.current)select(r,c,event.shiftKey);}}
    onDoubleClick={()=>{if(editable&&!composition.current){select(r,c);changeInput({row:r,col:c,text:value});}}}>
    {input?.row===r&&input.col===c?<textarea autoFocus aria-label={`编辑幻灯片表格 ${r+1}:${c+1}`} value={input.text} onChange={event=>changeInput({...input,text:event.currentTarget.value})} onCompositionStart={()=>{composition.current=true;}} onCompositionEnd={()=>{composition.current=false;}} onBlur={()=>finish()} onKeyDown={event=>{
      if(event.nativeEvent.isComposing||composition.current)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(true);}
      else if((event.key==='Enter'&&!event.shiftKey||event.key==='Tab')&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();event.stopPropagation();const next=move(event.key==='Enter'?'ArrowDown':'Tab',event.shiftKey);finish();select(next.row,next.col);}
    }}/>:value}
  </td>)}</tr>)}</tbody></table>;
}

// Shared reviewed P gallery; production supplies only verified local image URLs.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import { composing as imeComposing } from './file-ime.mjs';
import { fitImage, stepImageZoom, anchoredImageZoom, scaleWheelDelta } from './file-markdown-model.mjs';
import './image-gallery.css';
import { downloadImageCopy } from './image-download.mjs';
const arrowOwners = ['input','textarea','select',...['menu','slider','spinbutton','combobox','listbox','grid','tree','tablist'].map(role=>'[role="'+role+'"]')].join(',');
function targetOwnsArrows(target){
  if(!(target instanceof HTMLElement))return false;
  if(target.closest(arrowOwners))return true;
  const field=target.closest('[contenteditable]');
  return target.isContentEditable||Boolean(field&&field.getAttribute('contenteditable')!=='false');
}
const boundedZoom=(value,fit)=>Number.isFinite(value)?Math.min(5,Math.max(Math.min(.25,fit),value)):null;
export function ImageGallery({initial,overlay,download,onClose,onDownload,onSaveContent,resolveDownload,onRetry,onNavigate}){
  const [index,setIndex]=useState(initial.pictures.findIndex(p=>p.id===initial.picture.id)),[zoom,setZoom]=useState(1),[fit,setFit]=useState(1),[pan,setPan]=useState({x:0,y:0}),[failure,setFailure]=useState(null),[attempt,setAttempt]=useState(0),[dimensions,setDimensions]=useState({width:1024,height:1024});
  const modal=useRef(null),view=useRef(null), image=useRef(null), pointers=useRef(new Map()),gesture=useRef(null),transform=useRef({zoom,pan});
  const mounted=useRef(true),retryEpoch=useRef(0),selection=useRef(null);
  const downloadOwner=useRef(null),[downloadError,setDownloadError]=useState(''),[saving,setSaving]=useState(false);
  useEffect(()=>{mounted.current=true;const previous=document.activeElement,root=modal.current;return()=>{mounted.current=false;retryEpoch.current++;const active=document.activeElement;if(previous?.isConnected&&(!active||active===document.body||root?.contains(active)))previous.focus({preventScroll:true});};},[]);
  transform.current={zoom,pan,fit}; const picture=initial.pictures[index];
  useEffect(()=>{setDownloadError('');setSaving(false);return()=>downloadOwner.current?.abort();},[picture]);
  const save=async()=>{
    // Disabling the clicked button can drop browser focus onto BODY. Keep
    // keyboard handling inside the dialog while the download is pending.
    view.current?.focus({preventScroll:true});
    downloadOwner.current?.abort(); const owner=new AbortController(); downloadOwner.current=owner;
    setDownloadError('');setSaving(true);
    try {
      if(onDownload!=null)await onDownload(picture);
      else await downloadImageCopy(picture,{saveContent:onSaveContent,resolve:resolveDownload,signal:owner.signal});
    } catch(error) { if(mounted.current&&!owner.signal.aborted)setDownloadError('图片下载失败：'+String(error?.message||error)); }
    finally { if(mounted.current&&!owner.signal.aborted)setSaving(false); }
  };
  useEffect(()=>{onNavigate?.(index);},[index,onNavigate]);
  selection.current={picture,attempt};
  const failedSources=failure?.picture===picture&&failure.attempt===attempt?failure.sources:[];
  const primarySrc=picture.src||'',fallbackSrc=typeof picture.fallbackSrc==='string'?picture.fallbackSrc:'';
  const displaySrc=(!primarySrc||failedSources.includes(primarySrc))&&fallbackSrc&&fallbackSrc!==primarySrc?fallbackSrc:primarySrc;
  const failed=!displaySrc||failedSources.includes(displaySrc);
  const ownsImage=node=>mounted.current&&selection.current.picture===picture&&selection.current.attempt===attempt&&image.current===node;
  const retry=async()=>{
    const epoch=++retryEpoch.current,selected=picture,selectedAttempt=attempt;
    try{
      await onRetry?.(selected);
      if(!mounted.current||retryEpoch.current!==epoch||selection.current.picture!==selected||selection.current.attempt!==selectedAttempt)return;
      setFailure(null);setAttempt(n=>n+1);
    }catch{/* Host reports the actual error; preserve retry. */}
  };
  const clearGesture=()=>{const ids=[...pointers.current.keys()],node=view.current;pointers.current.clear();gesture.current=null;for(const id of ids)if(node?.hasPointerCapture?.(id))node.releasePointerCapture(id);};
  const reset=()=>{clearGesture();if(!view.current||!image.current)return;const next=fitImage(image.current.naturalWidth||1024,image.current.naturalHeight||1024,view.current.clientWidth-64,view.current.clientHeight-32);setFit(next);setZoom(next);setPan({x:0,y:0});};
  useEffect(()=>{retryEpoch.current++;setFailure(null);reset();view.current?.focus();},[index]);
  useEffect(()=>{const el=view.current;const observer=new ResizeObserver(reset);observer.observe(el);const wheel=e=>{if(!e.ctrlKey)return;e.preventDefault();e.stopPropagation();const {zoom:old,pan:p,fit:f}=transform.current;const next=boundedZoom(old*Math.exp(-scaleWheelDelta(e.deltaY,e.deltaMode)/200),f);if(next===null||next===old)return;const r=el.getBoundingClientRect();setPan(anchoredImageZoom(old,next,p,{x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2}));setZoom(next);};el.addEventListener('wheel',wheel,{passive:false});return()=>{observer.disconnect();el.removeEventListener('wheel',wheel);};},[index]);
  const initializeGesture=()=>{const points=[...pointers.current.values()];gesture.current=points.length?{...transform.current,points,distance:points.length===2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0}:null;};
  const pointerMove=e=>{if(!pointers.current.has(e.pointerId))return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const points=[...pointers.current.values()],g=gesture.current;if(!g)return;if(points.length===1&&g.points.length===1)setPan({x:g.pan.x+points[0].x-g.points[0].x,y:g.pan.y+points[0].y-g.points[0].y});if(points.length===2&&g.distance){const next=boundedZoom(g.zoom*Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)/g.distance,fit);if(next===null)return;const r=view.current.getBoundingClientRect(),p={x:(g.points[0].x+g.points[1].x)/2-r.left-r.width/2,y:(g.points[0].y+g.points[1].y)/2-r.top-r.height/2};const base=anchoredImageZoom(g.zoom,next,g.pan,p);setZoom(next);setPan({x:base.x+(points[0].x+points[1].x-g.points[0].x-g.points[1].x)/2,y:base.y+(points[0].y+points[1].y-g.points[0].y-g.points[1].y)/2});}};
  const up=e=>{pointers.current.delete(e.pointerId);if(e.currentTarget.hasPointerCapture?.(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);initializeGesture();};
  const move=delta=>{retryEpoch.current++;setIndex(i=>Math.max(0,Math.min(initial.pictures.length-1,i+delta)));};
  return <><div className="fw-gallery-backdrop" onMouseDown={onClose}/><div ref={modal} className={'fw-gallery '+(overlay?'fw-gallery-overlay':'fw-gallery-legacy')} role="dialog" aria-modal="true" aria-label={overlay?'图片只读叠层':'图片预览'} onKeyDown={e=>{e.stopPropagation();if(imeComposing(e))return;if(e.key==='Escape'){e.preventDefault();onClose();return;}if(e.key==='Tab'){const controls=[...modal.current.querySelectorAll('button:not(:disabled),[tabindex="0"]')];const i=controls.indexOf(document.activeElement);if(i<0||e.shiftKey&&i===0||!e.shiftKey&&i===controls.length-1){e.preventDefault();controls[e.shiftKey?controls.length-1:0]?.focus();}return;}if(e.defaultPrevented||e.altKey||e.metaKey||e.ctrlKey||e.shiftKey||targetOwnsArrows(e.target))return;if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}if(e.key==='ArrowRight'){e.preventDefault();move(1);}}}>
    <header><span>{picture.alt}</span><div>{download&&<button disabled={saving} onClick={save}><Download size={16}/>{overlay?'保存':'下载'}</button>}<button aria-label="关闭图片预览" onClick={onClose}><X size={18}/></button></div></header>
    {downloadError&&<div role="alert" className="fw-gallery-download-error">{downloadError}</div>}
    <div className="fw-gallery-viewport" tabIndex={0} ref={view} onPointerDown={e=>{if(e.button!==0||e.target instanceof Element&&e.target.closest('button'))return;e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});initializeGesture();}} onPointerMove={pointerMove} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
      {failed?<div className="fw-gallery-error"><p>无法加载图片</p><button onClick={retry}>重试加载图片</button></div>:<img ref={image} key={picture.id+':'+attempt+':'+displaySrc} src={displaySrc} alt={picture.alt} referrerPolicy="no-referrer" draggable={false} onError={e=>{if(ownsImage(e.currentTarget))setFailure(previous=>({picture,attempt,sources:[...new Set([...(previous?.picture===picture&&previous.attempt===attempt?previous.sources:[]),displaySrc])]}));}} onLoad={e=>{if(!ownsImage(e.currentTarget))return;setDimensions({width:e.target.naturalWidth,height:e.target.naturalHeight});reset();}} style={{width:dimensions.width,height:dimensions.height,transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}}/>}
    </div><footer>{(overlay||index>0)&&<button aria-label="上一张图片" disabled={index===0} onClick={()=>move(-1)}><ArrowLeft size={17}/></button>}<button aria-label="缩小图片" disabled={zoom<=Math.min(.25,fit)+.00001} onClick={()=>setZoom(stepImageZoom(zoom,-1,fit))}><ZoomOut size={17}/></button><button aria-label="重置图片适应缩放" onClick={reset}>{Math.round(zoom*100)}%</button><button aria-label="放大图片" disabled={zoom>=5} onClick={()=>setZoom(stepImageZoom(zoom,1,fit))}><ZoomIn size={17}/></button>{(overlay||index<initial.pictures.length-1)&&<button aria-label="下一张图片" disabled={index===initial.pictures.length-1} onClick={()=>move(1)}><ArrowRight size={17}/></button>}{overlay&&<span>{index+1} / {initial.pictures.length}</span>}</footer>
  </div></>;
}

import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { Check,ChevronDown,Grid2X2,List,Loader2,Plus,Undo2,Redo2,SlidersHorizontal,Shapes,Table2,Type,X,ChartNoAxesColumn } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OfficePagesResult } from '@shared/file-office-pages';
import type { PptxRenderResult } from '@shared/file-pptx';
import { rpc } from '@renderer/lib/ipc';
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import { bytesFromBase64,fileErrorMessage,type FileBuffer } from '../file-buffer';
import { createPdfSession,type PdfSession } from '../pdf/engine';
import { PdfCanvasPage } from '../pdf/page';
import { CSS_UNITS,PdfCanvasBudget,pdfOffsets,pdfPageWindow,pageAtOffset,type PdfPageSize } from '../pdf/model';
import '../pdf/style.css';
import './style.css';
import './pages-style.css';
import { presentationShortcut } from './pages-shortcuts';
import { ColorField } from './format-panel';
import { PptxSlideMenu } from './pptx-menu';
import { PPTX_SHAPES } from '@shared/file-pptx-elements';
import { PptxObjects,PptxObjectProperties } from './pptx-objects';
import { PptxImagePicker } from './pptx-image-picker';
import { PptxChartValues } from './pptx-chart-values';
import { PptxChartOptions,PptxChartType } from './pptx-chart-options';

interface Ready {identity:string;result:OfficePagesResult|PptxRenderResult;session:PdfSession;doc:PDFDocumentProxy;sizes:PdfPageSize[]}
const clamp=(value:number)=>Math.max(25,Math.min(500,Number.isFinite(value)?value:100));

export function FileOfficePagesPreview({buffer}:{buffer:FileBuffer}){
  const [ready,setReady]=useState<Ready|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[cancelled,setCancelled]=useState(false),[notice,setNotice]=useState('');
  const [zoom,setZoom]=useState(buffer.pdfPosition.zoom),[page,setPage]=useState(buffer.pdfPosition.page),[grid,setGrid]=useState(false),[thumbs,setThumbs]=useState(true);
  const [viewport,setViewport]=useState({top:0,width:800,height:600}),[thumbTop,setThumbTop]=useState(0),[downscaled,setDownscaled]=useState(false);
  const [formatOpen,setFormatOpen]=useState(false);
  const scroll=useRef<HTMLDivElement>(null),rail=useRef<HTMLElement>(null),root=useRef<HTMLElement>(null),active=useRef<(()=>void)|null>(null);
  const presentation=buffer.content.format==='pptx',pptx=presentation?buffer.pptx:null,model=pptx?.result?.state;
  const generation=pptx?`${pptx.id}:${model?.version}`:buffer.file.revision.hash,pdf=ready?.identity===generation?ready:null;
  const info=model?.info??pdf?.result.info,total=info?.slides.length||pdf?.result.pages||1,slide=info?.slides[Math.max(0,Math.min(page,total)-1)];
  const editing=Boolean(pptx?.editable&&pptx.editing);
  const selected=pptx?.selection?.slideId===slide?.id?slide?.elements?.find(element=>element.id===pptx?.selection?.elementId):undefined;
  useEffect(()=>{if(pptx?.pending?.chartValues)setFormatOpen(true);},[pptx?.pending]);
  const budget=useMemo(()=>new PdfCanvasBudget(),[buffer,generation,attempt]);
  const offsets=useMemo(()=>pdfOffsets(pdf?.sizes??[],zoom),[pdf?.sizes,zoom]);
  const windowed=useMemo(()=>pdfPageWindow(offsets,Math.max(0,viewport.top-24),viewport.height),[offsets,viewport]);
  const zoomTo=useCallback((value:number)=>{const next=clamp(value);setZoom(next);buffer.pdfPosition.zoom=next;},[buffer]);
  const navigate=useCallback((value:number)=>{
    const target=pptx?.result?.state.info.slides[Math.max(0,Math.min(total,value)-1)]?.id;
    const apply=()=>{
      const index=target?pptx!.result!.state.info.slides.findIndex(slide=>slide.id===target):-1;if(target&&index<0)return;
      const next=target?index+1:Math.max(1,Math.min(total,value));setPage(next);buffer.pdfPosition.page=next;if(target)pptx!.selectElement(target);if(!presentation&&scroll.current)scroll.current.scrollTop=offsets[next-1];
    };
    if(pptx?.pending||pptx?.composing||pptx?.elementEditing)void pptx.finishInput().then(ok=>{if(ok)apply();});else apply();
  },[total,buffer,presentation,offsets,pptx]);
  useEffect(()=>{if(pptx){setPage(buffer.pdfPosition.page);setZoom(buffer.pdfPosition.zoom);}},[buffer,pptx?.viewRevision]);
  const fit=useCallback(()=>{
    const size=pdf?.sizes[presentation?page-1:0],node=scroll.current;if(!size||!node)return;
    zoomTo(Math.min(100,(node.clientWidth-48)/(size.width*CSS_UNITS)*100,...(presentation?[(node.clientHeight-48)/(size.height*CSS_UNITS)*100]:[])));
  },[pdf?.sizes,presentation,page,zoomTo]);
  useEffect(()=>{
    if(pptx&&!model){setReady(null);setError(buffer.loadError);return;}
    const abort=new AbortController(),id=crypto.randomUUID(),documentId=pptx?.id,version=model?.version;let session:PdfSession|undefined;
    const stop=()=>{abort.abort();void session?.destroy();void (documentId?rpc.files.cancelPptxRender(documentId,id):rpc.files.releaseOfficePages(id)).catch(()=>undefined);};
    const fail=(failure:unknown)=>{if(abort.signal.aborted)return;setReady(null);setError(fileErrorMessage(failure));stop();};
    active.current=stop;setReady(null);setError('');setCancelled(false);setNotice('');setDownscaled(false);
    void(async()=>{
      try {
        const result=documentId?await rpc.files.renderPptx({id:documentId,version:version!,requestId:id}):await rpc.files.openOfficePages({id,ref:buffer.file.ref,baseHash:generation});abort.signal.throwIfAborted();
        if(result.bytes<5||result.bytes>40*1024*1024||(documentId?(result as PptxRenderResult).version!==version:result.sourceHash!==generation)||result.pages<1||result.pages>2000)throw new Error('Office 页面回执无效');
        const bytes=new Uint8Array(result.bytes);
        for(let offset=0;offset<bytes.length;offset+=1024*1024){
          abort.signal.throwIfAborted();const length=Math.min(1024*1024,bytes.length-offset),chunk=bytesFromBase64(await(documentId?rpc.files.pptxChunk(documentId,id,offset,length):rpc.files.officePagesChunk(id,offset,length)));
          if(chunk.length!==length)throw new Error('Office 页面读取不完整');bytes.set(chunk,offset);
        }
        abort.signal.throwIfAborted();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
        if(hash!==result.hash)throw new Error('Office 页面内容校验失败');
        session=await createPdfSession(bytes,{signal:abort.signal,onFailure:fail,onPassword:()=>fail(new Error('Office 预览输出意外要求密码'))});
        abort.signal.throwIfAborted();const doc=await session.ready;if(doc.numPages!==result.pages)throw new Error('Office 预览页数校验失败');
        const first=await session.run(doc.getPage(1));abort.signal.throwIfAborted();const view=first.getViewport({scale:1});
        const sizes=Array.from({length:doc.numPages},()=>({width:view.width,height:view.height}));
        setReady({identity:generation,result,session,doc,sizes:[...sizes]});buffer.pdfPosition.page=Math.max(1,Math.min(buffer.pdfPosition.page,doc.numPages));setPage(buffer.pdfPosition.page);
        for(let start=2;start<=doc.numPages;start+=16){
          for(let number=start;number<Math.min(start+16,doc.numPages+1);number++){
            const item=await session.run(doc.getPage(number));abort.signal.throwIfAborted();const size=item.getViewport({scale:1});sizes[number-1]={width:size.width,height:size.height};
          }
          setReady(prior=>prior&&prior.session===session?{...prior,sizes:[...sizes]}:prior);
        }
      } catch(failure){fail(failure);}
    })();
    return()=>{stop();if(active.current===stop)active.current=null;};
  },[buffer,generation,attempt,buffer.loadError]);
  useEffect(()=>{
    const node=scroll.current;if(!pdf||!node)return;
    const resize=()=>setViewport({top:node.scrollTop,width:node.clientWidth,height:node.clientHeight});resize();
    const observer=new ResizeObserver(resize);observer.observe(node);
    if(!buffer.pdfPosition.initialized){fit();buffer.pdfPosition.initialized=true;}
    return()=>observer.disconnect();
  },[pdf?.session,grid,thumbs,buffer,fit]);
  useEffect(()=>{if(pdf&&!presentation&&scroll.current)scroll.current.scrollTop=offsets[Math.min(buffer.pdfPosition.page,total)-1];},[pdf?.session,presentation]);
  const numbers=presentation?[Math.max(1,Math.min(page,total))]:windowed.numbers;
  const thumbStart=Math.min(Math.max(0,total-1),Math.max(0,Math.floor(thumbTop/95)-2)),thumbEnd=Math.min(total,thumbStart+16);
  const columns=Math.max(1,Math.floor(viewport.width/200)),gridRowHeight=180,gridStart=Math.min(Math.floor((total-1)/columns)*columns,Math.max(0,(Math.floor(viewport.top/gridRowHeight)-1)*columns)),gridEnd=Math.min(total,gridStart+(Math.ceil(viewport.height/gridRowHeight)+2)*columns);
  useEffect(()=>{
    if(!presentation||!pdf)return;
    const node=grid?scroll.current:thumbs?rail.current:null;if(!node)return;
    const top=grid?Math.floor((page-1)/columns)*gridRowHeight:(page-1)*95,height=grid?gridRowHeight:95;
    if(top<node.scrollTop)node.scrollTop=top;else if(top+height>node.scrollTop+node.clientHeight)node.scrollTop=Math.max(0,top+height-node.clientHeight);
  },[page,grid,thumbs,columns,presentation,pdf?.session]);
  const onPlan=useCallback((_page:number,value:boolean)=>{if(value)setDownscaled(true);},[]);
  const keydown=(event:React.KeyboardEvent)=>{
    if(!presentation||event.defaultPrevented||event.repeat||event.nativeEvent.isComposing||event.keyCode===229||pptx?.composing)return;
    const target=event.target as Element;
    // Save the active input without blurring it. Text/navigation shortcuts
    // below remain owned by their focused editor, menu or embedded view.
    if(pptx&&event.metaKey!==event.ctrlKey&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='s'&&!target.closest('[role=menu],[role=dialog],iframe,object,embed')){
      event.preventDefault();event.stopPropagation();void buffer.save();return;
    }
    if(target.closest('input,textarea,select,[contenteditable=true],[role=menu],iframe,object,embed'))return;
    if(editing&&(event.metaKey!==event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='z'){
      event.preventDefault();event.stopPropagation();void pptx!.history(event.shiftKey?'redo':'undo');return;
    }
    const command=presentationShortcut({...event,isComposing:event.nativeEvent.isComposing});
    if(command){
      event.preventDefault();event.stopPropagation();
      if(command==='grid'){if(pptx?.pending||pptx?.composing||pptx?.elementEditing)void pptx.finishInput().then(ok=>{if(ok){setGrid(value=>!value);root.current?.focus({preventScroll:true});}});else{setGrid(value=>!value);root.current?.focus({preventScroll:true});}}
      else if(command==='fit')fit();else if(command==='actual')zoomTo(100);else zoomTo(zoom+(command==='zoom-in'?10:-10));
    }else if(editing&&selected&&(event.metaKey!==event.ctrlKey)&&event.shiftKey&&['f','b'].includes(event.key.toLowerCase())){
      event.preventDefault();event.stopPropagation();const forward=event.key.toLowerCase()==='f';void pptx!.action({type:'element-layer',slideId:slide!.id,elementId:selected.id,direction:event.altKey?(forward?'forward':'backward'):(forward?'front':'back')});
    }else if(editing&&selected&&!pptx!.composing&&!pptx!.controlsBusy&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&(event.key==='Delete'||event.key==='Backspace')){
      event.preventDefault();event.stopPropagation();void pptx!.action({type:'element-delete',slideId:slide!.id,elementId:selected.id}).then(ok=>{if(ok)root.current?.focus({preventScroll:true});});
    }else if(!selected&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
      event.preventDefault();event.stopPropagation();navigate(page+(event.key==='ArrowLeft'?-1:1));
    }
  };
  const paint=(number:number,small=false)=>pdf&&<PdfCanvasPage session={pdf.session} doc={pdf.doc} number={number} size={pdf.sizes[number-1]} zoom={zoom} budget={budget} quota={small?65536:Math.floor(30*1024*1024/Math.max(1,numbers.length))} thumbnail={small} thumbnailSize={grid?{width:160,height:130}:{width:72,height:65}} review={small} onPlan={onPlan} onLink={target=>target.page?navigate(target.page):setNotice(`外部链接：${target.url??''}`)}/>;
  const gridToggle=()=>{if(pptx?.pending||pptx?.composing||pptx?.elementEditing)void pptx.finishInput().then(ok=>{if(ok)setGrid(value=>!value);});else setGrid(value=>!value);};
  const retry=()=>{if(pptx&&!model)void pptx.reload();else setAttempt(value=>value+1);};
  const thumbnail=(number:number,inGrid=false)=>{
    const item=info!.slides[number-1];
    return <PptxSlideMenu key={item.id} container={root} enabled={editing&&!pptx?.controlsBusy&&!pptx?.composing} hidden={item.hidden} canDuplicate={total<2000} canDelete={total>1}
      onVisibility={()=>void pptx?.action({type:'hidden',slideId:item.id,hidden:!item.hidden})}
      onDuplicate={()=>void pptx?.action({type:'duplicate',slideId:item.id})}
      onDelete={()=>void pptx?.action({type:'delete',slideId:item.id}).then(ok=>{if(ok)root.current?.focus({preventScroll:true});})}>
      <button title={item.title} aria-label={`${inGrid?'网格':''}幻灯片 ${number}`} aria-current={number===page?'page':undefined} onClick={()=>navigate(number)} onDoubleClick={inGrid?()=>{navigate(number);setGrid(false);}:undefined}>{paint(number,true)}{inGrid?<span>{number}{item.hidden?' · 隐藏':''}</span>:<small>{number}{item.hidden?' · 隐藏':''}</small>}</button>
    </PptxSlideMenu>;
  };
  return <section ref={root} tabIndex={0} className="fw-pdf fw-office fw-office-pages" aria-label={`${presentation?'PPTX':'DOCX'} 文档预览`} onKeyDown={keydown}>
    <div className="fw-office-header">
      {presentation&&<><button aria-label="切换幻灯片缩略图" aria-pressed={thumbs} disabled={!pdf} onClick={()=>setThumbs(value=>!value)}><List size={15}/></button><button aria-label="网格视图" aria-pressed={grid} disabled={!pdf} onClick={gridToggle}><Grid2X2 size={15}/></button></>}
      <strong>{presentation?'PPTX':'DOCX'}</strong><span className="fw-office-state">{editing?'编辑中':'只读预览'}{pptx?.dirty?' · 已修改':''}</span><span className="fw-office-spacer"/>
      {editing&&<><button aria-label="撤销修改" disabled={pptx!.controlsBusy||!model?.canUndo&&!pptx?.pending} onClick={()=>void pptx!.history('undo')}><Undo2 size={14}/></button><button aria-label="重做修改" disabled={pptx!.controlsBusy||!model?.canRedo} onClick={()=>void pptx!.history('redo')}><Redo2 size={14}/></button></>}
      {pptx&&<button className="fw-office-edit-toggle" disabled={!pptx.editable||pptx.controlsBusy} onClick={()=>{
        if(editing)void pptx.finishInput().then(ok=>{if(ok){pptx.editing=false;setFormatOpen(false);buffer.notify();}});else{pptx.editing=true;buffer.notify();}
      }}>{editing?'完成编辑':'编辑'}</button>}
      {editing&&<button aria-label="格式" aria-pressed={formatOpen} onClick={()=>setFormatOpen(value=>!value)}><SlidersHorizontal size={14}/></button>}
      <DropdownMenu><DropdownMenuTrigger className="fw-office-page-zoom" aria-label="文档缩放" disabled={!pdf}>{Math.round(zoom)}% <ChevronDown size={12}/></DropdownMenuTrigger><DropdownMenuContent align="end" className="fw-file-menu">{[25,50,100,150,200].map(value=><DropdownMenuItem key={value} onClick={()=>zoomTo(value)}>{zoom===value&&<Check size={12}/>}<span>{value}%</span></DropdownMenuItem>)}<DropdownMenuItem onClick={fit}>适合视图</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div>
      {editing&&slide&&<div className="fw-office-insert"><button aria-label="添加幻灯片" disabled={pptx!.controlsBusy||pptx!.composing||total>=2000} onClick={()=>void pptx!.action({type:'add',slideId:slide.id}).then(ok=>{if(ok){setGrid(false);root.current?.focus({preventScroll:true});}})}><Plus size={14}/>幻灯片</button>
        <button aria-label="插入文本框" disabled={pptx!.controlsBusy||pptx!.composing} onClick={()=>void pptx!.action({type:'insert-element',slideId:slide.id,kind:'text'}).then(ok=>{if(ok){setGrid(false);setFormatOpen(true);root.current?.focus({preventScroll:true});}})}><Type size={14}/>文本</button>
        <PptxImagePicker key={`insert-image-${slide.id}`} pptx={pptx!} slideId={slide.id} onApplied={()=>{setGrid(false);setFormatOpen(true);root.current?.focus({preventScroll:true});}}/>
        <button aria-label="插入图表" disabled={pptx!.controlsBusy||pptx!.composing} onClick={()=>void pptx!.action({type:'chart-insert',slideId:slide.id,chartType:'bar'}).then(ok=>{if(ok){setGrid(false);setFormatOpen(true);root.current?.focus({preventScroll:true});}})}><ChartNoAxesColumn size={14}/>图表</button>
        <button aria-label="插入表格" disabled={pptx!.controlsBusy||pptx!.composing} onClick={()=>void pptx!.action({type:'insert-element',slideId:slide.id,kind:'table'}).then(ok=>{if(ok){setGrid(false);setFormatOpen(true);root.current?.focus({preventScroll:true});}})}><Table2 size={14}/>表格</button>
        <DropdownMenu><DropdownMenuTrigger aria-label="插入形状" disabled={pptx!.controlsBusy||pptx!.composing}><Shapes size={14}/>形状<ChevronDown size={12}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="fw-file-menu">{PPTX_SHAPES.map(shape=><DropdownMenuItem key={shape} onClick={()=>void pptx!.action({type:'insert-element',slideId:slide.id,kind:'shape',shape}).then(ok=>{if(ok){setGrid(false);setFormatOpen(true);root.current?.focus({preventScroll:true});}})}>{shape}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      </div>}
      {grid&&!pdf&&<div className="fw-office-notice" role={error?'alert':'status'}>{error|| (cancelled?'已取消预览':'正在排版文档…')}{error||cancelled?<button onClick={retry}>重新预览</button>:<button onClick={()=>{active.current?.();setCancelled(true);}}>取消</button>}</div>}
      <div className="fw-office-page-main">
        {presentation&&info&&thumbs&&!grid&&<nav ref={rail} className="fw-office-slide-rail" aria-label="幻灯片缩略图" onScroll={event=>setThumbTop(event.currentTarget.scrollTop)}><div aria-hidden style={{height:thumbStart*95}}/>{Array.from({length:thumbEnd-thumbStart},(_,i)=>thumbStart+i+1).map(number=>thumbnail(number))}<div aria-hidden style={{height:(total-thumbEnd)*95}}/></nav>}
        <div ref={scroll} className={`fw-office-page-scroll ${grid?'is-grid':''}`} onScroll={event=>{
          const node=event.currentTarget;setViewport({top:node.scrollTop,width:node.clientWidth,height:node.clientHeight});
          if(!presentation){const next=pageAtOffset(offsets,node.scrollTop+Math.min(100,node.clientHeight/3))+1;setPage(next);buffer.pdfPosition.page=next;}
        }}>
          {presentation&&info&&grid?<div className="fw-office-slide-grid" style={{gridTemplateColumns:`repeat(${columns},minmax(0,1fr))`}}><div aria-hidden style={{gridColumn:'1/-1',height:Math.floor(gridStart/columns)*gridRowHeight}}/>{Array.from({length:Math.max(0,gridEnd-gridStart)},(_,i)=>gridStart+i+1).map(number=>thumbnail(number,true))}<div aria-hidden style={{gridColumn:'1/-1',height:Math.ceil((total-gridEnd)/columns)*gridRowHeight}}/></div>:<div className="fw-office-page-content">
            {presentation&&slide&&info?<div className="fw-office-page-item fw-pptx-stage" key={slide.id} onPointerDown={event=>{if(editing&&event.button===0&&!(event.target as Element).closest('.fw-pptx-object,.fw-pptx-table,button'))void pptx!.finishInput().then(ok=>{if(ok)pptx!.selectElement(slide.id);});}} style={{width:(info.width??680)*CSS_UNITS*zoom/100,height:(info.height??450)*CSS_UNITS*zoom/100}}>
              <div className={`fw-pptx-projection${editing?' is-editing':''}`}>{pdf?paint(page):<div key="loading" className="fw-empty fw-office-page-loading" role={error?'alert':'status'} style={presentation&&info?{height:(info.height??450)*CSS_UNITS*zoom/100,width:(info.width??680)*CSS_UNITS*zoom/100}:undefined}>{!error&&!cancelled&&<Loader2 size={20} className="animate-spin"/>}<p>{error?'文档预览失败':cancelled?'已取消预览':'正在排版文档…'}</p>{error&&<pre>{error}</pre>}{error||cancelled?<button onClick={retry}>重新预览</button>:<button onClick={()=>{active.current?.();setCancelled(true);}}>取消</button>}</div>}</div>
              {editing&&pptx&&<PptxObjects pptx={pptx} slide={slide} zoom={zoom} enabled={editing} container={root} tableLayout={pdf&&'tableLayout' in pdf.result?pdf.result.tableLayout:undefined}/>}
            </div>:!pdf?<div key="loading" className="fw-empty fw-office-page-loading" role={error?'alert':'status'} style={presentation&&info?{height:(info.height??450)*CSS_UNITS*zoom/100,width:(info.width??680)*CSS_UNITS*zoom/100}:undefined}>{!error&&!cancelled&&<Loader2 size={20} className="animate-spin"/>}<p>{error?'文档预览失败':cancelled?'已取消预览':'正在排版文档…'}</p>{error&&<pre>{error}</pre>}{error||cancelled?<button onClick={retry}>重新预览</button>:<button onClick={()=>{active.current?.();setCancelled(true);}}>取消</button>}</div>:<>
              <div aria-hidden style={{height:windowed.before}}/>{numbers.map(number=><div className="fw-office-page-item" key={number}>{paint(number)}</div>)}<div aria-hidden style={{height:windowed.after}}/>
            </>}
            {presentation&&slide&&(editing||slide.notes)&&<label key={`notes-${slide.id}`} className="fw-office-speaker-notes"><span>演讲者备注</span>{pptx?<textarea aria-label="演讲者备注" readOnly={!editing} maxLength={65536} value={pptx.pendingFor(slide.id)?.text??slide.notes}
              onChange={event=>pptx.setNotes(slide.id,event.currentTarget.value,slide.notes,model?.version)}
              onCompositionStart={()=>pptx.setComposing(true)} onCompositionEnd={event=>{pptx.setNotes(slide.id,event.currentTarget.value,slide.notes,model?.version);pptx.setComposing(false);}}
              onBlur={()=>{if(!pptx.composing)void pptx.flush({slideId:slide.id});}}/>:<p>{slide.notes}</p>}</label>}
          </div>}
        </div>
        {editing&&formatOpen&&slide&&<aside className="fw-office-inspector" aria-label="演示文稿格式"><div><strong>格式</strong><button aria-label="关闭格式面板" onClick={()=>setFormatOpen(false)}><X size={14}/></button></div>{selected?.kind==='chart'&&<><PptxChartType pptx={pptx!} slideId={slide.id} element={selected}/><PptxChartValues key={`chart-values-${slide.id}/${selected.id}`} pptx={pptx!} slideId={slide.id} element={selected}/></>}<fieldset disabled={pptx!.controlsBusy||pptx!.composing}>{selected?<>{selected.kind==='chart'&&<PptxChartOptions pptx={pptx!} slideId={slide.id} element={selected}/>}{selected.kind==='image'&&<PptxImagePicker key={`replace-image-${slide.id}/${selected.id}`} pptx={pptx!} slideId={slide.id} elementId={selected.id}/>}<PptxObjectProperties key={`${slide.id}/${selected.id}`} element={selected} tableLayout={pdf&&'tableLayout' in pdf.result?pdf.result.tableLayout?.find(layout=>layout.slideId===slide.id&&layout.elementId===selected.id):undefined} onAction={action=>pptx!.action({...action,slideId:slide.id,elementId:selected.id})}/></>:<ColorField key={slide.id} label={slide.background?'幻灯片背景':'设置纯色背景'} name="幻灯片背景" value={slide.background??'#ffffff'} onValue={color=>pptx!.action({type:'background',slideId:slide.id,color})}/>}</fieldset></aside>}
      </div>
      <div className="fw-office-page-status" role="status">第 {page} / {total} 页{downscaled?' · 页面已降低渲染分辨率':''}</div>
      {pdf?.result.warnings.map(message=><div className="fw-office-notice" key={message}>{message}</div>)}{notice&&<div className="fw-office-notice" role="status">{notice}</div>}
  </section>;
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseAsync, renderDocument } from 'docx-preview';
import './docx-pages.css';

// Documents may contain arbitrary styles/relationships. They render in an
// origin-accessible, scriptless frame; no network, forms or navigation rights.
const FRAME='<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data: blob:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><style>html,body{margin:0;overflow:hidden}body{background:transparent}.docx-wrapper{padding:20px!important;background:transparent!important}.docx-wrapper>section.docx{margin:0 auto 20px!important;box-shadow:0 1px 5px #0002}*{box-sizing:border-box}</style></head><body></body></html>';
const OPTIONS={className:'docx',inWrapper:true,breakPages:true,ignoreLastRenderedPageBreak:false,renderChanges:false,renderComments:false,renderAltChunks:false,useBase64URL:true};
const pagesOf=node=>[...node.querySelectorAll('section.docx')];
function Thumbnail({page,styles}) {
  const frame=useRef(null),styleRoot=useRef(null),[loaded,setLoaded]=useState(0);
  useLayoutEffect(()=>{
    const doc=frame.current?.contentDocument;if(!doc||!page)return;
    styleRoot.current?.remove();const root=doc.createElement('div');styleRoot.current=root;doc.head.append(root);
    for(const node of styles)root.append(node.cloneNode(true));
    const clone=page.cloneNode(true);clone.style.margin='0';clone.style.boxShadow='none';
    doc.body.replaceChildren(clone);doc.body.style.transformOrigin='top left';
    const width=page.offsetWidth||794,height=page.offsetHeight||1123,scale=Math.min(72/width,84/height);
    doc.body.style.transform=`scale(${scale})`;
    return()=>root.remove();
  },[page,styles,loaded]);
  return <iframe ref={frame} title="页面缩略图" tabIndex={-1} aria-hidden sandbox="allow-same-origin" srcDoc={FRAME} onLoad={()=>setLoaded(value=>value+1)}/>;
}

/** Shared real OOXML renderer. Callers own byte authorization and source
 * lifetime. This component has no file write or IPC interface. */
export function DocxPages({bytes,hasRevisions=false,redlinesEnabled=false,commentDraft='',onRequestEdits,onDownload,onSelectionChange,onPageChange,onReady,onError,position}) {
  const root=useRef(null),viewport=useRef(null),frame=useRef(null),rendered=useRef(null),callbacks=useRef({});
  callbacks.current={onReady,onError,onSelectionChange,onPageChange};
  const [frameReady,setFrameReady]=useState(0),[ready,setReady]=useState(null),[error,setError]=useState(''),[redlines,setRedlines]=useState(true);
  const [zoom,setZoom]=useState(position?.zoom??100),[current,setCurrent]=useState(position?.page??1),[docked,setDocked]=useState(false),[notice,setNotice]=useState('');
  const scrollRestore=useRef(null);
  useEffect(()=>{
    const doc=frame.current?.contentDocument;if(!frameReady||!doc||!bytes)return;
    let stopped=false;const abort=new AbortController();setReady(null);setError('');setRedlines(true);
    const fail=failure=>{if(stopped)return;setError(failure instanceof Error?failure.message:String(failure));callbacks.current.onError?.(failure);};
    const clean=doc.createElement('div'),tracked=doc.createElement('div'),cleanStyles=doc.createElement('div'),trackedStyles=doc.createElement('div');
    doc.body.replaceChildren(clean,tracked);doc.head.append(cleanStyles,trackedStyles);tracked.hidden=true;
    const deadline=setTimeout(()=>{abort.abort();fail(new Error('DOCX 排版超过 20 秒'));},20000);
    const currentJob=()=>!stopped&&!abort.signal.aborted&&frame.current?.contentDocument===doc;
    (async()=>{
      const model=await parseAsync(bytes,OPTIONS);if(!currentJob())return;
      await renderDocument(model,clean,cleanStyles,OPTIONS);if(!currentJob())return;
      if(hasRevisions){
        // renderDocument splits paragraphs/runs in place at page breaks.
        // Each variant needs its own model so the clean render cannot remove
        // a split run's remaining text from the tracked render.
        const trackedModel=await parseAsync(bytes,OPTIONS);if(!currentJob())return;
        await renderDocument(trackedModel,tracked,trackedStyles,{...OPTIONS,renderChanges:true});if(!currentJob())return;
      }
      const active=hasRevisions?tracked:clean;clean.hidden=hasRevisions;tracked.hidden=!hasRevisions;
      const pages=pagesOf(active);if(!pages.length||pages.length>2000)throw new Error('DOCX 没有可预览的页面或超过 2000 页');
      // No HTML links can navigate the embedded document. Hosts may present
      // links separately after their own policy check.
      const preventLink=event=>{if(event.target.closest?.('a'))event.preventDefault();};
      const selection=()=>{const value=doc.getSelection(),activePages=pagesOf(clean.hidden?tracked:clean),index=value?activePages.findIndex(page=>page.contains(value.anchorNode)&&page.contains(value.focusNode)):-1;callbacks.current.onSelectionChange?.(value?.toString().trim()&&index>=0?{text:value.toString(),page:index+1}:null);};
      doc.addEventListener('click',preventLink,true);doc.addEventListener('selectionchange',selection);
      rendered.current={doc,clean,tracked,cleanStyles,trackedStyles,preventLink,selection};
      clearTimeout(deadline);setReady({pages,styles:[...(hasRevisions?trackedStyles:cleanStyles).querySelectorAll('style')]});
      callbacks.current.onReady?.({pages:pages.length,hasRevisions});
    })().catch(fail);
    return()=>{
      stopped=true;abort.abort();clearTimeout(deadline);
      const value=rendered.current;if(value?.doc===doc){doc.removeEventListener('click',value.preventLink,true);doc.removeEventListener('selectionchange',value.selection);rendered.current=null;}
      clean.remove();tracked.remove();cleanStyles.remove();trackedStyles.remove();
    };
  },[bytes,hasRevisions,frameReady]);
  const updatePage=()=>{
    if(!ready||!viewport.current)return;
    const bounds=viewport.current.getBoundingClientRect();let best=1,overlap=-1;
    for(let index=0;index<ready.pages.length;index++){
      const box=ready.pages[index].getBoundingClientRect(),offset=frame.current.getBoundingClientRect().top;
      const visible=Math.max(0,Math.min(bounds.bottom,offset+box.bottom)-Math.max(bounds.top,offset+box.top));
      if(visible>overlap){best=index+1;overlap=visible;}
    }
    setCurrent(best);if(position)position.page=best;callbacks.current.onPageChange?.(best);
  };
  useLayoutEffect(()=>{
    if(!ready||!frame.current)return;
    const doc=frame.current.contentDocument;doc.body.style.zoom=String(zoom/100);
    const resize=()=>{if(!frame.current)return;frame.current.style.minWidth=`${Math.ceil((ready.pages[0].offsetWidth+40)*zoom/100)}px`;frame.current.style.height=`${Math.ceil(doc.body.getBoundingClientRect().height)}px`;updatePage();};
    const observer=new ResizeObserver(resize);observer.observe(doc.body);resize();
    if(scrollRestore.current!==null){viewport.current.scrollTop=scrollRestore.current;scrollRestore.current=null;updatePage();}
    if(position)position.zoom=zoom;
    return()=>observer.disconnect();
  },[ready,zoom]);
  const navigate=number=>{
    const page=ready?.pages[number-1],node=viewport.current;if(!page||!node)return;
    const box=page.getBoundingClientRect(),offset=frame.current.getBoundingClientRect().top-node.getBoundingClientRect().top;
    node.scrollTop+=offset+box.top;setCurrent(number);if(position)position.page=number;callbacks.current.onPageChange?.(number);
  };
  const toggle=()=>{
    if(commentDraft.trim()){setNotice('请先处理评论草稿。');return;}
    const value=rendered.current;if(!value||!hasRevisions||!redlinesEnabled)return;
    scrollRestore.current=viewport.current.scrollTop;value.doc.getSelection()?.removeAllRanges();window.getSelection()?.removeAllRanges();callbacks.current.onSelectionChange?.(null);
    const next=!redlines,active=next?value.tracked:value.clean;
    value.clean.hidden=next;value.tracked.hidden=!next;setRedlines(next);
    setReady({pages:pagesOf(active),styles:[...(next?value.trackedStyles:value.cleanStyles).querySelectorAll('style')]});
  };
  const fit=()=>{
    const page=ready?.pages[0],node=viewport.current;if(!page||!node)return;
    setZoom(Math.max(25,Math.min(400,Math.floor((node.clientWidth-40)/(page.offsetWidth||794)*100))));
  };
  const total=ready?.pages.length??0;
  return <section className="docx-preview" ref={root} data-route="legacy" data-pages={total}>
    <header className="docx-header"><strong>DOCX</strong><span>只读预览</span><span className="docx-spacer"/>
      {onRequestEdits&&<button onMouseDown={event=>event.preventDefault()} onClick={onRequestEdits}>Request edits</button>}
      {onDownload&&<button aria-label="下载 DOCX" onClick={onDownload}>下载</button>}
      {hasRevisions&&redlinesEnabled&&<button onClick={toggle} aria-pressed={redlines}>{redlines?'Hide redlines':'Show redlines'}</button>}
      <details className="docx-zoom"><summary aria-label="DOCX 缩放">{Math.round(zoom)}%</summary><div>{[50,75,100,125,150,200].map(value=><button key={value} onClick={event=>{setZoom(value);event.currentTarget.closest('details').open=false;}}>{value}%</button>)}<button onClick={event=>{fit();event.currentTarget.closest('details').open=false;}}>Fit</button></div></details>
    </header>
    <div className="docx-main">
      {total>1&&<nav className={`docx-rail${docked?' docked':''}`} aria-label="DOCX 页面缩略图"><button aria-label={docked?'取消停靠缩略图':'停靠缩略图'} aria-pressed={docked} onClick={()=>setDocked(value=>!value)}>{docked?'取消停靠':'停靠'}</button>{ready.pages.map((page,index)=><button key={index} aria-label={`第 ${index+1} 页`} aria-current={current===index+1?'page':undefined} onClick={()=>navigate(index+1)}>{Math.abs(index+1-current)<=4&&<Thumbnail page={page} styles={ready.styles}/>}<span>{index+1}</span></button>)}</nav>}
      <div className="docx-scroll" ref={viewport} onScroll={updatePage} tabIndex={0} aria-label="DOCX 页面内容">
        {!ready&&!error&&<div className="docx-loading" role="status">正在排版文档…</div>}
        {error&&<div className="docx-loading" role="alert">{error}</div>}
        <iframe ref={frame} title="DOCX 只读正文" sandbox="allow-same-origin" srcDoc={FRAME} onLoad={()=>setFrameReady(value=>value+1)} style={{visibility:ready&&!error?'visible':'hidden'}}/>
      </div>
    </div>
    {ready&&<footer role="status">第 {current} / {total} 页</footer>}{notice&&<p role="status">{notice}</p>}
  </section>;
}

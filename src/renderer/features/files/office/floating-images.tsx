import {useEffect,useState,type CSSProperties} from 'react';
import type {OfficeDrawingAnchor,OfficeFloatingImage,OfficeFloatingObject,OfficeFloatingVector} from '@shared/file-office';
import {WorkbookVector} from './workbook-vector';
import type {OfficeClient} from './client';
import type {OfficeAxis} from './layout';
import {fileErrorMessage} from '../file-buffer';

type Axes={rows:OfficeAxis;columns:OfficeAxis};
export function officeDrawingBox(anchor:OfficeDrawingAnchor,axes:Axes):{x:number;y:number;width:number;height:number}|null {
  let x:number,y:number,width:number,height:number;
  if(anchor.kind==='absoluteAnchor')({x,y}=anchor.position,{width,height}=anchor.extent);
  else {
    if(anchor.from.row>=axes.rows.count || anchor.from.column>=axes.columns.count)return null;
    x=axes.columns.offsets[anchor.from.column]+anchor.from.x;y=axes.rows.offsets[anchor.from.row]+anchor.from.y;
    if(anchor.kind==='oneCellAnchor')({width,height}=anchor.extent);
    else {
      if(anchor.to.row>=axes.rows.count || anchor.to.column>=axes.columns.count)return null;
      width=axes.columns.offsets[anchor.to.column]+anchor.to.x-x;height=axes.rows.offsets[anchor.to.row]+anchor.to.y-y;
    }
  }
  return [x,y,width,height].every(Number.isFinite) && x>=0 && y>=0 && width>0 && height>0 ? {x,y,width,height} : null;
}

function FloatingImage({client,sheetId,image,style,selected,onSelect,onDismiss}:{client:OfficeClient;sheetId:string;image:OfficeFloatingImage;style:CSSProperties;selected:boolean;onSelect:()=>void;onDismiss:()=>void}) {
  const [url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    let alive=true,ownedURL='';setUrl('');setError('');
    void client.drawingImage(sheetId,image.id,image.media.sha256).then(data=>{
      if(!alive)return;
      const bytes=new Uint8Array(data.bytes);
      ownedURL=URL.createObjectURL(new Blob([bytes.buffer],{type:data.mime}));setUrl(ownedURL);
    },failure=>{if(alive)setError(fileErrorMessage(failure));});
    return()=>{alive=false;if(ownedURL)URL.revokeObjectURL(ownedURL);};
  },[client,sheetId,image.id,image.media.sha256]);
  const name=image.name || '图片';
  return <button type="button" className="fw-office-floating-image" style={style} aria-label={`选择图片 ${name}`} aria-pressed={selected} data-office-object={image.id} data-media-hash={image.media.sha256} title={error || name} onPointerDown={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()} onClick={onSelect} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onDismiss();return;}
    if((event.metaKey || event.ctrlKey) && ['s','z'].includes(event.key.toLowerCase()))return;
    event.stopPropagation();
  }}>
    {url ? <img src={url} alt={name} draggable={false} onError={()=>setError('图片无法显示，原对象保留')} /> : !error && <span role="status">正在读取图片…</span>}
    {error && <span role="alert">{error}</span>}
  </button>;
}

export function WorkbookFloatingImages({client,sheetId,images,axes,scale,scroll,logicalTop,logicalLeft,selected,onSelect,onEditText,onDismiss}:{client:OfficeClient;sheetId:string;images:OfficeFloatingObject[];axes:Axes;scale:number;scroll:{left:number;top:number;width:number;height:number};logicalTop:number;logicalLeft:number;selected:string|null;onSelect:(image:OfficeFloatingObject)=>void;onEditText?:(object:OfficeFloatingVector)=>void;onDismiss:()=>void}) {
  return <>{images.map(image=>{
    const box=officeDrawingBox(image.anchor,axes);if(!box)return null;
    if(box.x+box.width<logicalLeft || box.y+box.height<logicalTop || box.x>logicalLeft+scroll.width/scale || box.y>logicalTop+scroll.height/scale)return null;
    const style:CSSProperties={left:scroll.left+(box.x-logicalLeft)*scale+36,top:scroll.top+(box.y-logicalTop)*scale+27,width:box.width*scale,height:box.height*scale};
    return image.kind==='image'?<FloatingImage key={image.id} {...{client,sheetId,image,style}} selected={selected===image.id} onSelect={()=>onSelect(image)} onDismiss={onDismiss}/>:<button key={image.id} type="button" className="fw-office-floating-image" style={style} aria-label={`${image.shape?.textBox?'选择文本框':image.kind==='shape'?'选择形状':'选择图表'} ${image.name}`} aria-pressed={selected===image.id} data-office-object={image.id} onPointerDown={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()} onClick={()=>onSelect(image)} onDoubleClick={()=>{if(image.shape?.textBox)onEditText?.(image);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onDismiss();}else if(image.shape?.textBox&&['Enter','F2'].includes(event.key)){event.preventDefault();event.stopPropagation();onEditText?.(image);}else if(!((event.metaKey||event.ctrlKey)&&['s','z'].includes(event.key.toLowerCase())))event.stopPropagation();}}><WorkbookVector object={image} scale={scale}/></button>;
  })}</>;
}

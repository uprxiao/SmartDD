import { useEffect,useRef,useState,type RefObject } from 'react';
import { Bold,Italic,Underline,Strikethrough } from 'lucide-react';
import type { OfficeSlideInfo } from '@shared/file-office-pages';
import { PPTX_SHAPES,PPTX_PRESETS,type PptxElementInfo } from '@shared/file-pptx-elements';
import type { PptxAction } from '@shared/file-pptx';
import { pptxPendingKey } from '@shared/file-pptx';
import type { PptxTableAddress,PptxTableLayout } from '@shared/file-pptx-table';
import { CSS_UNITS } from '../pdf/model';
import type { PptxBuffer } from './pptx-buffer';
import { PptxElementMenu } from './pptx-menu';
import { ColorField } from './format-panel';
import { PptxTableObject } from './pptx-table-object';

export const PPTX_LAYERS=[['front','置于顶层'],['forward','上移一层'],['backward','下移一层'],['back','置于底层']] as const;

/** Hit areas use source transforms over the native page. A regenerated page
 * must not unmount a live editor or replace its unfinished input. */
export function PptxObjects({pptx,slide,zoom,enabled,container,tableLayout}:{pptx:PptxBuffer;slide:OfficeSlideInfo;zoom:number;enabled:boolean;container:RefObject<HTMLElement|null>;tableLayout?:PptxTableLayout[]}){
  const request=useRef(0),mounted=useRef(true),scale=CSS_UNITS*zoom/100,sourceVersion=pptx.result?.state.version;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;};},[]);
  const select=async(element:PptxElementInfo|null,text=false,cell?:PptxTableAddress):Promise<boolean>=>{
    const next=++request.current;if(pptx.composing)return false;
    if(pptx.elementEditing&&pptxPendingKey(pptx.elementEditing)!==pptxPendingKey({slideId:slide.id,elementId:element?.id,cell})&&!await pptx.finishElementText(pptx.elementEditing))return false;
    if(!mounted.current||next!==request.current)return false;
    if(cell&&element){pptx.selectTableCell(slide.id,element.id,cell);if(text)return pptx.beginTableText(slide.id,element.id,cell);}
    else{pptx.selectElement(slide.id,element?.id);if(text&&element)return pptx.beginElementText(slide.id,element.id);}return true;
  };
  return <div className="fw-pptx-objects" aria-label="幻灯片对象" onPointerDown={event=>{if(event.target===event.currentTarget&&event.button===0)void select(null);}}>
    {(slide.elements??[]).filter(element=>(element.pageBox||!element.parentId&&element.box)&&!element.hidden).map(element=>{
      if(element.table)return <PptxElementMenu key={element.id} container={container} enabled={enabled&&!pptx.controlsBusy&&!pptx.composing} onSelect={()=>void select(element)} onLayer={direction=>void pptx.action({type:'element-layer',slideId:slide.id,elementId:element.id,direction})} onDelete={()=>void pptx.action({type:'element-delete',slideId:slide.id,elementId:element.id}).then(ok=>{if(ok)container.current?.focus({preventScroll:true});})}>
        <div className="fw-pptx-table-wrapper"><PptxTableObject pptx={pptx} slideId={slide.id} element={element} layout={tableLayout?.find(layout=>layout.slideId===slide.id&&layout.elementId===element.id)} scale={scale} enabled={enabled} container={container} onSelect={(cell,text)=>select(element,text,cell)} onExit={()=>{void select(null);container.current?.focus({preventScroll:true});}}/></div>
      </PptxElementMenu>;
      const box=(element.pageBox??element.box)!,selected=pptx.selection?.slideId===slide.id&&pptx.selection.elementId===element.id;
      const textEditing=enabled&&!pptx.elementEditing?.cell&&!pptx.elementEditing?.chartValues&&element.text!==undefined&&pptx.elementEditing?.slideId===slide.id&&pptx.elementEditing.elementId===element.id;
      const value=pptx.pendingFor(slide.id,element.id)?.text??element.text??'';
      return <PptxElementMenu key={element.id} container={container} enabled={enabled&&!pptx.controlsBusy&&!pptx.composing} onSelect={()=>void select(element)} onLayer={direction=>void pptx.action({type:'element-layer',slideId:slide.id,elementId:element.id,direction})} onDelete={()=>void pptx.action({type:'element-delete',slideId:slide.id,elementId:element.id}).then(ok=>{if(ok)container.current?.focus({preventScroll:true});})}>
        <div role={textEditing?'group':'button'} tabIndex={0} aria-label={`${element.kind} 对象 ${element.name||element.id}`} aria-pressed={textEditing?undefined:selected}
          className={`fw-pptx-object${selected?' is-selected':''}${textEditing?' is-editing':''}`} style={{left:box.x*scale,top:box.y*scale,width:Math.max(1,box.width*scale),height:Math.max(4,box.height*scale),transform:`rotate(${box.rotation}deg) scale(${box.flipH?-1:1},${box.flipV?-1:1})`}}
          onPointerDown={event=>{if((event.target as Element).closest('textarea')||event.button!==0)return;event.stopPropagation();void select(element);}}
          onClick={()=>{if(!textEditing)void select(element);}}
          onDoubleClick={()=>{if(enabled&&element.text!==undefined)void select(element,true);}}
          onKeyDown={event=>{
            if(event.target!==event.currentTarget||event.nativeEvent.isComposing||event.keyCode===229||event.repeat)return;
            if(event.key==='Enter'||event.key==='F2'){event.preventDefault();event.stopPropagation();void select(element,enabled&&element.text!==undefined);}
            else if(event.key===' '){event.preventDefault();event.stopPropagation();void select(element);}
            else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void select(null);container.current?.focus({preventScroll:true});}
          }}>
          {textEditing&&<textarea autoFocus aria-label="幻灯片对象文本" maxLength={65536} value={value} style={{fontFamily:element.textStyle?.family,fontSize:element.textStyle?.points!==undefined?element.textStyle.points*scale:undefined,fontWeight:element.textStyle?.bold?700:element.textStyle?.bold===false?400:undefined,fontStyle:element.textStyle?.italic?'italic':undefined,textDecoration:[element.textStyle?.underline&&'underline',element.textStyle?.strike&&'line-through'].filter(Boolean).join(' ')||undefined,color:element.textStyle?.color,textAlign:element.textStyle?.align}}
            onChange={event=>pptx.setElementText(slide.id,element.id,event.currentTarget.value,element.text??'',sourceVersion)}
            onCompositionStart={()=>pptx.setComposing(true)} onCompositionEnd={event=>{pptx.setElementText(slide.id,element.id,event.currentTarget.value,element.text??'',sourceVersion);pptx.setComposing(false);}}
            onBlur={()=>{if(!pptx.composing&&pptx.elementEditing?.slideId===slide.id&&pptx.elementEditing.elementId===element.id)void pptx.finishElementText({slideId:slide.id,elementId:element.id});}}
            onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(pptx.cancelElementText())container.current?.focus({preventScroll:true});}}}/>
          }
        </div>
      </PptxElementMenu>;
    })}
  </div>;
}

function PositionField({property,value,onValue,disabled=false,placeholder}:{property:'x'|'y'|'width'|'height'|'rotation'|'fontSize';value:number|undefined;onValue(value:number):Promise<boolean>;disabled?:boolean;placeholder?:string}){
  const display=value===undefined?'':String(Number((property==='rotation'?value:value*CSS_UNITS).toFixed(3))),[draft,setDraft]=useState(display),[error,setError]=useState('');
  const focused=useRef(false),committed=useRef(display),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!focused.current){setDraft(display);committed.current=display;setError('');}},[display]);
  const commit=()=>{
    if(draft===committed.current&&!input.current?.validity.badInput)return;
    if(input.current?.validity.badInput||!draft.trim()){setError('请输入有效数值');return;}
    const raw=Number(draft),next=property==='rotation'?raw:raw/CSS_UNITS;
    if(!Number.isFinite(next)||Math.abs(next)>(property==='rotation'?36000:property==='fontSize'?4000:1000000)||(['width','height','fontSize'].includes(property)&&next<=0)||property==='fontSize'&&next<1){setError('数值超出可用范围');return;}
    committed.current=draft;setError('');void onValue(next).then(ok=>{if(!ok)committed.current='';});
  };
  const label={x:'横坐标',y:'纵坐标',width:'宽度',height:'高度',rotation:'旋转',fontSize:'字号'}[property];
  return <><label className="fw-office-field"><span>{label}（{property==='rotation'?'°':'px'}）</span><input ref={input} type="number" step="any" aria-label={`对象${property}`} value={draft} disabled={disabled} placeholder={value===undefined?placeholder??'继承或混合':undefined}
    onFocus={()=>{focused.current=true;}} onChange={event=>{setDraft(event.currentTarget.value);setError('');}} onBlur={()=>{focused.current=false;commit();}}
    onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(display);committed.current=display;setError('');}}}/></label>{error&&<p role="alert">{error}</p>}</>;
}

export function PptxObjectProperties({element,onAction,tableLayout}:{element:PptxElementInfo;tableLayout?:PptxTableLayout;onAction(action:Omit<Extract<PptxAction,{type:'element-transform'}>,'slideId'|'elementId'>|Omit<Extract<PptxAction,{type:'element-layer'}>,'slideId'|'elementId'>|Omit<Extract<PptxAction,{type:'element-format'}>,'slideId'|'elementId'>|Omit<Extract<PptxAction,{type:'element-appearance'}>,'slideId'|'elementId'>|Omit<Extract<PptxAction,{type:'table-flags'}>,'slideId'|'elementId'>):Promise<boolean>}){
  const style=element.textStyle??{},fonts=[...new Set([style.family,'Arial','Georgia','Menlo'].filter((name):name is string=>Boolean(name)))];
  const automatic=element.table?.heights.some(height=>height===0),direct=element.box&&!element.parentId&&element.box.rotation===0&&!element.box.flipH&&!element.box.flipV;
  const bounds=automatic&&direct&&tableLayout?tableLayout.cells.reduce((bounds,cell)=>cell.points.reduce(([min,max],point)=>[Math.min(min,point[1]),Math.max(max,point[1])],bounds),[Infinity,-Infinity]):undefined,height=bounds?bounds[1]-bounds[0]:undefined;
  const measuredHeight=height!==undefined&&height>0&&height<=1000000?height:undefined;
  return <><strong className="fw-pptx-object-kind">{element.kind} · 所选对象</strong>
    {element.table&&<>{([['headerRow','首行标题'],['headerColumn','首列标题']] as const).map(([key,label])=><label key={key} className="fw-office-field"><span>{label}</span><input type="checkbox" aria-label={label} checked={element.table![key]} onChange={event=>void onAction({type:'table-flags',patch:{[key]:event.currentTarget.checked}})}/></label>)}</>}
    {element.text!==undefined&&<>
      <div className="fw-office-format-row">{[[Bold,'bold','加粗'],[Italic,'italic','斜体'],[Underline,'underline','下划线'],[Strikethrough,'strike','删除线']].map(([Icon,name,label])=>{
        const Component=Icon as typeof Bold,key=name as 'bold'|'italic'|'underline'|'strike',active=style[key];
        return <button key={key} className={`fw-office-tool${active?' active':''}`} aria-label={label as string} aria-pressed={style.mixed?.includes(key)?'mixed':Boolean(active)} onClick={()=>void onAction({type:'element-format',patch:{font:{[key]:!active}}})}><Component size={16}/></button>;
      })}</div>
      <label className="fw-office-field"><span>字体</span><select aria-label="对象字体" value={style.family??''} onChange={event=>void onAction({type:'element-format',patch:{font:{family:event.currentTarget.value||null}}})}><option value="">{style.mixed?.includes('family')?'混合字体':'继承字体'}</option>{fonts.map(name=><option key={name}>{name}</option>)}</select></label>
      <label className="fw-office-field"><span>段落列表</span><select aria-label="段落列表" value={style.list??''} onChange={event=>void onAction({type:'element-format',patch:{list:event.currentTarget.value as 'none'|'bullet'|'number'}})}>{!style.list&&<option value="" disabled>继承或混合</option>}<option value="none">无</option><option value="bullet">项目符号</option><option value="number">编号</option></select></label>
    </>}
    {element.box?(['x','y','width','height'] as const).map(property=><PositionField key={property} property={property} value={property==='height'&&automatic?measuredHeight:element.box![property]} disabled={property==='height'&&automatic&&measuredHeight===undefined} placeholder={direct?'排版后可调整':'此表格高度暂不能调整'} onValue={value=>onAction({type:'element-transform',patch:{[property]:value}})}/>):<p>此对象的位置暂无法编辑。</p>}
    {element.text!==undefined&&<><PositionField property="fontSize" value={style.points} onValue={value=>onAction({type:'element-format',patch:{font:{points:value}}})}/>
      {element.box&&<PositionField property="rotation" value={element.box.rotation} onValue={value=>onAction({type:'element-transform',patch:{rotation:value}})}/>}
      <ColorField label={style.color?'文字颜色':'设置文字颜色'} name="对象文字颜色" value={style.color??'#263d3a'} onValue={color=>onAction({type:'element-format',patch:{font:{color}}})}/>
      <label className="fw-office-field"><span>对齐</span><select aria-label="对象文本对齐" value={style.align??''} onChange={event=>void onAction({type:'element-format',patch:{align:event.currentTarget.value as 'left'|'center'|'right'|'justify'}})}>{!style.align&&<option value="" disabled>继承或混合</option>}{['left','center','right','justify'].map(value=><option key={value}>{value}</option>)}</select></label>
    </>}
    {element.text===undefined&&element.box&&<PositionField property="rotation" value={element.box.rotation} onValue={value=>onAction({type:'element-transform',patch:{rotation:value}})}/>}
    {element.appearance&&<>
      <ColorField label={element.appearance.fill?'填充':'设置填充'} name="对象填充" value={element.appearance.fill??'#ffffff'} onValue={fill=>onAction({type:'element-appearance',patch:{fill}})}/>
      <label className="fw-office-field"><span>阴影</span><input type="checkbox" aria-label="对象阴影" aria-checked={element.appearance.shadow===undefined?'mixed':element.appearance.shadow} ref={node=>{if(node)node.indeterminate=element.appearance?.shadow===undefined;}} checked={Boolean(element.appearance.shadow)} onChange={event=>void onAction({type:'element-appearance',patch:{shadow:event.currentTarget.checked}})}/></label>
      <label className="fw-office-field"><span>边框</span><input type="checkbox" aria-label="对象边框" aria-checked={element.appearance.border===undefined?'mixed':element.appearance.border} ref={node=>{if(node)node.indeterminate=element.appearance?.border===undefined;}} checked={Boolean(element.appearance.border)} onChange={event=>void onAction({type:'element-appearance',patch:{border:event.currentTarget.checked}})}/></label>
      {element.appearance.border&&<label className="fw-office-field"><span>边框样式</span><select aria-label="边框样式" value={element.appearance.borderStyle??''} onChange={event=>void onAction({type:'element-appearance',patch:{borderStyle:event.currentTarget.value as 'solid'|'dashed'|'dotted'}})}>{!element.appearance.borderStyle&&<option value="" disabled>继承或自定义</option>}{['solid','dashed','dotted'].map(value=><option key={value}>{value}</option>)}</select></label>}
      {element.kind==='shape'&&<label className="fw-office-field"><span>形状</span><select aria-label="形状类型" value={PPTX_SHAPES.find(shape=>PPTX_PRESETS[shape]===element.preset)??''} onChange={event=>void onAction({type:'element-appearance',patch:{shape:event.currentTarget.value as typeof PPTX_SHAPES[number]}})}>{!PPTX_SHAPES.some(shape=>PPTX_PRESETS[shape]===element.preset)&&<option value="" disabled>其他形状</option>}{PPTX_SHAPES.map(shape=><option key={shape}>{shape}</option>)}</select></label>}
    </>}
    <div className="fw-office-format-stack">{PPTX_LAYERS.map(([direction,label])=><button key={direction} onClick={()=>void onAction({type:'element-layer',direction})}>{label}</button>)}</div>
  </>;
}

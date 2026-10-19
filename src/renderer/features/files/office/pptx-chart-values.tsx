import { useEffect,useRef } from 'react';
import type { PptxElementInfo } from '@shared/file-pptx-elements';
import type { PptxBuffer } from './pptx-buffer';

export function PptxChartValues({pptx,slideId,element}:{pptx:PptxBuffer;slideId:string;element:PptxElementInfo}){
  const input=useRef<HTMLInputElement>(null),target={slideId,elementId:element.id,chartValues:true as const},original=element.chart?.values?.join(',')??'',version=pptx.result?.state.version;
  const pending=pptx.pendingFor(slideId,element.id,undefined,true),restored=Boolean(pending&&pptx.elementEditing?.chartValues&&pptx.elementEditing.slideId===slideId&&pptx.elementEditing.elementId===element.id);
  useEffect(()=>{if(restored)input.current?.focus({preventScroll:true});},[pptx.id,slideId,element.id,restored]);
  return <><label className="fw-office-field"><span>图表数据</span><input ref={input} aria-label="图表数据" maxLength={65536} value={pending?.text??original} disabled={!pptx.editable||pptx.controlsBusy||!element.chart?.editableValues}
    onFocus={()=>pptx.beginChartValues(slideId,element.id)} onChange={event=>pptx.setChartValues(slideId,element.id,event.currentTarget.value,original,version)}
    onCompositionStart={()=>pptx.setComposing(true)} onCompositionEnd={event=>{pptx.setChartValues(slideId,element.id,event.currentTarget.value,original,version);pptx.setComposing(false);}}
    onBlur={()=>{if(!pptx.composing)void pptx.finishElementText(target);}}
    onKeyDown={event=>{if(event.nativeEvent.isComposing||event.keyCode===229||pptx.composing)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();void pptx.finishElementText(target).then(ok=>{if(ok)input.current?.blur();});}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(pptx.cancelElementText())input.current?.blur();}}}/></label>{element.chart?.reason&&<p className="fw-office-notice">{element.chart.reason}</p>}</>;
}

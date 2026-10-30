import { useEffect,useRef,useState,type ReactNode } from 'react';
import { AlignCenter,AlignLeft,AlignRight,Bold,Italic,Underline,Strikethrough,X } from 'lucide-react';
import type { OfficeCell,OfficeCellStyle,OfficeFormatPatch } from '@shared/file-office';
import { officeNumberFormat } from '@shared/office-number-format';
import type { RangeCommand } from './range-menu';

const Field=({label,children}:{label:string;children:ReactNode})=><label className="fw-office-field"><span>{label}</span>{children}</label>;
export function ColorField({label,name,value,onValue}:{label:string;name:string;value:string;onValue(value:string):Promise<boolean>}) {
  const color=value.toLowerCase();
  const input=useRef<HTMLInputElement>(null),focused=useRef(false),committed=useRef(color),apply=useRef(onValue);
  const [draft,setDraft]=useState(color);apply.current=onValue;
  useEffect(()=>{if(!focused.current){setDraft(color);committed.current=color;}},[color]);
  const commit=(next:string)=>{
    if(next===committed.current)return;
    committed.current=next;setDraft(next);
    void apply.current(next).then(ok=>{if(!ok && committed.current===next)committed.current='';});
  };
  useEffect(()=>{
    const element=input.current;if(!element)return;
    // React's onChange also receives intermediate native input events. Committing
    // those disables the busy inspector and closes Chromium's RGB picker after
    // its first digit. Native change is the completed color-selection boundary.
    const changed=()=>commit(element.value);
    element.addEventListener('change',changed);return()=>element.removeEventListener('change',changed);
  },[]);
  return <Field label={label}><input ref={input} type="color" aria-label={name} value={draft} onFocus={()=>{focused.current=true;}} onChange={event=>setDraft(event.currentTarget.value)} onBlur={event=>{focused.current=false;commit(event.currentTarget.value);}}/></Field>;
}
function NumberField({label,value,min,max,onValue}:{label:string;value:number;min:number;max:number;onValue(value:number):Promise<boolean>}) {
  const [draft,setDraft]=useState(String(value)),[error,setError]=useState(''),focused=useRef(false),committed=useRef(String(value));
  useEffect(()=>{if(!focused.current){setDraft(String(value));committed.current=String(value);}},[value]);
  const commit=()=>{
    if(draft===committed.current)return;
    const next=Number(draft);if(!draft.trim() || !Number.isFinite(next) || next<min || next>max || !Number.isInteger(next)){setError(`请输入 ${min}–${max} 之间的整数`);return;}
    committed.current=draft;setError('');void onValue(next).then(ok=>{if(!ok)committed.current='';});
  };
  return <><Field label={label}><input type="number" aria-label={label} min={min} max={max} value={draft} onFocus={()=>{focused.current=true;}} onChange={event=>{setDraft(event.currentTarget.value);setError('');}} onBlur={()=>{focused.current=false;commit();}} onKeyDown={event=>{
    if(event.nativeEvent.isComposing || event.keyCode===229)return;
    if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit();}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(String(value));committed.current=String(value);setError('');}
  }}/></Field>{error && <p role="alert">{error}</p>}</>;
}
function ConditionalField({conditional,onValue}:{conditional:OfficeCell['conditional'];onValue(value:number|null):Promise<boolean>}) {
  const value=conditional?.threshold===undefined ? '' : String(conditional.threshold),[draft,setDraft]=useState(value),[error,setError]=useState(''),focused=useRef(false),committed=useRef(value),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!focused.current){setDraft(value);committed.current=value;}},[value]);
  const commit=()=>{
    if(input.current?.validity.badInput){setError('请输入有限数值，留空可取消阈值');return;}
    if(draft===committed.current)return;
    const next=draft.trim()==='' ? null : Number(draft);if(next!==null && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(draft.trim()) || !Number.isFinite(next))){setError('请输入有限数值，留空可取消阈值');return;}
    committed.current=draft;setError('');void onValue(next).then(ok=>{if(!ok)committed.current='\0';});
  };
  return <><Field label="条件填充阈值"><input ref={input} aria-label="条件填充阈值" type="number" step="any" value={draft} disabled={conditional?.custom || conditional?.unsupported} placeholder={conditional?.custom ? '现有规则' : undefined} onFocus={()=>{focused.current=true;}} onChange={event=>{setDraft(event.currentTarget.value);setError('');}} onBlur={()=>{focused.current=false;commit();}} onKeyDown={event=>{
    if(event.nativeEvent.isComposing || event.keyCode===229)return;
    if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit();}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(value);committed.current=value;setError('');}
  }}/></Field>{error && <p role="alert">{error}</p>}{(conditional?.custom || conditional?.unsupported) && <p>此处已有条件规则暂不支持修改。</p>}</>;
}
export function OfficeFormatPanel({style,defaultFont,validation,conditional,enabled,onFormat,onRange,onConditional,onClose,onSave}:{style:OfficeCellStyle;defaultFont?:string;validation?:'number'|'custom';conditional?:OfficeCell['conditional'];enabled:boolean;onFormat(patch:OfficeFormatPatch):Promise<boolean>;onRange(command:RangeCommand):void;onConditional(value:number|null):Promise<boolean>;onClose():void;onSave():void}) {
  const number=officeNumberFormat(style.numberFormat),family=style.font?.family ?? defaultFont ?? '',fonts=[...new Set([family,...(defaultFont ? [defaultFont] : []),'Arial','Georgia','Menlo'])].filter(Boolean);
  return <aside className="fw-office-inspector" aria-label="单元格格式" onKeyDown={event=>{
    if(event.nativeEvent.isComposing || event.keyCode===229)return;
    if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();(event.target as HTMLElement).blur();onSave();}
  }}><div><strong>格式</strong><button className="fw-office-tool" aria-label="关闭格式面板" onClick={onClose}><X size={16}/></button></div>
    <fieldset disabled={!enabled}>
      <div className="fw-office-format-row">{[[Bold,'bold','加粗'],[Italic,'italic','斜体'],[Underline,'underline','下划线'],[Strikethrough,'strike','删除线']].map(([Icon,key,label])=>{
        const Component=Icon as typeof Bold,property=key as 'bold'|'italic'|'underline'|'strike',active=!!style.font?.[property];return <button key={property} className={`fw-office-tool${active ? ' active' : ''}`} aria-label={label as string} aria-pressed={active} onClick={()=>void onFormat({font:{[property]:!active}})}><Component size={16}/></button>;
      })}</div>
      <Field label="字体"><select aria-label="单元格字体" value={family} onChange={event=>void onFormat({font:{family:event.currentTarget.value}})}>{!family && <option value="" disabled>未指定</option>}{fonts.map(name=><option key={name} value={name}>{name===defaultFont ? `默认 (${name})` : name==='Menlo' ? 'monospace (Menlo)' : name}</option>)}</select></Field>
      <NumberField label="单元格字号" value={Math.round((style.font?.points ?? 10)*4/3)} min={8} max={48} onValue={value=>onFormat({font:{points:value*3/4}})}/>
      <ColorField label="文字颜色" name="单元格文字颜色" value={style.font?.color ?? '#1f1f1f'} onValue={value=>onFormat({font:{color:value}})}/>
      <ColorField label="填充" name="单元格填充" value={style.fill ?? '#ffffff'} onValue={value=>onFormat({fill:value})}/>
      <div className="fw-office-format-row">{[[AlignLeft,'left','左对齐'],[AlignCenter,'center','居中'],[AlignRight,'right','右对齐']].map(([Icon,key,label])=>{
        const Component=Icon as typeof AlignLeft,value=key as 'left'|'center'|'right',active=style.alignment?.horizontal===value;return <button key={value} className={`fw-office-tool${active ? ' active' : ''}`} aria-label={label as string} aria-pressed={active} onClick={()=>void onFormat({alignment:{horizontal:value}})}><Component size={16}/></button>;
      })}</div>
      <label><input type="checkbox" checked={!!style.alignment?.wrap} onChange={event=>void onFormat({alignment:{wrap:event.currentTarget.checked}})}/>自动换行</label>
      <label><input type="checkbox" checked={['left','right','top','bottom'].every(edge=>!!style.borders?.[edge as 'left'])} onChange={event=>void onFormat({border:event.currentTarget.checked})}/>单元格边框</label>
      <Field label="数值格式"><select aria-label="数值格式" value={number.kind} onChange={event=>void onFormat({numberFormat:event.currentTarget.value as OfficeFormatPatch['numberFormat']})}><option value="general">常规</option><option value="number">数值</option><option value="currency">货币</option><option value="percent">百分比</option>{number.kind==='custom' && <option value="custom" disabled>现有自定义格式</option>}</select></Field>
      {number.kind!=='custom' && <NumberField label="小数位" value={number.decimals} min={0} max={6} onValue={value=>onFormat({decimals:value})}/>}
      <div className="fw-office-format-stack"><button onClick={()=>onRange({type:'merge'})}>合并单元格</button><button onClick={()=>onRange({type:'unmerge'})}>取消合并</button><button onClick={()=>onRange({type:'fit',axis:'column'})}>适应列宽</button><button onClick={()=>onRange({type:'fit',axis:'row'})}>适应行高</button><button onClick={()=>onRange({type:'checkbox'})}>插入复选框</button></div>
      <Field label="数据验证"><select aria-label="数据验证" value={validation ?? 'none'} onChange={event=>onRange({type:'validation',value:event.currentTarget.value as 'none'|'number'})}><option value="none">不限制</option><option value="number">数字或公式</option>{validation==='custom' && <option value="custom" disabled>现有自定义规则</option>}</select></Field>
      <ConditionalField conditional={conditional} onValue={onConditional}/>
    </fieldset>
  </aside>;
}

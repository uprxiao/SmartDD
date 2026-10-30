import {useEffect,useRef,useState} from 'react';
import {Image,BarChart3,Shapes,ChevronDown,Type} from 'lucide-react';
import {WORKBOOK_CHARTS,WORKBOOK_SHAPES,type WorkbookDrawing} from '@shared/file-workbook-drawing';
import {PPTX_IMAGE_LIMIT} from '@shared/file-pptx-image';
import {bytesToBase64,fileErrorMessage} from '../file-buffer';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@renderer/lib/ui/menu';

const charts={bar:'柱状图',line:'折线图',pie:'饼图',area:'面积图',scatter:'散点图'};
const shapes={ellipse:'圆形',rect:'矩形',triangle:'三角形',diamond:'菱形',star5:'星形',rightArrow:'右箭头',leftArrow:'左箭头',plus:'加号',chevron:'V形箭头',wedgeRoundRectCallout:'标注',line:'直线',lineInv:'斜箭头'};
export function WorkbookInsertControls({enabled,targetKey,onInsert,onText}:{enabled:boolean;targetKey:string;onInsert(drawing:WorkbookDrawing):Promise<boolean>;onText():void}){
  const input=useRef<HTMLInputElement>(null),reader=useRef<FileReader|null>(null),epoch=useRef(0),captured=useRef<string|null>(null),current=useRef({enabled,targetKey,onInsert});
  current.current={enabled,targetKey,onInsert};const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{return()=>{epoch.current++;reader.current?.abort();captured.current=null;};},[]);
  useEffect(()=>{epoch.current++;reader.current?.abort();captured.current=null;setBusy(false);},[targetKey]);
  const insert=async(drawing:WorkbookDrawing)=>{if(!current.current.enabled)return false;setError('');try{return await current.current.onInsert(drawing);}catch(error){setError(fileErrorMessage(error));return false;}};
  const load=async(file:File)=>{
    const target=captured.current,token=++epoch.current;if(!target)return;setBusy(true);setError('');
    try{
      if(!file.size||file.size>PPTX_IMAGE_LIMIT)throw new Error('请选择不超过 20 MiB 的 PNG 或 JPEG 图片');
      const bytes=await new Promise<Uint8Array>((resolve,reject)=>{const r=reader.current=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result as ArrayBuffer));r.onerror=()=>reject(new Error('图片读取失败'));r.onabort=()=>reject(new Error('图片读取已取消'));r.readAsArrayBuffer(file);});
      if(token!==epoch.current)return;
      if(!current.current.enabled||target!==current.current.targetKey)throw new Error('工作簿或选区已变化，请重新选择图片');
      const png=[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if(!png&&!jpeg)throw new Error('当前支持 PNG 和 JPEG，所选文件未被插入');
      await insert({kind:'image',image:{mime:png?'image/png':'image/jpeg',base64:bytesToBase64(bytes)}});
    }catch(error){if(token===epoch.current)setError(fileErrorMessage(error));}
    finally{if(token===epoch.current){reader.current=null;captured.current=null;setBusy(false);}}
  };
  const disabled=!enabled||busy;
  return <>
    <button aria-label="插入工作簿图片" disabled={disabled} onClick={()=>{if(!current.current.enabled)return;captured.current=current.current.targetKey;setError('');input.current?.click();}}><Image size={14}/>图片</button>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" aria-label="插入工作簿图片文件" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void load(file);}}/>
    <DropdownMenu><DropdownMenuTrigger aria-label="插入工作簿图表" disabled={disabled}><BarChart3 size={14}/>图表<ChevronDown size={12}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="fw-file-menu">{WORKBOOK_CHARTS.map(chartType=><DropdownMenuItem key={chartType} onClick={()=>void insert({kind:'chart',chartType})}>{charts[chartType]}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <DropdownMenu><DropdownMenuTrigger aria-label="插入工作簿形状" disabled={disabled}><Shapes size={14}/>形状<ChevronDown size={12}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="fw-file-menu">{WORKBOOK_SHAPES.map(shape=><DropdownMenuItem key={shape} onClick={()=>void insert({kind:'shape',shape})}>{shapes[shape]}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <button aria-label="插入工作簿文本框" disabled={disabled} onClick={onText}><Type size={14}/>文本框</button>
    {error&&<span role="alert" className="fw-office-notice">{error}</span>}
  </>;
}

// Command vocabulary and argument ordering adapted from Orca bd9455b6165,
// MIT, Copyright (c) 2026 Lovecast Inc. Host references always retain node identity.
import {ApplicationError} from '@shared/applications';
import type {BrowserPage} from './page-registry';
import {BrowserError,staleReference} from './errors';
import {resolve} from 'node:path';

interface CommandContext {signal:AbortSignal;cwd:string;send():void;notStarted():void}
type Result={handled:false}|{handled:true;result:unknown};
const text=(value:unknown)=>{
  if(!['string','number','boolean'].includes(typeof value))throw new ApplicationError('INVALID_INPUT','文本字段只接受字符串、数字或布尔值');
  return String(value);
};
const finite=(value:unknown)=>{
  if(typeof value!=='number'||!Number.isFinite(value))throw new ApplicationError('INVALID_INPUT','坐标或尺寸必须为有限数字');return value;
};

/** Pure argument construction: no shell, global connection options or implicit retries. */
export function browserPageArguments(command:string,args:Record<string,unknown>):string[]|null{
  if(['dblclick','hover','focus','scrollintoview'].includes(command))return[command,text(args.element)];
  if(command==='highlight')return['highlight',text(args.selector)];
  if(command==='drag')return['drag',text(args.from),text(args.to)];
  if(command==='upload'){
    const files=Array.isArray(args.files)?args.files.map(text):text(args.files).split(',');
    if(!files.length||files.some(file=>!file))throw new ApplicationError('INVALID_INPUT','上传路径不能为空');
    return['upload',text(args.element),...files];
  }
  if(command==='keypress')return['press',text(args.key)];
  if(command==='scroll')return['scroll',text(args.direction),String(args.amount??500)];
  if(command==='mouse move')return['mouse','move',String(finite(args.x)),String(finite(args.y))];
  if(command==='mouse down'||command==='mouse up')return['mouse',command.split(' ')[1],text(args.button??'left')];
  if(command==='mouse wheel')return['mouse','wheel',String(finite(args.dy)),String(finite(args.dx??0))];
  if(command==='find'){
    const locator=text(args.locator),value=text(args.value),action=text(args.action),payload=args.text===undefined?[]:[text(args.text)];
    if(!['click','fill','type','hover','focus','check','uncheck'].includes(action))throw new ApplicationError('INVALID_INPUT','find action必须为已列出的页面动作');
    if(locator==='nth'){
      const match=/^(0|[1-9]\d*)\s+([\s\S]+)$/.exec(value.trim());
      if(!match||!Number.isSafeInteger(Number(match[1])))throw new ApplicationError('INVALID_INPUT','nth的value须为“零基索引 CSS选择器”，例如“1 button”');
      if(args.name!==undefined||args.exact===true)throw new ApplicationError('INVALID_INPUT','nth不接受name/exact选项');
      return['find','nth',match[1],match[2],action,...payload];
    }
    return['find',locator,value,action,...payload,...(args.name===undefined?[]:['--name',text(args.name)]),...(args.exact===true?['--exact']:[])];
  }
  if(command==='wait fn')return['wait','--fn',text(args.fn),'--timeout',String(args.timeout??25000)];
  if(command==='set device')return['set','device',text(args.name)];
  // Fixed native parser expects a bare marker, not an option/value pair.
  if(command==='set media'){
    if(args['reduced-motion']!==undefined&&args['reduced-motion']!=='reduce'&&args['reduced-motion']!=='no-preference')throw new ApplicationError('INVALID_INPUT','reduced-motion须为reduce或no-preference');
    return['set','media',...(args['color-scheme']===undefined?[]:[text(args['color-scheme'])]),...(args['reduced-motion']==='reduce'?['reduced-motion']:[])];
  }
  if(command==='clipboard read')return['clipboard','read'];
  if(command==='clipboard write')return['clipboard','write',text(args.text)];
  if(command==='dialog accept')return['dialog','accept',...(args.text===undefined?[]:[text(args.text)])];
  if(command==='dialog dismiss')return['dialog','dismiss'];
  if(/^storage (local|session) (get|set|clear)$/.test(command))return[...command.split(' '),...(command.endsWith(' clear')?[]:[text(args.key)]),...(command.endsWith(' set')?[text(args.value)]:[])];
  return null;
}

export async function executeBrowserPageCommand(page:BrowserPage,command:string,args:Record<string,unknown>,context:CommandContext):Promise<Result>{
  const {signal,send,notStarted}=context;
  if(command==='viewport'){
    const width=finite(args.width),height=finite(args.height),deviceScaleFactor=finite(args.scale??1),mobile=args.mobile===true;
    if(width<=0||height<=0||deviceScaleFactor<=0)throw new ApplicationError('INVALID_INPUT','视口宽高和缩放必须大于零');
    send();await page.proxy.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor,mobile});
    await page.proxy.send('Emulation.setVisibleSize',{width,height});return{handled:true,result:{result:{width,height,deviceScaleFactor,mobile}}};
  }
  if(command==='geolocation'){
    const latitude=finite(args.latitude),longitude=finite(args.longitude),accuracy=finite(args.accuracy??1);
    if(Math.abs(latitude)>90||Math.abs(longitude)>180||accuracy<0)throw new ApplicationError('INVALID_INPUT','地理位置范围无效');
    send();await page.proxy.send('Emulation.setGeolocationOverride',{latitude,longitude,accuracy});return{handled:true,result:{result:{latitude,longitude,accuracy}}};
  }
  if(command==='set headers'){
    if(!args.headers||typeof args.headers!=='object'||Array.isArray(args.headers)||Object.values(args.headers).some(value=>typeof value!=='string'))throw new ApplicationError('INVALID_INPUT','headers必须为字符串值对象');
    send();await page.proxy.send('Network.enable');await page.proxy.send('Network.setExtraHTTPHeaders',{headers:args.headers});return{handled:true,result:{result:{headersSet:true}}};
  }
  if(command==='set offline'){
    const offline=(args.state??'on')==='on';
    if(args.state!==undefined&&args.state!=='on'&&args.state!=='off')throw new ApplicationError('INVALID_INPUT','offline state必须为on或off');
    send();await page.proxy.send('Network.enable');await page.proxy.send('Network.emulateNetworkConditions',{offline,latency:0,downloadThroughput:-1,uploadThroughput:-1});return{handled:true,result:{result:{offline}}};
  }
  if(command==='get'&&(args.what==='url'||args.what==='title'))return{handled:true,result:{result:args.what==='url'?page.contents.getURL():page.contents.getTitle()}};

  const native=browserPageArguments(command,args),referenceKeys=command==='drag'?['from','to']:command==='highlight'?['selector']:['get','is','select','check','uncheck','clear','select-all','dblclick','hover','focus','scrollintoview','upload'].includes(command)?['element']:[];
  if(!native&&!['get','is','select','check','uncheck','clear','select-all'].includes(command))return{handled:false};
  const held=new Map<string,Awaited<ReturnType<BrowserPage['references']['arm']>>>();
  let result:unknown,error:unknown;
  try{
    for(const key of referenceKeys){
      const ref=text(args[key]);if(!held.has(ref))held.set(ref,await page.references.arm(ref,{append:held.size>0,locator:command!=='get'&&command!=='is'}));
    }
    const primary=held.values().next().value;
    if(command==='get'||command==='is'){
      const what=text(args.what);
      if(!primary)throw new ApplicationError('INVALID_INPUT','读取元素属性需要element引用');
      if(what==='count')result=1;
      else if(what==='text'||what==='html'||what==='value'||what==='box'||what==='visible'||what==='enabled'||what==='checked')result=await primary.read(what);
      else throw new ApplicationError('INVALID_INPUT','不支持的元素属性');
    }else if((command==='hover'||command==='dblclick')&&primary!.hostClick){await primary!.pointer(command,{signal,dispatched:send,notStarted});result={completed:true};}
    else if(command==='scrollintoview'){await primary!.scroll({signal,dispatched:send,notStarted});result={scrolled:true};}
    else if(command==='highlight'){await primary!.highlight({signal,dispatched:send,notStarted});result={highlighted:true};}
    else if(command==='focus'){await primary!.focus({signal,dispatched:send,notStarted});result={focused:true};}
    else if(command==='clear')result=await primary!.fill('',{signal,dispatched:send,notStarted});
    else if(command==='select-all'){await primary!.selectAll({signal,dispatched:send,notStarted});result={selected:true};}
    else if(command==='select'){await primary!.select(text(args.value),{signal,dispatched:send,notStarted});result={selected:true};}
    else if(command==='upload'){await primary!.upload(native!.slice(2).map(path=>resolve(context.cwd,path)),{signal,dispatched:send,notStarted});result={uploaded:true};}
    else if(command==='check'||command==='uncheck'){
      const checked=command==='check';if(await primary!.read('checked')!==checked)await primary!.click({signal,dispatched:send,notStarted});
      if(await primary!.read('checked')!==checked)throw new BrowserError('BROWSER_ERROR','复选状态未达到请求值，请先核对页面');
      result={checked};
    }else{
      const argv=native!.map(arg=>held.get(arg)?.selector??arg);
      result=await page.helper.command(argv,{signal,dispatched:send,...(command==='wait fn'?{timeout:Number(args.timeout??25000)+5000}:{})});
    }
  }catch(cause){error=cause;}
  const guards=[];
  const references=[...held.values()];
  for(const [index,reference] of references.entries()){
    const sameWorldLater=references.slice(index+1).some(other=>other.node.frameId===reference.node.frameId&&other.node.sessionId===reference.node.sessionId);
    try{guards.push(await reference.finish(sameWorldLater));}catch(cause){error??=cause;}
  }
  if(guards.some(guard=>guard.blocked.length||!guard.connected)){
    // A helper may have changed DOM properties before emitting any event.
    // Retain an already-dispatched write as unknown unless a retained-object
    // method explicitly proved not-started itself.
    throw staleReference();
  }
  if(error)throw error;
  if(command==='wait fn')return{handled:true,result:{waited:true}};
  return{handled:true,result:{result}};
}

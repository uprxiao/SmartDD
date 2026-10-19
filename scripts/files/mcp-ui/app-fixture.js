import { App } from '@modelcontextprotocol/ext-apps';
const app=new App({name:'WillYou isolated acceptance fixture',version:'1.0.0'},{},{autoResize:false,strict:true});
const report={order:[],denied:[],parentAccess:false,node:typeof globalThis.require,preload:typeof window.willyouMcpUi};
try {report.parentAccess=!!parent.willyouMcpUi}catch{}
let input,resolveInput;const readyInput=new Promise(r=>resolveInput=r);
app.ontoolinput=value=>{input=value.arguments;report.order.push('input');resolveInput()};
app.onhostcontextchanged=value=>{report.theme=value.theme};
app.ontoolresult=async value=>{
 try{
  report.order.push('result');await readyInput;report.input=input;report.initialResult=value;
  report.read=await app.readServerResource({uri:input.uri});
  report.tool=await app.callServerTool({name:'slice',arguments:{uri:input.uri,offset:0,length:12}});
  for(const [name,call] of [
   ['foreign-resource',()=>app.readServerResource({uri:input.uri+'/other'})],
   ['initial-tool',()=>app.callServerTool({name:'initial',arguments:{uri:input.uri}})],
   ['write-tool',()=>app.callServerTool({name:'mutate',arguments:{uri:input.uri}})],
   ['tool-range',()=>app.callServerTool({name:'slice',arguments:{uri:input.uri,offset:0,length:257}})],
   ['model-message',()=>app.sendMessage({role:'user',content:[{type:'text',text:'fixture'}]})],
   ['open-link',()=>app.openLink({url:'https://example.invalid/'})],
   ['model-context',()=>app.updateModelContext({content:[{type:'text',text:'fixture'}]})]
  ])try{await call();report.denied.push({name,denied:false})}catch(e){report.denied.push({name,denied:true,message:String(e)})}
  parent.postMessage({jsonrpc:'2.0',method:'fixture/report',params:report},'*');
 }catch(e){parent.postMessage({jsonrpc:'2.0',method:'fixture/report',params:{...report,error:String(e)}},'*')}
};
const file=document.createElement('input');file.type='file';file.id='file-guard-fixture';document.body.append(file);
const label=document.createElement('label');label.htmlFor=file.id;document.body.append(label);
let untrustedClicks=0;file.addEventListener('click',()=>untrustedClicks++);
const click=new MouseEvent('click',{bubbles:true,cancelable:true});file.dispatchEvent(click);label.click();
report.fileClickPrevented=click.defaultPrevented;report.fileClickHandlers=untrustedClicks;
const pathDescriptor=Object.getOwnPropertyDescriptor(Event.prototype,'composedPath'),typeDescriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'type'),preventDescriptor=Object.getOwnPropertyDescriptor(Event.prototype,'preventDefault');
Object.defineProperty(Event.prototype,'composedPath',{...pathDescriptor,value:()=>[]});Object.defineProperty(HTMLInputElement.prototype,'type',{...typeDescriptor,get:()=> 'text'});Object.defineProperty(Event.prototype,'preventDefault',{...preventDescriptor,value:()=>undefined});
const forged=new MouseEvent('click',{bubbles:true,cancelable:true});file.dispatchEvent(forged);report.tamperedPrototypesStillBlocked=forged.defaultPrevented&&untrustedClicks===0;
Object.defineProperty(Event.prototype,'composedPath',pathDescriptor);Object.defineProperty(HTMLInputElement.prototype,'type',typeDescriptor);Object.defineProperty(Event.prototype,'preventDefault',preventDescriptor);

try{file.showPicker();report.fileShowPickerDenied=false}catch(e){report.fileShowPickerDenied=e.name==='NotAllowedError'}
report.fileShowPickerFixed=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'showPicker').configurable===false;
report.pickerGlobalsFixed=['showOpenFilePicker','showSaveFilePicker','showDirectoryPicker'].every(k=>Object.getOwnPropertyDescriptor(window,k).configurable===false);
const transfer=new DataTransfer();transfer.items.add(new File(['synthetic'],'synthetic.txt'));let pastes=0;file.addEventListener('paste',()=>pastes++);
const paste=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});file.dispatchEvent(paste);report.filePastePrevented=paste.defaultPrevented&&pastes===0;
const textTransfer=new DataTransfer();textTransfer.setData('text/plain','synthetic');const textPaste=new ClipboardEvent('paste',{clipboardData:textTransfer,bubbles:true,cancelable:true});file.dispatchEvent(textPaste);report.textPasteAllowed=!textPaste.defaultPrevented;
app.connect().then(()=>{report.initialTheme=app.getHostContext()?.theme}).catch(e=>parent.postMessage({jsonrpc:'2.0',method:'fixture/report',params:{error:String(e)}},'*'));

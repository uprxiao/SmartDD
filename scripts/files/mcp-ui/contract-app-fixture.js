// Real native Apps UI for Y30; original public SDK and trusted desktop input.
import {App} from '@modelcontextprotocol/ext-apps';
const app=new App({name:'Y30 owned contract controls',version:'1.0.0'},{},{autoResize:false,strict:true});
let input,initial;const report={clicks:[],rejected:[]};
document.body.style.cssText='font:14px system-ui;margin:16px';document.body.innerHTML='<h3>Y30 isolated contract viewer</h3><button disabled>Check bounded tool and URI contracts</button><p>Initializing</p><pre style="white-space:pre-wrap"></pre>';
const button=document.querySelector('button'),state=document.querySelector('p'),output=document.querySelector('pre');
const publish=()=>{output.textContent=JSON.stringify(report,null,2);void app.sendLog({level:'info',data:{phase:'Y30-ui-report',state:state.textContent,report}}).catch(()=>{})};
const ready=()=>{if(input&&initial){button.disabled=false;state.textContent='Ready';publish()}};
app.ontoolinput=value=>{input=value.arguments;ready()};app.ontoolresult=value=>{initial=value;ready()};
button.onclick=async event=>{
 report.clicks.push({trusted:event.isTrusted});state.textContent='Running';
 try{
  report.allowed=await app.callServerTool({name:'slice',arguments:{uri:input.uri,offset:0,length:4}});
  for(const [name,call]of[
   ['path-traversal',()=>app.readServerResource({uri:input.uri+'/../outside'})],
   ['encoded-traversal',()=>app.readServerResource({uri:input.uri+'/%2e%2e/outside'})],
   ['different-resource',()=>app.readServerResource({uri:input.uri+'/other'})],
   ['http',()=>app.readServerResource({uri:'https://y30.invalid/no-request'})],
   ['unregistered-tool',()=>app.callServerTool({name:'unregistered',arguments:{uri:input.uri}})],
   ['tool-wrong-uri',()=>app.callServerTool({name:'slice',arguments:{uri:input.uri+'/other',offset:0,length:4}})],
   ['tool-too-many-bytes',()=>app.callServerTool({name:'slice',arguments:{uri:input.uri,offset:0,length:257}})],
   ['model-message',()=>app.sendMessage({role:'user',content:[{type:'text',text:'Y30 synthetic forbidden message'}]})],
  ])try{await call();report.rejected.push({name,denied:false})}catch(error){report.rejected.push({name,denied:true,error:String(error)})}
  state.textContent='Complete';
 }catch(error){report.failure=String(error);state.textContent='Failed'}
 publish();
};
app.onhostcontextchanged=context=>{document.body.style.background=context.theme==='dark'?'#202020':'#fff';document.body.style.color=context.theme==='dark'?'#eee':'#222'};
app.connect().catch(error=>{report.failure=String(error);state.textContent='Failed';publish()});

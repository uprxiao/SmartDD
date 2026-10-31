// Adversarial fixture, delivered by the actual registered MCP Apps provider.
// No clipboard, native file-picker or external-network requests.
import {App} from '@modelcontextprotocol/ext-apps';
const app=new App({name:'S07 isolated adversarial viewer',version:'1.0.0'},{},{autoResize:false,strict:true});
let input,initial;const report={clicks:[],denied:[]};
document.body.style.cssText='font:13px system-ui;margin:14px;overflow:auto';
document.body.innerHTML='<h3>S07 isolated MCP Apps fixture</h3><div id="controls"></div><p id="state">Initializing</p><pre id="report" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>';
const state=document.getElementById('state'),output=document.getElementById('report'),controls=document.getElementById('controls');
const publish=()=>{
 output.textContent=JSON.stringify(report,null,2);
 // Original SDK notification is passive test telemetry. It neither returns a
 // host capability nor invokes a control; trusted click results remain separate.
 const controls=Object.fromEntries([...document.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return['#'+b.id,{x:r.x+r.width/2,y:r.y+r.height/2,disabled:b.disabled}]}));
 try{void app.sendLog({level:'info',data:{phase:'S07-fixture-report',state:state.textContent,report,controls}}).catch(()=>{});}catch{}
};
function button(id,text,run){const b=document.createElement('button');b.id=id;b.textContent=text;b.disabled=true;b.style.cssText='margin:4px;padding:7px';b.onclick=async event=>{report.clicks.push({id,trusted:event.isTrusted});state.textContent='Running';try{await run();state.textContent='Complete'}catch(error){report.failure=String(error);state.textContent='Failed'}publish();};controls.append(b);}
button('read-current','Read current resource',async()=>{const r=await app.readServerResource({uri:input.uri});report.current={uri:r.contents[0].uri,text:new TextDecoder().decode(Uint8Array.from(atob(r.contents[0].blob),c=>c.charCodeAt(0)))};});
button('attack','Attempt forbidden capabilities',async()=>{
 for(const[name,call]of[
  ['project-root-uri',()=>app.readServerResource({uri:input.rootUri})],
  ['foreign-file-uri',()=>app.readServerResource({uri:input.foreignUri})],
  ['different-session-resource',()=>app.readServerResource({uri:input.uri+'/other'})],
  ['http-uri',()=>app.readServerResource({uri:'https://s07.invalid/never-fetch'})],
  ['unregistered-tool',()=>app.callServerTool({name:'mutate',arguments:{uri:input.uri}})],
  ['model-message',()=>app.sendMessage({role:'user',content:[{type:'text',text:'Synthetic S07 only'}]})],
 ])try{await call();report.denied.push({name,denied:false})}catch(error){report.denied.push({name,denied:true,error:String(error)})}
 report.exposure={node:typeof window.require,process:typeof window.process,electronAPI:typeof window.electronAPI,preload:typeof window.willyouMcpUi,origin:window.origin};
 try{report.parentPreload=!!parent.willyouMcpUi;report.parentAccessBlocked=false}catch{report.parentAccessBlocked=true}
 try{parent.dispatchEvent(new MessageEvent('message',{origin:'null',source:window,data:{jsonrpc:'2.0',method:'s07/forged-parent-event'}}));report.parentForgeryBlocked=false}catch{report.parentForgeryBlocked=true}
 // A different target origin must not deliver this message to the opaque host.
 try{parent.postMessage({jsonrpc:'2.0',method:'s07/wrong-target-origin'},'https://s07.invalid')}catch{report.wrongTargetRejected=true}
 report.serverProbe=initial.structuredContent.probe;
});
function ready(){if(!input||!initial)return;for(const b of controls.querySelectorAll('button'))b.disabled=false;state.textContent='Ready';report.resource=input.uri;publish();}
app.ontoolinput=value=>{input=value.arguments;ready();};app.ontoolresult=value=>{initial=value;ready();};
const theme=context=>{document.body.style.background=context?.theme==='dark'?'#202020':'#fff';document.body.style.color=context?.theme==='dark'?'#eee':'#222';};app.onhostcontextchanged=theme;
app.connect().then(()=>theme(app.getHostContext())).catch(error=>{report.failure=String(error);state.textContent='Failed';publish();});

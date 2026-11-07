// Synthetic UI for packaged-App acceptance; only standard MCP Apps APIs.
import {App} from '@modelcontextprotocol/ext-apps';
const app=new App({name:'WillYou 手动验收 fixture',version:'1.0.0'},{},{autoResize:false});let uri;
document.body.style.cssText='font:13px system-ui;margin:16px;overflow:auto';
const title=document.createElement('h3');title.textContent='MCP 当前资源验收';document.body.append(title);
const controls=document.createElement('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px';document.body.append(controls);
const status=document.createElement('p');status.setAttribute('role','status');status.textContent='正在初始化';document.body.append(status);
const output=document.createElement('pre');output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';document.body.append(output);
const theme=context=>{document.body.style.background=context?.theme==='dark'?'#202020':'#ffffff';document.body.style.color=context?.theme==='dark'?'#eeeeee':'#222222'};
const button=(text,run)=>{const b=document.createElement('button');b.textContent=text;b.onclick=()=>void(async()=>{try{output.textContent=JSON.stringify(await run(),null,2);status.textContent='操作完成'}catch(e){status.textContent='请求已拒绝';output.textContent=String(e)}})();controls.append(b)};
app.ontoolinput=input=>{uri=input.arguments.uri;status.textContent='当前资源已绑定';output.textContent=uri};app.ontoolresult=()=>{status.textContent='初始化已完成：只读工具已返回'};app.onhostcontextchanged=theme;
button('读取当前资源',async()=>{const r=await app.readServerResource({uri});return {uri:r.contents[0].uri,text:new TextDecoder().decode(Uint8Array.from(atob(r.contents[0].blob),c=>c.charCodeAt(0)))}});
button('调用限定只读工具',()=>app.callServerTool({name:'slice',arguments:{uri,offset:0,length:12}}));
button('读取外部 URI（应拒绝）',()=>app.readServerResource({uri:'file:///etc/passwd'}));
button('发送模型消息（应拒绝）',()=>app.sendMessage({role:'user',content:[{type:'text',text:'Synthetic acceptance only'}]}));
button('模拟扩展无响应',()=>{while(true){}});
const label=document.createElement('label');label.textContent='选择任意文件（应拦截）';const file=document.createElement('input');file.type='file';label.append(file);controls.append(label);
app.connect().then(()=>theme(app.getHostContext())).catch(e=>{status.textContent='初始化失败';output.textContent=String(e)});

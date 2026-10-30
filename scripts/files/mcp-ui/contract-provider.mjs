// Y30 explicit adversarial MCP inputs; original public SDK and real stdio.
import {Server} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {readFileSync} from 'node:fs';
const [path,uri,mode,html,control]=process.argv.slice(2),ui='ui://y30/view.html';
if(mode==='nonjson'){process.stdout.write('Y30 actual non-JSON stdout\n');setTimeout(()=>process.exit(6),50)}
else{
 const apps=mode.startsWith('apps'),counts={reads:0,toolPages:0,calls:0,subscribes:0,unsubscribes:0};
 const server=new Server({name:'Y30 owned contract fixture',version:'1.0.0'}, {capabilities:mode==='noresources'?{tools:{},logging:{}}:{resources:{subscribe:true},logging:{},...(apps?{tools:{}}:{})}});
 const trace=(method,extra={})=>server.notification({method:'notifications/message',params:{level:'info',data:{phase:'Y30-protocol',mode,method,...extra}}}).catch(()=>{});
 const cfg=()=>{try{return JSON.parse(readFileSync(control,'utf8'))}catch{return{version:1}}};
 if(mode!=='noresources'){
  server.setRequestHandler('resources/read',async request=>{
   await trace('resources/read',{uri:request.params.uri});
   if(apps&&request.params.uri===ui)return{contents:[{uri:ui,mimeType:'text/html;profile=mcp-app',text:readFileSync(html,'utf8')}]};
   if(request.params.uri!==uri)throw Error('Y30 unexpected URI');counts.reads++;
   if(mode==='timeout'){await new Promise(()=>{});throw Error('unreachable')}
   if(mode==='crash')process.exit(4);
   if(mode==='bad-uri')return{contents:[{uri:uri+'/../outside',text:'forbidden'}]};
   if(mode==='large30')return{contents:[{uri,text:'中'.repeat(10*1024*1024),size:1}]};
   if(mode==='large20')return{contents:[{uri,text:'x'.repeat(20*1024*1024+1),size:1}]};
   return{contents:[{uri,mimeType:'application/json',text:JSON.stringify({bytes:readFileSync(path).toString('base64'),version:cfg().version,...counts})}]};
  });
  server.setRequestHandler('resources/subscribe',async request=>{
   if(request.params.uri!==uri)throw Error('Y30 subscribe wrong URI');counts.subscribes++;await trace('resources/subscribe',{uri});
   if(mode==='flood')for(let i=0;i<600;i++)void server.notification({method:'notifications/resources/updated',params:{uri}}).catch(()=>{});
   if(mode==='subscription')setTimeout(()=>{void trace('delayed-update',{uri});void server.notification({method:'notifications/resources/updated',params:{uri}}).catch(()=>{})},200);
   return{};
  });
  server.setRequestHandler('resources/unsubscribe',async request=>{
   if(request.params.uri!==uri)throw Error('Y30 unsubscribe wrong URI');counts.unsubscribes++;await trace('resources/unsubscribe',{uri});
   if(mode==='subscription'){await server.notification({method:'notifications/resources/updated',params:{uri}});await trace('closing-late-update',{uri})}
   return{};
  });
 }
 if(apps||mode==='noresources'){
  server.setRequestHandler('tools/list',async request=>{
   counts.toolPages++;await trace('tools/list',{cursor:request.params?.cursor,page:counts.toolPages});
   if(mode==='apps-timeout')await new Promise(()=>{});
   const tool=(name,visibility,resourceUri)=>({name,inputSchema:{type:'object'},annotations:{readOnlyHint:true},_meta:{ui:{visibility,...(resourceUri?{resourceUri}:{})}}});
   const tools=[tool('initial',['model','app'],mode==='apps-wrong-ui'?ui+'/wrong':ui),tool('slice',['app']),tool('unregistered',['app'])];
   if(mode==='apps-bytes')tools[0].description='x'.repeat(1024*1024+64);
   return{tools,...(mode==='apps-pages'?{nextCursor:'page-'+counts.toolPages}:{})};
  });
  server.setRequestHandler('tools/call',async request=>{
   counts.calls++;await trace('tools/call',{name:request.params.name});
   if(request.params.name==='initial')return{content:[{type:'text',text:'Y30 original SDK initial tool'}],structuredContent:{uri,mode}};
   if(request.params.name==='slice'){
    const {offset,length}=request.params.arguments;return{content:[{type:'text',text:'Y30 bounded bytes'}],structuredContent:{uri,offset,length,base64:readFileSync(path).subarray(offset,offset+length).toString('base64')}};
   }
   throw Error('Y30 unregistered tool should not reach provider');
  });
 }
 await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:Math.ceil(20*1024*1024/3)*4+256*1024}));
}

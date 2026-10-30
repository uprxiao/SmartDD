// Real stdio protocol fixture: a pending read or the explicitly registered UI.
import {Server} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {readFileSync} from 'node:fs';
const[file,uri,mode,html,configPath]=process.argv.slice(2),uiUri='ui://s07/view.html';
const server=new Server({name:'S07 actual confined provider',version:'1.0.0'},{capabilities:{resources:{subscribe:true},tools:{},logging:{}}});
server.setRequestHandler('resources/read',async request=>{
 if(mode==='apps'&&request.params.uri===uiUri)return{contents:[{uri:uiUri,mimeType:'text/html;profile=mcp-app',text:readFileSync(html,'utf8')}]};
 if(request.params.uri!==uri)throw Error('Only exact current resource');
 if(mode==='slow'){await server.notification({method:'notifications/message',params:{level:'info',data:{phase:'S07-read-pending',uri}}});await new Promise(()=>{});}
 return{contents:[{uri,mimeType:'text/plain',blob:readFileSync(file).toString('base64')}]};
});
server.setRequestHandler('resources/subscribe',async()=>({}));server.setRequestHandler('resources/unsubscribe',async()=>({}));
server.setRequestHandler('tools/list',async()=>({tools:['initial','slice','mutate'].map(name=>({name,inputSchema:{type:'object'},annotations:{readOnlyHint:name!=='mutate'},_meta:{ui:{visibility:name==='initial'?['model','app']:['app'],...(name==='initial'?{resourceUri:uiUri}:{})}}}))}));
server.setRequestHandler('tools/call',async request=>{let configReadable=false;try{readFileSync(configPath);configReadable=true}catch{}return{content:[{type:'text',text:'S07 read-only fixture'}],structuredContent:{name:request.params.name,args:request.params.arguments,probe:{credentialEnvPresent:process.env.WILLYOU_S07_TEST_CREDENTIAL!==undefined,configReadable}}};});
await server.connect(new StdioServerTransport(process.stdin,process.stdout));

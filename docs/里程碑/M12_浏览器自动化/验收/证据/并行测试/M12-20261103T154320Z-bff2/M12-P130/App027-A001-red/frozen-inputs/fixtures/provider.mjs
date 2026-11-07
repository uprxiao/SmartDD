// Actual registered stdio fixture: only its approved HTML asset and private snapshot.
import {Server} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {readFileSync} from 'node:fs';
const [file,uri,html]=process.argv.slice(2),uiUri='ui://fixture/view.html';
const server=new Server({name:'WillYou SDK acceptance resource',version:'1.0.0'},{capabilities:{resources:{},tools:{}}});
server.setRequestHandler('resources/read',async request=>{
 if(request.params.uri===uiUri)return{contents:[{uri:uiUri,mimeType:'text/html;profile=mcp-app',text:readFileSync(html,'utf8')}]};
 if(request.params.uri!==uri)throw Error('Wrong exact resource');
 return{contents:[{uri,mimeType:'text/plain',blob:readFileSync(file).toString('base64')}]};
});
server.setRequestHandler('tools/list',async()=>({tools:['initial','slice','mutate'].map(name=>({name,inputSchema:{type:'object'},annotations:{readOnlyHint:name!=='mutate'},_meta:{ui:{visibility:name==='initial'?['model','app']:['app'],...(name==='initial'?{resourceUri:uiUri}:{})}}}))}));
server.setRequestHandler('tools/call',async r=>({content:[{type:'text',text:JSON.stringify(r.params)}],structuredContent:{name:r.params.name,args:r.params.arguments}}));
await server.connect(new StdioServerTransport(process.stdin,process.stdout));

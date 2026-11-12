// Native process/WebSocket fixture only. No model API, config or login reads.
const {WebSocketServer}=require('ws'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const mode=process.argv[process.argv.indexOf('--fixture-mode')+1];
if(mode==='startup-exit')process.exit(7);
const endpoint=process.argv[process.argv.indexOf('--listen')+1].replace(/^unix:\/\//,'');
const server=http.createServer(),ws=new WebSocketServer({noServer:true});let roots=[];
server.on('upgrade',(request,socket,head)=>ws.handleUpgrade(request,socket,head,peer=>ws.emit('connection',peer,request)));
const log=value=>{if(process.env.WILLYOU_TEST_LOG)fs.appendFileSync(process.env.WILLYOU_TEST_LOG,JSON.stringify(value)+'\n');};
ws.on('connection',socket=>{
  socket.on('error',()=>{});socket.on('message',bytes=>{
    const message=JSON.parse(bytes.toString());log({method:message.method,params:message.params});
    if(message.id===undefined)return;
    if(mode==='hang-request')return;
    if(mode==='malformed'){socket.send('{bad');return;}
    if(mode==='premature-close'){socket.close();return;}
    let result={};
    if(message.method==='skills/extraRoots/set')roots=message.params.extraRoots;
    if(message.method==='skills/list')result={data:[{cwd:message.params.cwds[0],errors:[],skills:roots.map(root=>({name:/^name:\s*(.+)$/m.exec(fs.readFileSync(path.join(root,'SKILL.md'),'utf8'))[1],path:path.join(mode==='wrong-root'?'/wrong':root,'SKILL.md'),enabled:true}))}]};
    socket.send(JSON.stringify({id:message.id,result}));
  });
});
server.listen(endpoint,()=>log({event:'listening',endpoint}));
if(mode==='ignore-term')process.on('SIGTERM',()=>log({event:'term-ignored'}));
else process.once('SIGTERM',()=>{for(const socket of ws.clients)socket.terminate();server.close(()=>process.exit(0));});

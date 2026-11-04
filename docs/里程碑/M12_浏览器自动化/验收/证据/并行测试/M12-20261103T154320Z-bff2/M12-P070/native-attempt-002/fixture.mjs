import{createServer}from'node:http';
export function createDialogFixture(){
 const requests=[],results=[],streams=new Set(),sockets=new Set(),sourceCode='(()=>{window.p070Results={};const source=new EventSource("/events");source.addEventListener("open",()=>fetch("/ready"));source.addEventListener("message",event=>{const m=JSON.parse(event.data);try{const value=window[m.kind](m.message,m.defaultValue);const result={id:m.id,kind:m.kind,type:typeof value,value:typeof value==="undefined"?null:value};window.p070Results[m.id]=result;document.querySelector("#result").textContent=JSON.stringify(result);fetch("/result",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(result)})}catch(error){fetch("/result",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:m.id,kind:m.kind,fixtureError:String(error)})})}})})()';
 new Function(sourceCode);
 const server=createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');requests.push({atMs:Date.now(),path:u.pathname,method:req.method});res.setHeader('cache-control','no-store');
  if(u.pathname==='/events'){res.writeHead(200,{'content-type':'text/event-stream','connection':'keep-alive'});res.write(': privateP070\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return}
  if(u.pathname==='/ready'){res.end('ready');return}
  if(u.pathname==='/result'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{const value=JSON.parse(body);results.push({...value,atMs:Date.now()});res.end('ok')});return}
  if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return}
  res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><title>[I] P070 dialog</title><h1>Dialog fixture</h1><input id="unsaved" value="P070 unchanged"><output id="result"></output><script>'+sourceCode+'</script>');
 });
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))});
 return{server,requests,results,sourceCode,ready:()=>streams.size>0,trigger(message){if(streams.size!==1)throw Error('Exactly one own dialog fixture SSE connection required');for(const response of streams)response.write('data: '+JSON.stringify(message)+'\n\n');requests.push({atMs:Date.now(),kind:'synthetic-fixture-sse-trigger',message})},async close(){for(const response of streams)response.end();for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(ok=>server.close(ok))}};
}

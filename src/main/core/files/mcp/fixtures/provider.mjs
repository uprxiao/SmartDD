// Synthetic resources served through the public MCP SDK; no production-only test hook.
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
const [path, mode, uri, outside, port] = process.argv.slice(2), uiUri = 'ui://fixture/viewer.html';
if (mode === 'malformed') { process.stdout.write('not-json\n'); setTimeout(() => process.exit(), 30); }
else {
 const apps = mode.startsWith('apps'), server = new Server({name:'isolated-viewer-fixture',version:'1.0.0'}, {capabilities: mode === 'noresources' ? {tools:{}} : {resources:{subscribe:true}, ...(apps ? {tools:{}} : {})}});
 let toolPages = 0, calls = 0;
 if (mode !== 'noresources') {
 server.setRequestHandler('resources/read', async request => {
  if (request.params.uri === uiUri && apps) return {contents:[{uri:uiUri,mimeType:'text/html;profile=mcp-app',text:'<!doctype html><body>Isolated MCP fixture</body>'}]};
  if (request.params.uri !== uri) throw new Error('Wrong URI');
  if (mode === 'timeout') await new Promise(() => {});
  if (mode === 'crash') process.exit(4);
  const bytes = readFileSync(path);
  if (mode === 'bad-uri') return {contents:[{uri:uri+'/outside',text:'wrong'}]};
  if (mode === 'oversize') return {contents:[{uri,text:'x'.repeat(30*1024*1024),size:1}]};
  if (mode === 'probe') {
   let outsideRead=false,snapshotWrite=false;
   try {readFileSync(outside);outsideRead=true} catch {}
   try {writeFileSync(path,'evil');snapshotWrite=true} catch {}
   const child=spawnSync('/usr/bin/true');
   const network=await new Promise(resolve=>{const socket=connect(Number(port || 9),'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false));socket.setTimeout(500,()=>{socket.destroy();resolve(false)});});
   return {contents:[{uri,text:JSON.stringify({bytes:bytes.toString('base64'),outsideRead,snapshotWrite,childSpawn:child.status===0,network})}]};
  }
  if (apps) return {contents:[{uri,text:JSON.stringify({bytes:bytes.toString('base64'),toolPages,calls})}]};
  return {contents:[mode === 'text' ? {uri,text:bytes.toString('utf8')} : {uri,blob:bytes.toString('base64')}]};
 });
 server.setRequestHandler('resources/subscribe',async()=>{if(mode === 'flood') for(let i=0;i<500;i++) void server.notification({method:'notifications/resources/updated',params:{uri}});return{}});
 server.setRequestHandler('resources/unsubscribe',async()=>({}));
 }
 if (apps || mode === 'noresources') {
  server.setRequestHandler('tools/list', async()=> {
   toolPages++;
   const tool = (name,visibility,resourceUri) => ({name,inputSchema:{type:'object'},annotations:{readOnlyHint:name!=='mutate'},_meta:{ui:{visibility,...(resourceUri?{resourceUri}:{})}}});
   return {tools:[tool('initial',['model','app'],uiUri),tool('slice',['app']),tool('mutate',['app']),tool('model_only',['model'])], ...(mode==='apps-pages'?{nextCursor:String(toolPages)}:{})};
  });
  server.setRequestHandler('tools/call',async request=>{calls++; return {content:[{type:'text',text:JSON.stringify({name:request.params.name,args:request.params.arguments})}],structuredContent:{name:request.params.name,args:request.params.arguments}}});
 }
 await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:Math.ceil(20*1024*1024/3)*4+256*1024}));
}

import {readFile} from 'node:fs/promises';
const root='/private/tmp/willyou-m12-t145-cert-sites24-prep-004';
const manual=JSON.parse(await readFile(root+'/manual-ready.json'));
const [port]=(await readFile(manual.userData+'/DevToolsActivePort','utf8')).trim().split('\n');
const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
for(const target of targets.filter(t=>t.type==='page'&&((t.url.startsWith('file:')&&t.url.includes('app.asar'))||t.url===manual.url))){
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const result=await new Promise((resolve,reject)=>{
  ws.addEventListener('message',event=>{const response=JSON.parse(event.data);if(response.id===1){if(response.error)reject(response.error);else resolve(response.result?.result?.value);}});
  const expression="({focused:document.hasFocus(),visible:document.visibilityState,taskId:document.querySelector('[data-testid=sidebar-task][aria-current=page]')?.dataset.taskId,marker:document.querySelector('h1')?.textContent})";
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
 });
 console.log(JSON.stringify({type:target.url.startsWith('file:')?'own-renderer':'own-localTLS',result}));
 ws.close();
}

// Actual packaged renderer checks plus public-IPC/real-native-host integration.
// Direct attachment IPC is I evidence, not a substitute for a source host's A.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-attachment-dispatch-'),projectPath=join(scratch,'project');await mkdir(projectPath);
const requests=[],trap=createServer((req,res)=>{requests.push(req.url);res.end('Unexpected attachment request')});await new Promise(r=>trap.listen(0,'127.0.0.1',r));
const trapUrl=`http://127.0.0.1:${trap.address().port}/attachment-network-trap`,markdown='# ATTACHMENT_HEADING_中文🙂\r\n\r\n**BOLD_ATTACHMENT**\r\n';
const html=`<!doctype html><meta charset="UTF-8"><h1>MIME_HTML_中文🙂</h1><script>document.body.dataset.executed='true';document.body.dataset.bridge=[typeof electronAPI,typeof require,typeof process].join('|');fetch(${JSON.stringify(trapUrl)}).catch(()=>document.body.dataset.network='blocked')</script>`;
const cases=[['extensionless-html','text/html','html'],['extensionless-md','text/markdown','markdown'],['extensionless-alias','text/x-markdown','markdown'],['extensionless-plain','text/plain','text'],['unknown.ext','text/html',null],['readonly.mdx','text/markdown',null],['readonly.md','text/html','markdown'],['readonly.html','text/plain','html'],['binary-no-extension','text/html',null]];
const fixtures={};for(const extension of ['md','markdown','mdown','mdx','mkd'])fixtures['ordinary.'+extension]=markdown;
for(const[name,,kind]of cases)fixtures[name]=name==='binary-no-extension'?Buffer.from([0,1,2,3]):kind==='html'?html:markdown;
for(const[name,bytes]of Object.entries(fixtures))await writeFile(join(projectPath,name),bytes);
await writeFile(join(scratch,'fixtures.json'),JSON.stringify({cases,trapUrl},null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),fingerprints=async()=>Object.fromEntries(await Promise.all(Object.keys(fixtures).map(async name=>{const p=join(projectPath,name),s=await stat(p,{bigint:true});return[name,{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources'),result={at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),scratch,projectPath,before:await fingerprints(),uiChecks:[],ipcChecks:[],status:'running'};
let app,stage='initial';
async function connectChild(url){
 const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});let serial=0;const pending=new Map();
 socket.addEventListener('message',({data})=>{const message=JSON.parse(data);if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result)}});
 const command=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Attachment child observation timed out'))},5000);pending.set(id,{timer,resolve,reject});socket.send(JSON.stringify({id,method,params}))});
 return{evaluate:async expression=>{const message=await command('Runtime.evaluate',{expression,returnByValue:true});if(message.exceptionDetails)throw new Error('Attachment child expression failed');return message.result.value},screenshot:()=>command('Page.captureScreenshot',{format:'png'}),close:()=>socket.close()};
}
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'Attachment dispatch integration'});
 for(const extension of ['md','markdown','mdown','mdx','mkd']){
  stage='ordinary.'+extension;await app.open(stage);await app.waitFor("Boolean(document.querySelector('.cm-content'))");assert(await app.evaluate("Boolean(document.querySelector('[aria-label=\"查看源码\"]'))"));
  // The active Markdown block exposes its source. Put the caret in the heading
  // so the separate bold paragraph is eligible for actual rich rendering.
  await app.click('.cm-content');await app.key('ArrowUp','ArrowUp',4);await app.waitFor("document.querySelector('.fw-md-block strong')?.textContent==='BOLD_ATTACHMENT'");
  await app.screenshot(join(scratch,stage+'.png'));await app.click('[aria-label="查看源码"]');await app.waitFor("Boolean(document.querySelector('[aria-label=\"查看文档\"]'))");assert((await app.evaluate("document.querySelector('.cm-content').textContent")).includes('**BOLD_ATTACHMENT**'));await app.click('[aria-label="查看文档"]');result.uiChecks.push({file:stage,ordinaryMarkdownDefault:true,sourceRoundTrip:true});
 }
 const roots=await app.invoke('files.roots',{kind:'project',projectId:app.project.id}),root=roots.roots[0];assert(root);
 const port=/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(app.logs())?.[1];assert(port,'Own isolated App debugger address unavailable');
 for(const[name,mimeType,textKind]of cases){
  stage='attachment:'+name;const document=await app.invoke('files.open',{lease:root.lease,generation:root.generation,relativePath:name,readOnly:true,attachment:{mimeType}});assert.equal(document.writable,false);assert.deepEqual(document.attachment,{mimeType,textKind});
  const refreshed=await app.invoke('files.refresh',document.ref);assert.deepEqual(refreshed.attachment,document.attachment);assert.equal(refreshed.writable,false);
  await assert.rejects(()=>app.invoke('files.save',{ref:document.ref,opId:randomUUID(),bufferVersion:1,baseHash:document.revision.hash,base64:Buffer.from('must not save').toString('base64')}),/PERMISSION|只读/);
  const check={file:name,mimeType,textKind,readonly:true,writeRejected:true,layer:'I public production IPC, native service'};
  const id=randomUUID();let child;
  try{
   if(textKind!=='html')await assert.rejects(()=>app.invoke('files.openHtml',{id,ref:document.ref,baseHash:document.revision.hash}),/UNSUPPORTED|不是HTML/);
   else{
    assert.equal((await app.invoke('files.openHtml',{id,ref:document.ref,baseHash:document.revision.hash})).state,'ready');await app.invoke('files.htmlBounds',{id,x:800,y:100,width:300,height:400,visible:true});
    const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),target=targets.find(t=>t.url.startsWith('willyou-document://')&&new URL(t.url).pathname==='/'+name);assert(target,'Actual isolated HTML document target missing');
    child=await connectChild(target.webSocketDebuggerUrl);let observed;for(let n=0;n<30;n++){observed=await child.evaluate("({text:document.body.innerText,executed:document.body.dataset.executed,bridge:document.body.dataset.bridge,network:document.body.dataset.network})");if(observed.network==='blocked')break;await pause(50)}
    assert(observed.text.includes('MIME_HTML_中文🙂'));assert.equal(observed.executed,'true');assert.equal(observed.bridge,'undefined|undefined|undefined');assert.equal(observed.network,'blocked');assert.deepEqual(requests,[]);check.actualIsolatedHtml=observed;check.layer='I actual native HTML WebContentsView through production public IPC; not a source-host user A';await writeFile(join(scratch,name+'-native-html.png'),Buffer.from((await child.screenshot()).data,'base64'));await app.screenshot(join(scratch,name+'.png'));
   }
  }finally{child?.close();await app.invoke('files.closeHtml',id);await app.invoke('files.closeDocument',document.ref)}
  result.ipcChecks.push(check);
 }
 result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual(requests,[]);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';
 result.boundary='Five ordinary Markdown App branches passed. Attachment behavior is actual IPC/native-host I plus separate production panel component tests; actual originating attachment host is not wired yet, full F04/F07/F21/G12 A remains pending. No clipboard/model/CLI.';
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error);process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'))}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close()}await new Promise(r=>trap.close(r));result.requests=requests;result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,uiChecks:result.uiChecks.length,ipcChecks:result.ipcChecks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}

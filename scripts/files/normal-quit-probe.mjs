// Diagnostic only: compare quitting with a live watcher and after real UI cleanup.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-quit-diagnostic-');
const r={at:new Date().toISOString(),scratch,asarSha256:createHash('sha256').update(await readFile(resolve(executable,'../../Resources/app.asar'))).digest('hex'),checks:[],boundary:'Diagnostic only; unchanged packaged App, two distinct owned userData/projects. Actual UI opens and closes panes. Passive lifecycle logging and original native subscribe/unsubscribe forwarding; no result, delay or close acknowledgment substitution. Does not add a formal case pass.'};
const modes=process.env.WILLYOU_QUIT_MODE==='close-ui'?[true]:[false,true];
for(const closePane of modes){
 const name=closePane?'close-ui':'active-pane',base=join(scratch,name),root=join(base,'project'),trace=join(base,'events.jsonl');await mkdir(root,{recursive:true});await writeFile(join(root,'a.txt'),'QUIT_PROBE_中文🙂\n');
 const row={name,root,trace};r.checks.push(row);let app;
 try{
  app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(base,'userdata'),name:'A · M9 isolated quit diagnostic',inspectMain:true,prepare:async({app})=>{
   await app.mainEvaluate(`(()=>{const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),e=req('electron'),mod=req(e.app.getAppPath()+'/node_modules/@parcel/watcher'),fs=req('node:fs'),record=(event,extra={})=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({at:Date.now(),event,pid:process.pid,...extra})+'\\n');globalThis.__ownedQuitProbe={record,active:0};const original=mod.subscribe;mod.subscribe=async function(...args){const native=await original.apply(this,args);globalThis.__ownedQuitProbe.active++;record('subscribed');const unsubscribe=native.unsubscribe;native.unsubscribe=async function(...values){record('unsubscribe-start');try{return await unsubscribe.apply(this,values)}finally{globalThis.__ownedQuitProbe.active--;record('unsubscribe-done');native.unsubscribe=unsubscribe}};return native};for(const event of ['before-quit','will-quit','quit','window-all-closed'])e.app.on(event,(...args)=>record(event,{code:event==='quit'?args[1]:undefined,active:globalThis.__ownedQuitProbe.active}));return true})()`);
  }});
  await app.open('a.txt');await app.waitFor("document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()==='QUIT_PROBE_中文🙂\\n'");
  const nativeDeadline=Date.now()+10000;while(!await app.mainEvaluate('globalThis.__ownedQuitProbe.active')){assert(Date.now()<nativeDeadline,'Original native subscribe not ready');await new Promise(done=>setTimeout(done,50));}
  row.nativeBefore=await app.mainEvaluate('globalThis.__ownedQuitProbe.active');assert(row.nativeBefore>0);
  if(closePane){await app.click('[data-testid=project-files]');await app.waitFor('!document.querySelector("[data-testid=file-workspace]")');const deadline=Date.now()+10000;while(await app.mainEvaluate('globalThis.__ownedQuitProbe.active'))assert(Date.now()<deadline,'Original native unsubscribe did not finish');}
  await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__ownedQuitProbe.record('requested');setTimeout(()=>e.app.quit(),50);return true})()");
  const quitStarted=Date.now();row.exit=await app.waitForExit(Number(process.env.WILLYOU_QUIT_TIMEOUT??15000));row.quitMs=Date.now()-quitStarted;assert.equal(row.exit.code,0);assert.equal(row.exit.signal,null);row.status='passed';
 }catch(error){row.status='failed';row.error=String(error);}finally{if(app){await writeFile(join(base,'electron.log'),app.logs());await app.close();}await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(row));}
}

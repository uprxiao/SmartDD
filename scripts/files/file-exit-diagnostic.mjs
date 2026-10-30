// Own packaged App diagnostic, not a substitute for the full L17 UI case.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {openTaskFileFixture} from '../lib/task-file-fixture.mjs';
import {pause} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_FILES_APP,source=process.env.WILLYOU_IMAGE_OPEN_SOURCE,scene=process.env.WILLYOU_EXIT_SCENE;assert(executable&&source&&['empty','markdown','task'].includes(scene));
const scratch=await mkdtemp('/private/tmp/willyou-exit-diagnostic-'+scene+'-'),root=join(scratch,'project');await mkdir(root);await writeFile(join(root,'picture.png'),await readFile(source));await writeFile(join(root,'images.md'),'# Exit observation\n\n![Original image](picture.png)\n');
const sha=b=>createHash('sha256').update(b).digest('hex'),r={at:new Date().toISOString(),scene,scratch,root,asarSha256:sha(await readFile(resolve(executable,'../../Resources/app.asar'))),status:'running',boundary:'Diagnostic only,not fullL17acceptance or latencyrepair. Original normal packagedApp/trustedfileUI. Input-onlysynthetic tasks use setup/cleanupAPI;no model or usercredentials. Passive app/window lifecycle writes and targeted1s sample onlyof this childPID. Original scheduled app.quit;60s observation budget leaves earlier20sfailed results intact.'};
let app,fixture,watching=true,sampler;
try{
 if(scene==='task'){fixture=await openTaskFileFixture({executable,scratch,root,name:'A exit diagnostic task'});app=fixture.app;await fixture.show('T2');await fixture.show('T1');}else app=await openFileAcceptanceApp({executable,projectPath:root,userData:join(scratch,'userdata'),name:'A exit diagnostic '+scene,inspectMain:true});
 r.pid=app.processId;
 if(scene!=='empty'){
  await app.open('images.md');await app.waitFor('document.querySelector(\'img[data-md-src="picture.png"]\')?.naturalWidth===1600');
  if(scene==='task'){
   const p=await app.evaluate(`(()=>{const e=document.querySelector('img[data-md-src="picture.png"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,...p,button:'right',clickCount:1});await app.waitFor('!!document.querySelector(".fw-embedded-image-menu")');await app.click('.fw-embedded-image-menu [role=menuitem]','在新标签打开图片');await app.waitFor('document.querySelector(".fw-ordinary-image img")?.naturalWidth===1600');
  }else{await app.open('picture.png');await app.waitFor('document.querySelector(".fw-ordinary-image img")?.naturalWidth===1600');}
  await app.open('images.md');await app.waitFor('!!document.querySelector(".fw-codemirror")');
 }
 if(fixture){r.receivers={};for(const [label,t]of Object.entries(fixture.tasks)){const end=Date.now()+15000;for(;;){try{r.receivers[label]=await fixture.receiver(label);break;}catch(error){if(error.code!=='ENOENT')throw error;assert(Date.now()<end,'Own input receiver not ready');await pause(30);}}assert.equal(r.receivers[label].rawHex,'');assert.equal(r.receivers[label].executedCommands,0);await app.invoke('tasks.kill',t.task.id);}}
 const lifecycle=join(scratch,'lifecycle.json');
 await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),fs=process.getBuiltinModule('fs'),rows=[],record=kind=>{rows.push({at:Date.now(),kind});fs.writeFileSync(${JSON.stringify(lifecycle)},JSON.stringify(rows,null,2)+'\\n');};for(const name of['before-quit','will-quit','quit','window-all-closed']){e.app.prependListener(name,()=>record('before:'+name));e.app.on(name,()=>record('after:'+name));}const w=e.BrowserWindow.getAllWindows();if(w.length!==1)throw Error('Own window count');for(const name of['close','closed'])w[0].on(name,()=>record('window:'+name));record('observer-ready');return true})()`,{synchronous:true});
 // Sampling starts from the parent as soon as the actual quit event lands.
 // This avoids the human/tool round trip after the process has already exited.
 const monitor=(async()=>{while(watching){try{const rows=JSON.parse(await readFile(lifecycle,'utf8'));if(rows.some(x=>x.kind==='after:quit')){r.sampleStartedAt=new Date().toISOString();sampler=new Promise(done=>execFile('/usr/bin/sample',[String(r.pid),'1','1','-file',join(scratch,'exit-sample.txt')],{timeout:5000},async(error,stdout,stderr)=>{r.sample={code:error?.code??0,error:error?String(error):null,stdout,stderr};await writeFile(join(scratch,'sample-command.json'),JSON.stringify(r.sample,null,2)+'\n');done();}));await sampler;return;}}catch(e){if(e.code!=='ENOENT')r.monitorError=String(e);}await pause(20);}})();
 r.quitRequestedAt=new Date().toISOString();r.inspectorClosedBeforeQuit=process.env.WILLYOU_EXIT_CLOSE_INSPECTOR==='1';
 if(r.inspectorClosedBeforeQuit)await app.mainEvaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),inspector=process.getBuiltinModule('inspector'),fs=process.getBuiltinModule('fs'),record=kind=>{const p=${JSON.stringify(lifecycle)},rows=JSON.parse(fs.readFileSync(p,'utf8'));rows.push({at:Date.now(),kind});fs.writeFileSync(p,JSON.stringify(rows,null,2)+'\\n');};setTimeout(()=>{record('diagnostic:inspector-close-start');inspector.close();record('diagnostic:inspector-close-done');e.app.quit();},100);return true})()`,{synchronous:true});
 else await app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');setTimeout(()=>e.app.quit(),30);return true})()",{synchronous:true});
 try{r.exit=await app.waitForExit(60000);r.exitObservedAt=new Date().toISOString();assert.equal(r.exit.code,0);assert.equal(r.exit.signal,null);r.status='normal-exit-observed';}finally{watching=false;await monitor;}
 r.lifecycle=JSON.parse(await readFile(lifecycle,'utf8'));r.lastObservedQuit=r.lifecycle.filter(x=>x.kind==='after:quit').at(-1);if(r.lastObservedQuit)r.afterQuitToObservedExitMs=Date.parse(r.exitObservedAt)-r.lastObservedQuit.at;
}catch(error){watching=false;r.status='failed';r.error=String(error);r.stack=error.stack;process.exitCode=1;}
finally{watching=false;if(sampler)await sampler;if(app){await writeFile(join(scratch,'electron.log'),app.logs());if(fixture)await fixture.close();else await app.close();}r.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r));}

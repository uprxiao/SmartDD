// Original source035 pdf-acceptance-ui.mjs business body. Only the existing
// mature real UI/file adapter and per-stage persistence replace its auto-launch wrapper.
import assert from 'node:assert/strict';
import{join,basename}from'node:path';import{pause}from'./driver-source/scripts/lib/electron-harness.mjs';
export async function runPdfAcceptance({actual,ui,own,result,oracle,projectPath,scratch,fingerprints,persist,screenshot,openFile,changeStage}){
 const app={evaluate:(...x)=>actual.evaluate(...x),waitFor:(...x)=>actual.waitFor(...x),invoke:(...x)=>actual.invoke(...x),click:(...x)=>ui.click(...x),open:openFile,exists:selector=>'Boolean(document.querySelector('+JSON.stringify(selector)+'))',project:{id:result.projectId},get rendererErrors(){return actual.rendererErrors},screenshot:path=>screenshot(basename(path)),
 cdp:async(method,params,...rest)=>{const value=await actual.cdp(method,params,...rest);if(method.startsWith('Input.')||method==='Page.reload'){result.actions.push({kind:'original-pdf-cdp-input',method,type:params?.type,key:params?.key,textCharacters:params?.text?.length,at:new Date().toISOString()});await persist();}return value},
 key:async(key,code,modifiers=0)=>{const virtual={Enter:13,Space:32,Tab:9,Escape:27}[code]??(/^Key[A-Z]$/.test(code)?code.charCodeAt(3):undefined),text=code==='Enter'?'\r':code==='Space'?' ':undefined;for(const type of['keyDown','keyUp'])await actual.cdp('Input.dispatchKeyEvent',{type,key,code,modifiers,...(virtual?{windowsVirtualKeyCode:virtual}:{}),...(type==='keyDown'&&text?{text,unmodifiedText:text}:{})});result.actions.push({kind:'original-pdf-key',key,code,modifiers,at:new Date().toISOString()});await persist();}};
 const markStage=async name=>{changeStage(name);await persist()};
 const ready=()=>app.waitFor("Boolean(document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb) canvas[data-rendered=true]'))&&Boolean(document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb) .fw-pdf-text span'))",20000);
 const close=async name=>{await app.click(`[aria-label=${JSON.stringify('关闭 '+name)}]`);await app.waitFor("!document.querySelector('.fw-pdf')")};
 const password=async value=>{await app.click('input[aria-label="PDF 密码"]');await app.key('a','KeyA',4);await app.cdp('Input.insertText',{text:value});await app.click('.fw-pdf-password button','打开')};
 {
  result.fontRegressionTheme=await app.evaluate('document.documentElement.className');
  for(const item of oracle.cases.filter(item=>!['normal','password','invalid'].includes(item.kind))){
   await markStage(item.name);await app.open(item.name);await app.waitFor("Boolean(document.querySelector('.fw-pdf'))");const check={file:item.name,kind:item.kind};result.currentCheck=check;
   if(item.kind==='invalid'){
    await app.waitFor("Boolean(document.querySelector('.fw-pdf [role=alert]'))",20000);check.error=await app.evaluate("document.querySelector('.fw-pdf [role=alert]').textContent");assert.match(check.error,/不是有效.*PDF|损坏|有效的 PDF/);assert(!check.error.includes('密码'));check.retryEntry=await app.evaluate("Boolean(document.querySelector('.fw-pdf [role=alert] button'))");assert(check.retryEntry);
   }else{
    if(item.kind==='password'){
     await app.waitFor("Boolean(document.querySelector('.fw-pdf-password'))");assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf-text span'))"));check.missingPassword=true;
     await app.click('.fw-pdf-password button','取消');await app.waitFor("document.querySelector('.fw-pdf [role=alert]')?.textContent.includes('已取消输入密码')");assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf-password'))"));check.cancel=await app.evaluate("document.querySelector('.fw-pdf [role=alert]').textContent");
     await app.click('.fw-pdf [role=alert] button','重试');await app.waitFor("Boolean(document.querySelector('.fw-pdf-password'))");await password('m9-wrong-synthetic');await app.waitFor("document.querySelector('.fw-pdf-password')?.textContent.includes('密码错误')");assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf-text span'))"));check.wrongPassword=true;
     await password('m9-user');
    }
    await ready();check.render=await app.evaluate("(()=>{const p=document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)'),c=p.querySelector('canvas'),x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<d.length;i+=4)if(d[i]<235||d[i+1]<235||d[i+2]<235)ink++;return{canvas:[c.width,c.height],inkPixels:ink,text:p.querySelector('.fw-pdf-text').textContent,fonts:[...new Set([...p.querySelectorAll('.fw-pdf-text span')].map(s=>getComputedStyle(s).fontFamily))]}})()");
    assert(check.render.inkPixels>20);assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf-password'))"));
    if(item.kind==='cjk')assert(check.render.text.replace(/\s/g,'').includes('文件工作区中文测试'));
    if(item.kind==='missing-mixed'){assert(check.render.text.replace(/\s/g,'').includes(item.expectedText.replace(/\s/g,'')));assert(check.render.text.includes('MISSING_FONT Latin 12345'));check.fontBoundary=item.boundary}
    if(item.kind==='forms'){check.formWidgetsAbsent=!await app.evaluate("Boolean(document.querySelector('.fw-pdf input,.fw-pdf textarea,.fw-pdf select'))");assert(check.formWidgetsAbsent);}
    if(item.kind==='scripts'){check.scriptGlobal=await app.evaluate('window.PDF_EXECUTED??null');assert.equal(check.scriptGlobal,null);}
   }
   await app.screenshot(join(scratch,item.name+'.png'));await close(item.name);result.checks.push(check);delete result.currentCheck;
  }
  result.fontRegressionComplete=true;
 }
 // Accepted DEV135/r79 safety component of original F15. This is an actual
 // App branch only:2 themes x(6 password states+3 damaged PDFs)=18 records.
 result.safetyChecks=[];result.safetyThemes=[];
 const prompt='.fw-pdf-password',text='.fw-pdf-text span',canvas='.fw-pdf-page:not(.fw-pdf-thumb) canvas[data-rendered=true]',alert='.fw-pdf [role=alert]';
 const record=(caseId,theme,scenario,detail={})=>result.safetyChecks.push({caseId,theme,scenario,pass:true,...detail});
 const key=async(k,code=k,modifiers=0)=>{const v={Enter:13,Escape:27,Tab:9,Home:36,End:35,ArrowDown:40,ArrowUp:38}[code];for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:k,code,modifiers,...(v?{windowsVirtualKeyCode:v}:{}),...(type==='keyDown'&&code==='Enter'?{text:'\r'}:{})});};
 const noLeak=async()=>{assert(!await app.evaluate(`Boolean(document.querySelector(${JSON.stringify(text)}))`));assert(!await app.evaluate(`Boolean(document.querySelector(${JSON.stringify(canvas)}))`));};
 const open=name=>app.open(name);
 const enterPassword=async value=>{await app.click(`${prompt} input`);await app.key('a','KeyA',4);await app.cdp('Input.insertText',{text:value});await app.evaluate(`globalThis.__pdfSafetyPasswordPrompt=document.querySelector(${JSON.stringify(prompt)});true`);await app.click(`${prompt} button`,'打开');await app.waitFor(`document.querySelector(${JSON.stringify(prompt)})!==globalThis.__pdfSafetyPasswordPrompt`);await app.evaluate('delete globalThis.__pdfSafetyPasswordPrompt;true');};
 const scanStrings=async()=>{const states=await app.evaluate('({local:Object.values(localStorage),session:Object.values(sessionStorage)})');for(const value of[...states.local,...states.session])for(const secret of['m9-user','dev135-wrong-synthetic'])assert(!value.includes(secret),'Password persisted in web storage');return{localValues:states.local.length,sessionValues:states.session.length,noPassword:true};};
 await app.evaluate("(()=>{const s={rows:[],listener:e=>s.rows.push({type:e.type,key:e.key,trusted:e.isTrusted})};globalThis.__pdfSafetyInputs=s;for(const type of['keydown','pointerdown'])document.addEventListener(type,s.listener,true);return true})()");
 try{
 for(const theme of['light','dark']){
  await markStage(theme+':theme');await app.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await app.waitFor(`document.documentElement.classList.contains(${JSON.stringify(theme==='dark'?'ydark':'ylight')})`);result.safetyThemes.push({theme,actualClass:await app.evaluate('document.documentElement.className')});
  await markStage(theme+':password-missing');await open('encrypted.pdf');await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(prompt)}))`);await noLeak();record('M9-T-Y15',theme,'missing password has dialog and no page content');
  await markStage(theme+':password-cancel');await app.click(`${prompt} button`,'取消');await app.waitFor(`document.querySelector(${JSON.stringify(alert)})?.textContent.includes('需要密码')`);await app.waitFor(`!document.querySelector(${JSON.stringify(prompt)})`);await pause(250);const cancelled=await app.evaluate(`document.querySelector(${JSON.stringify(alert)}).textContent`);assert(cancelled.includes('需要密码'));assert(!/无法渲染|工作进程|响应超时/.test(cancelled));await noLeak();record('M9-T-Y15',theme,'cancel remains a password error after real destroy settles',{cancelled});
  await markStage(theme+':password-retry');await app.click(`${alert} button`,'重试');await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(prompt)}))`);await noLeak();record('M9-T-Y15',theme,'retry produces a fresh missing-password prompt');
  await markStage(theme+':password-wrong');for(let i=0;i<2;i++){await enterPassword('dev135-wrong-synthetic');await app.waitFor(`document.querySelector(${JSON.stringify(prompt)})?.textContent.includes('密码错误')`);await noLeak();}record('M9-T-Y15',theme,'two wrong attempts preserve prompt and expose no page');
  await markStage(theme+':password-correct');await enterPassword('m9-user');await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(canvas)}))&&Boolean(document.querySelector(${JSON.stringify(text)}))&&!document.querySelector(${JSON.stringify(prompt)})`,20000);
  const rendered=await app.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(canvas)}),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<data.length;i+=4)if(data[i]<235||data[i+1]<235||data[i+2]<235)ink++;return{width:c.width,height:c.height,ink,text:[...document.querySelectorAll(${JSON.stringify(text)})].map(x=>x.textContent).join('')}})()`);assert(rendered.ink>20&&rendered.text.length>0);record('M9-T-Y15',theme,'correct password dismisses prompt and renders actual PDF pixels/text',{rendered});await app.screenshot(join(scratch,theme+'-password-ready.png'));await close('encrypted.pdf');
  await markStage(theme+':password-close-retry');await open('encrypted.pdf');await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(prompt)}))`);await enterPassword('dev135-wrong-synthetic');await app.waitFor(`document.querySelector(${JSON.stringify(prompt)})?.textContent.includes('密码错误')`);await close('encrypted.pdf');await scanStrings();record('M9-T-Y15',theme,'reopen does not reuse password; close during retry removes dialog and web storage has no password');
  for(const name of['truncated.pdf','garbage.pdf','invalid.pdf']){
   await markStage(theme+':'+name);const started=Date.now();await open(name);await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(alert)}))`,20000);const error=await app.evaluate(`document.querySelector(${JSON.stringify(alert)}).textContent`);assert(/不是有效.*PDF|损坏/.test(error));assert(!/密码|响应超时|读取文件失败/.test(error));await noLeak();const firstErrorMs=Date.now()-started;assert(firstErrorMs<20000);
   await app.click(`${alert} button`,'重试');await app.waitFor(`document.querySelector(${JSON.stringify(alert)})?.textContent.includes('损坏')`);await noLeak();await app.waitFor("Boolean(document.querySelector('.fw-open-button>button:not(:disabled)'))");await app.click('[aria-label="打开方式"]');const menuSelector='[role=menu]';await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(menuSelector)}))`);await app.waitFor("document.querySelectorAll('[role=menu] .fw-menu-name').length>0");const choices=await app.evaluate(`document.querySelector(${JSON.stringify(menuSelector)}).textContent`);assert(await app.evaluate("[...document.querySelectorAll('[role=menu] .fw-menu-name')].some(e=>e.textContent.trim().length>0)"));await key('Escape');await app.waitFor(`!document.querySelector(${JSON.stringify(menuSelector)})`);record('M9-T-Y16',theme,name+' rejects with retry and reachable external-open choices, no launch',{error,firstErrorMs,choices});await app.screenshot(join(scratch,theme+'-'+name+'.png'));await close(name);
  }
 }

 result.pdfSafetyWebStorage=await scanStrings();result.safetyInputs=await app.evaluate('globalThis.__pdfSafetyInputs.rows');assert(result.safetyInputs.length>0&&result.safetyInputs.every(x=>x.trusted));assert.equal(result.safetyChecks.length,18);
 }finally{result.safetyObserverRestored=await app.evaluate("(()=>{const s=globalThis.__pdfSafetyInputs;if(s)for(const type of['keydown','pointerdown'])document.removeEventListener(type,s.listener,true);delete globalThis.__pdfSafetyInputs;delete globalThis.__pdfSafetyPasswordPrompt;return !globalThis.__pdfSafetyInputs&&!globalThis.__pdfSafetyPasswordPrompt})()");}
 result.caseResults.F15='passed';await persist();

 {
  await markStage('normal-navigation');await app.open('normal.pdf');await ready();await app.waitFor("document.querySelector('.fw-pdf-status')?.textContent.includes('/ 3 页')");
  const selection=await app.evaluate("(()=>{const nodes=[...document.querySelectorAll('.fw-pdf-page:not(.fw-pdf-thumb) .fw-pdf-text span')];for(const s of nodes){const r=s.getBoundingClientRect();if(r.width>35&&r.y>100&&r.bottom<innerHeight-80)return{x:r.left+3,end:r.right-3,y:r.y+r.height/2,text:s.textContent}}return null})()");assert(selection);result.selectionAnchor=selection;
  await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:selection.x,y:selection.y,button:'left',buttons:1,clickCount:1});await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:selection.end,y:selection.y,button:'left',buttons:1});await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:selection.end,y:selection.y,button:'left',buttons:0,clickCount:1});
  const selected=await app.evaluate('window.getSelection().toString()');assert(selected.trim().length>2);result.actualSelectedText=selected;
  const initialWidth=await app.evaluate("document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)').getBoundingClientRect().width");
  await app.click('[aria-label="PDF 缩放"]');await app.click('[role=menuitem]','150%');await app.waitFor("document.querySelector('.fw-pdf-zoom')?.textContent.includes('150%')");await ready();
  const zoomWidth=await app.evaluate("document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)').getBoundingClientRect().width");assert(zoomWidth>initialWidth);result.zoomGeometry={initialWidth,zoomWidth};
  await app.click('[aria-label="停靠缩略图"]');await app.click('button.fw-pdf-thumb-button[aria-label="第 3 页"]');await app.waitFor("document.querySelector('.fw-pdf-status')?.textContent.includes('第 3 / 3 页')");await app.waitFor("Boolean(document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)[data-page=\"3\"] canvas[data-rendered=true]'))");
  const before={page:await app.evaluate("document.querySelector('.fw-pdf-status').textContent"),zoom:await app.evaluate("document.querySelector('.fw-pdf-zoom').textContent"),selectedText:selected};result.navigation=before;await app.screenshot(join(scratch,'normal-before-close.png'));
  await close('normal.pdf');await markStage('normal-restore');await app.click('[aria-label="文件菜单"]');await app.click('[role=menuitem]','重新打开关闭的文件');await ready();

  await app.waitFor("document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)[data-page=\"3\"] .fw-pdf-text')?.textContent.includes('PAGE_THREE_MARKER')&&Boolean(document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)[data-page=\"3\"] canvas[data-rendered=true]'))");
  result.restored={page:await app.evaluate("document.querySelector('.fw-pdf-status').textContent"),zoom:await app.evaluate("document.querySelector('.fw-pdf-zoom').textContent")};
  result.restored.markerText=await app.evaluate("document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)[data-page=\"3\"] .fw-pdf-text').textContent");assert(result.restored.page.includes('第 3 / 3 页'),'Closed PDF page position was lost');assert(result.restored.zoom.includes('150%'),'Closed PDF zoom was lost');await app.screenshot(join(scratch,'normal-restored.png'));
  const scope={kind:'project',projectId:app.project.id};
  await app.waitFor(`window.electronAPI.invoke('files.workspaceSnapshot',${JSON.stringify(scope)}).then(s=>s.state?.routes.some(r=>r.relativePath==='normal.pdf'&&r.pdf?.page===3&&r.pdf?.zoom===150))`);
  result.persisted=(await app.invoke('files.workspaceSnapshot',scope)).state.routes.find(r=>r.relativePath==='normal.pdf');
  await markStage('normal-workspace-reload');await app.cdp('Page.reload');await app.waitFor(app.exists(`[data-project-id="${app.project.id}"]`));await app.click(`[data-project-id="${app.project.id}"] [data-testid=sidebar-project-more]`);await app.click('[data-testid=sidebar-project-edit]');await app.waitFor(app.exists('[data-testid=project-files]'));
  result.reloadedPanelInitiallyVisible=await app.evaluate("Boolean(document.querySelector('[data-testid=file-workspace]'))");
  if(!result.reloadedPanelInitiallyVisible)await app.click('[data-testid=project-files]');await ready();

  await app.waitFor("document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)[data-page=\"3\"] .fw-pdf-text')?.textContent.includes('PAGE_THREE_MARKER')&&Boolean(document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)[data-page=\"3\"] canvas[data-rendered=true]'))");
  result.reloaded={page:await app.evaluate("document.querySelector('.fw-pdf-status').textContent"),zoom:await app.evaluate("document.querySelector('.fw-pdf-zoom').textContent")};
  result.reloaded.markerText=await app.evaluate("document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)[data-page=\"3\"] .fw-pdf-text').textContent");assert(result.reloaded.page.includes('第 3 / 3 页'));assert(result.reloaded.zoom.includes('150%'));await app.screenshot(join(scratch,'normal-reloaded.png'));result.caseResults.F14='passed';
 }
 result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';
 result.boundary='Actual packaged PDF.js Worker over native revision-bound file bytes. Selection uses renderer native mouse; no clipboard. Missing fonts substitute on this Mac, not font-fidelity or signature/form-editing support. Download/native save, full P/R/V matrices and cross-platform results remain separate.';
 await persist();
}

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_FILES_APP,projectPath=process.env.SMARTDD_PDF_PROJECT;assert(executable&&projectPath);
const fixtureRoot=dirname(projectPath),scratch=await mkdtemp(join(fixtureRoot,'app-run-')),oracle=JSON.parse(await readFile(join(fixtureRoot,'fixtures.json'),'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(oracle.cases.map(async({name})=>{const s=await stat(join(projectPath,name),{bigint:true});return[name,{sha256:sha(await readFile(join(projectPath,name))),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources'),result={caseIds:['M9-T-F14','M9-T-F15'],at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),projectPath,before:await fingerprints(),checks:[],caseResults:{},status:'running'};let app,stage='initial';
const ready=()=>app.waitFor("Boolean(document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb) canvas[data-rendered=true]'))&&Boolean(document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb) .fw-pdf-text span'))",20000);
const close=async name=>{await app.click(`[aria-label=${JSON.stringify('关闭 '+name)}]`);await app.waitFor("!document.querySelector('.fw-pdf')")};
const password=async value=>{await app.click('input[aria-label="PDF 密码"]');await app.key('a','KeyA',4);await app.cdp('Input.insertText',{text:value});await app.click('.fw-pdf-password button','打开')};
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'PDF native viewer acceptance'});
 if(process.env.SMARTDD_PDF_CASE!=='F14'){
  for(const item of oracle.cases.filter(item=>item.kind!=='normal')){
   stage=item.name;await app.open(item.name);await app.waitFor("Boolean(document.querySelector('.fw-pdf'))");const check={file:item.name,kind:item.kind};result.currentCheck=check;
   if(item.kind==='invalid'){
    await app.waitFor("Boolean(document.querySelector('.fw-pdf [role=alert]'))",20000);check.error=await app.evaluate("document.querySelector('.fw-pdf [role=alert]').textContent");assert.match(check.error,/不是有效.*PDF|损坏|有效的 PDF/);assert(!check.error.includes('密码'));assert(await app.evaluate("Boolean(document.querySelector('.fw-pdf [role=alert] button'))"));
   }else{
    if(item.kind==='password'){
     await app.waitFor("Boolean(document.querySelector('.fw-pdf-password'))");assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf-text span'))"));check.missingPassword=true;
     await app.click('.fw-pdf-password button','取消');await app.waitFor("document.querySelector('.fw-pdf [role=alert]')?.textContent.includes('已取消输入密码')");assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf-password'))"));check.cancel=await app.evaluate("document.querySelector('.fw-pdf [role=alert]').textContent");
     await app.click('.fw-pdf [role=alert] button','重试');await app.waitFor("Boolean(document.querySelector('.fw-pdf-password'))");await password('m9-wrong-synthetic');await app.waitFor("document.querySelector('.fw-pdf-password')?.textContent.includes('密码错误')");assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf-text span'))"));check.wrongPassword=true;
     await password('m9-user');
    }
    await ready();check.render=await app.evaluate("(()=>{const p=document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)'),c=p.querySelector('canvas'),x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<d.length;i+=16)if(d[i]<100&&d[i+1]<100&&d[i+2]<100)dark++;return{canvas:[c.width,c.height],sampledDarkPixels:dark,text:p.querySelector('.fw-pdf-text').textContent,fonts:[...new Set([...p.querySelectorAll('.fw-pdf-text span')].map(s=>getComputedStyle(s).fontFamily))]}})()");
    assert(check.render.sampledDarkPixels>10);assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf-password'))"));
    if(item.kind==='cjk')assert(check.render.text.replace(/\s/g,'').includes('文件工作区中文测试'));
    if(item.kind==='missing-mixed'){assert(check.render.text.replace(/\s/g,'').includes(item.expectedText.replace(/\s/g,'')));assert(check.render.text.includes('MISSING_FONT Latin 12345'));check.fontBoundary=item.boundary}
    if(item.kind==='forms')assert(!await app.evaluate("Boolean(document.querySelector('.fw-pdf input,.fw-pdf textarea,.fw-pdf select'))"));
    if(item.kind==='scripts')assert.equal(await app.evaluate('window.PDF_EXECUTED??null'),null);
   }
   await app.screenshot(join(scratch,item.name+'.png'));await close(item.name);result.checks.push(check);delete result.currentCheck;
  }
  result.caseResults.F15='passed';
 }
 if(process.env.SMARTDD_PDF_CASE!=='F15'){
  stage='normal-navigation';await app.open('normal.pdf');await ready();await app.waitFor("document.querySelector('.fw-pdf-status')?.textContent.includes('/ 3 页')");
  const selection=await app.evaluate("(()=>{const nodes=[...document.querySelectorAll('.fw-pdf-page:not(.fw-pdf-thumb) .fw-pdf-text span')];for(const s of nodes){const r=s.getBoundingClientRect();if(r.width>35&&r.y>100&&r.bottom<innerHeight-80)return{x:r.left+3,end:r.right-3,y:r.y+r.height/2,text:s.textContent}}return null})()");assert(selection);
  await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:selection.x,y:selection.y,button:'left',buttons:1,clickCount:1});await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:selection.end,y:selection.y,button:'left',buttons:1});await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:selection.end,y:selection.y,button:'left',buttons:0,clickCount:1});
  const selected=await app.evaluate('window.getSelection().toString()');assert(selected.trim().length>2);
  const initialWidth=await app.evaluate("document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)').getBoundingClientRect().width");
  await app.click('[aria-label="PDF 缩放"]');await app.click('[role=menuitem]','150%');await app.waitFor("document.querySelector('.fw-pdf-zoom')?.textContent.includes('150%')");await ready();
  const zoomWidth=await app.evaluate("document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)').getBoundingClientRect().width");assert(zoomWidth>initialWidth);
  await app.click('[aria-label="停靠缩略图"]');await app.click('button.fw-pdf-thumb-button[aria-label="第 3 页"]');await app.waitFor("document.querySelector('.fw-pdf-status')?.textContent.includes('第 3 / 3 页')");await app.waitFor("Boolean(document.querySelector('.fw-pdf-page:not(.fw-pdf-thumb)[data-page=\"3\"] canvas[data-rendered=true]'))");
  const before={page:await app.evaluate("document.querySelector('.fw-pdf-status').textContent"),zoom:await app.evaluate("document.querySelector('.fw-pdf-zoom').textContent"),selectedText:selected};result.navigation=before;await app.screenshot(join(scratch,'normal-before-close.png'));
  await close('normal.pdf');stage='normal-restore';await app.click('[aria-label="文件菜单"]');await app.click('[role=menuitem]','重新打开关闭的文件');await ready();
  result.restored={page:await app.evaluate("document.querySelector('.fw-pdf-status').textContent"),zoom:await app.evaluate("document.querySelector('.fw-pdf-zoom').textContent")};
  assert(result.restored.page.includes('第 3 / 3 页'),'Closed PDF page position was lost');assert(result.restored.zoom.includes('150%'),'Closed PDF zoom was lost');await app.screenshot(join(scratch,'normal-restored.png'));result.caseResults.F14='passed';
 }
 result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';
 result.boundary='Actual packaged PDF.js Worker over native revision-bound file bytes. Selection uses renderer native mouse; no clipboard. Missing fonts substitute on this Mac, not font-fidelity or signature/form-editing support. Download/native save, full P/R/V matrices and cross-platform results remain separate.';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'))}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close()}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,caseResults:result.caseResults,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}

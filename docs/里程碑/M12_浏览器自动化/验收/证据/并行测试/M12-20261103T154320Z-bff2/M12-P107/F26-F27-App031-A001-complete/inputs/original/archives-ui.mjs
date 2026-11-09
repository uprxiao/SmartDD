import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,stat,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_FILES_APP,projectPath=process.env.SMARTDD_ARCHIVE_PROJECT;assert(executable&&projectPath);
const fixtureRoot=dirname(projectPath),scratch=await mkdtemp(join(fixtureRoot,'app-run-')),oracle=JSON.parse(await readFile(join(fixtureRoot,'fixtures.json'),'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(oracle.cases.map(async({name})=>{const p=join(projectPath,name),s=await stat(p,{bigint:true});return[name,{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources'),result={caseId:'M9-T-F26',at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),projectPath,before:await fingerprints(),checks:[],status:'running'};let app,stage='initial';
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'Archive container dispatch acceptance'});
 for(const item of oracle.cases){
  stage=item.name;
  // The real tree virtualizes rows. Scroll its actual viewport when a target
  // is outside the DOM instead of waiting for an unmounted row to appear.
  const selector=app.tree(item.name);let scrolls=0;
  for(const deltaY of [1000,-2000,1000]){
   if(await app.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))break;
   const point=await app.evaluate("(()=>{const r=document.querySelector('.fw-tree-scroll').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY});scrolls++;await pause(100);
  }
  await app.open(item.name);const check={file:item.name,kind:item.kind,actualTreeScrolls:scrolls};
  if(item.kind==='office'){
   await app.waitFor("Boolean(document.querySelector('.fw-office'))");await app.waitFor("Boolean(document.querySelector('.fw-office [role=alert]'))",20000);check.parserError=await app.evaluate("document.querySelector('.fw-office [role=alert]').textContent");assert(check.parserError.trim().length>0);assert(!await app.evaluate("Boolean(document.querySelector('.fw-unsupported'))"));check.artifactPrecedesArchive=true;
  }else{
   await app.waitFor(`document.querySelector('.fw-unsupported')?.textContent.includes(${JSON.stringify(item.kind==='archive'?'归档文件暂不提供内置预览':item.extension.toUpperCase())})`);check.message=await app.evaluate("document.querySelector('.fw-unsupported').textContent");assert(!await app.evaluate("Boolean(document.querySelector('.cm-editor,.fw-office'))"));
  }
  assert.equal(await app.evaluate('window.__archiveExecuted??null'),null);await app.screenshot(join(scratch,item.name+'.png'));result.checks.push(check);
 }
 result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual((await readdir(projectPath)).sort(),oracle.cases.map(c=>c.name).sort());await assert.rejects(()=>stat(join(fixtureRoot,'outside-must-not-write.txt')),error=>error.code==='ENOENT');assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';result.boundary='No generic archive extraction/integrity decoder is offered. Archive container classification is distinct from Office/ODF presentation, and invalid Office parse errors are separate from unsupported archive state. Not a claim of every archive CRC validation or Office document support.';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'))}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close()}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}

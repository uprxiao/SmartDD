import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
const executable=process.env.WILLYOU_FILES_APP,projectPath=process.env.SMARTDD_TEX_PROJECT;assert(executable&&projectPath);
const fixtureRoot=dirname(projectPath),scratch=await mkdtemp(join(fixtureRoot,'app-run-')),oracle=JSON.parse(await readFile(join(fixtureRoot,'fixtures.json'),'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(oracle.cases.map(async({name})=>{const s=await stat(join(projectPath,name),{bigint:true});return[name,{sha256:sha(await readFile(join(projectPath,name))),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources'),result={caseId:'M9-T-F16',at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),projectPath,before:await fingerprints(),checks:[],status:'running'};let app,stage='initial';
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'Offline TeX source and preview acceptance'});
 for(const item of oracle.cases){
  stage=item.name;await app.open(item.name);await app.waitFor("Boolean(document.querySelector('.cm-content'))");
  assert.equal((await app.evaluate("document.querySelector('.cm-content').textContent")).trim(),item.source.trim());assert(!await app.evaluate("Boolean(document.querySelector('.fw-tex'))"));
  await app.click('[aria-label="编译并查看 PDF"]');await app.waitFor("Boolean(document.querySelector('.fw-tex'))");const check={file:item.name,kind:item.kind,defaultSource:true};result.currentCheck=check;
  if(item.kind==='success'){
   await app.waitFor("document.querySelector('.fw-tex .fw-pdf-text')?.textContent.includes('TEXF16SUCCESS')&&Boolean(document.querySelector('.fw-tex canvas[data-rendered=true]'))",65000);
   check.pdfText=await app.evaluate("document.querySelector('.fw-tex .fw-pdf-text').textContent");check.canvas=await app.evaluate("(()=>{const c=document.querySelector('.fw-tex canvas');return[c.width,c.height]})()");assert(check.canvas.every(v=>v>0));
  }else{
   await app.waitFor("Boolean(document.querySelector('.fw-tex [role=alert]'))",65000);check.error=await app.evaluate("document.querySelector('.fw-tex-error').textContent");
   assert.match(check.error,item.kind==='failure'?/willyoumissingpackagef16/:/PDF|没有.*页|未生成/);assert(!await app.evaluate("Boolean(document.querySelector('.fw-tex .fw-pdf'))"));assert(await app.evaluate("Boolean([...document.querySelectorAll('.fw-tex button')].find(b=>b.textContent==='重新编译'))"));
  }
  await app.screenshot(join(scratch,item.name+'.png'));await app.click('[aria-label="查看源码"]');await app.waitFor("Boolean(document.querySelector('.cm-content'))");assert.equal((await app.evaluate("document.querySelector('.cm-content').textContent")).trim(),item.source.trim());check.exactSourceRoundTrip=true;
  await app.click(`[aria-label=${JSON.stringify('关闭 '+item.name)}]`);await app.waitFor("!document.querySelector('.fw-tex')&&!document.querySelector('.cm-content')");result.checks.push(check);delete result.currentCheck;
 }
 assert.notEqual(result.checks[1].error,result.checks[2].error);result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual((await readdir(projectPath)).sort(),oracle.cases.map(c=>c.name).sort());assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';
 result.boundary='Actual offline engine/PDF.js in packaged App; ordinary TeX opens as source, explicit compile success/error/no-pages preserve source and expose no arbitrary shell. Missing-provider rejection is independently tested at native I; this package has the fixed provider. Not native save, all TeX packages, full TeX resource/timeout or cross-platform acceptance.';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'))}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close()}if(result.status==='passed'){try{result.privateJobEntries=await readdir(join(scratch,'userdata/m9-tex-jobs'))}catch(error){if(error.code==='ENOENT')result.privateJobEntries=[];else throw error}if(result.privateJobEntries.length){result.status='failed';result.error='Private compiler job directory retained entries';process.exitCode=1}}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}

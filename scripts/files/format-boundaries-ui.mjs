import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {formatBoundaryFixtures} from './format-boundary-fixtures.mjs';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-format-boundary-ui-'),projectPath=join(scratch,'project'),generated=formatBoundaryFixtures();await mkdir(projectPath);
for(const[name,bytes]of Object.entries(generated.files))await writeFile(join(projectPath,name),bytes);
await writeFile(join(scratch,'fixtures.json'),JSON.stringify({cases:generated.cases},null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(generated.cases.map(async({name})=>{const path=join(projectPath,name),s=await stat(path,{bigint:true});return[name,{sha256:sha(await readFile(path)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources'),result={at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),scratch,projectPath,before:await fingerprints(),checks:[],status:'running'};
let app,stage='initial';
try{
  app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'Format boundary acceptance'});
  for(const item of generated.cases){
    stage=item.name;await app.open(item.name);const observation={caseId:item.caseId,file:item.name,expectedKind:item.kind};
    if(item.kind==='image'){
      if(item.decodeFailure){await app.waitFor("document.querySelector('.fw-ordinary-image [role=alert]')?.textContent.includes('无法解码此图像文件')");observation.explicitDecodeFailure=true;}
      else{await app.waitFor(`document.querySelector('.fw-ordinary-image img')?.naturalWidth===${item.width}`);assert.equal(await app.evaluate("document.querySelector('.fw-ordinary-image img')?.naturalHeight"),item.height);observation.decodedSize=[item.width,item.height];}
      assert.equal(await app.evaluate("Boolean(document.querySelector('.cm-editor'))"),false);
      if(item.sourceFallback){await app.click('[aria-label="查看源码"]');await app.waitFor("document.querySelector('.cm-content')?.textContent.includes('Plain text, not a vector image. 中文🙂')");observation.explicitSourceFallbackExact=true;await app.click('[aria-label="查看图像"]');await app.waitFor("Boolean(document.querySelector('.fw-ordinary-image [role=alert]'))");}
    }else if(item.kind==='text'){
      await app.waitFor("document.querySelector('.cm-content')?.textContent.includes('<svg')");assert.equal(await app.evaluate("Boolean(document.querySelector('.fw-ordinary-image'))"),false);observation.textFallback=true;
    }else{
      await app.waitFor(`document.querySelector('.fw-unsupported')?.textContent.includes(${JSON.stringify(item.reason)})`);assert.equal(await app.evaluate("Boolean(document.querySelector('.cm-editor,.fw-ordinary-image,.fa-office'))"),false);
      observation.message=await app.evaluate("document.querySelector('.fw-unsupported').textContent");
      await app.click('[aria-label="打开方式"]');await app.waitFor("Boolean(document.querySelector('[role=menu]'))");
      await app.waitFor("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.includes('未找到可打开')||e.textContent.includes('重新读取应用列表'))||Boolean(document.querySelector('.fw-menu-checkbox'))");
      observation.openWithChoices=await app.evaluate("[...document.querySelectorAll('[role=menuitem]')].map(e=>({text:e.textContent,disabled:e.getAttribute('aria-disabled')==='true'}))");
      assert(!observation.openWithChoices.some(c=>c.text.includes('重新读取应用列表')),'Native application discovery failed');
      await app.key('Escape','Escape');await app.waitFor("!document.querySelector('[role=menu]')");
      await app.click('[aria-label="文件菜单"]');await app.waitFor("Boolean(document.querySelector('[role=menu]'))");
      assert(await app.evaluate("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.includes('另存副本')&&e.getAttribute('aria-disabled')!=='true')"));
      await app.key('Escape','Escape');await app.waitFor("!document.querySelector('[role=menu]')");observation.saveCopyEntry=true;
    }
    await app.screenshot(join(scratch,item.name+'.png'));result.checks.push(observation);
  }
  result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';
  result.boundary='Actual packaged renderer dispatch/decoding/fallback and native application discovery UI. No unsupported Office/TIFF decoder is claimed, no external App launched. Native controlled-copy bytes and application grant rejection checked separately in I.';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}

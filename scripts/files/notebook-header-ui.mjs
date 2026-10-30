import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {notebookHeaderFixtures} from './notebook-header-fixtures.mjs';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';

const executable=process.env.WILLYOU_FILES_APP; assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-notebook-header-ui-'),projectPath=join(scratch,'project');
await mkdir(projectPath);const fixtures=notebookHeaderFixtures();
for(const [name,source] of Object.entries(fixtures))await writeFile(join(projectPath,name),source);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(Object.keys(fixtures).map(async name=>{const p=join(projectPath,name),s=await stat(p,{bigint:true});return[name,{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources');
const result={caseId:'M9-T-T32',at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),scratch,projectPath,before:await fingerprints(),checks:[],status:'running'};
let app,stage='initial';
try{
  app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'Notebook header acceptance'});
  for(const [name,source] of Object.entries(fixtures)){
    stage=name;await app.open(name);
    const title=JSON.parse(source).metadata.title??name.replace(/\.ipynb$/i,'');
    await app.waitFor(`document.querySelector('.fw-artifact-tools strong')?.textContent===${JSON.stringify(title)}&&document.querySelectorAll('.fa-notebook-cell').length===4`);
    const header=await app.evaluate(`(()=>{const root=document.querySelector('.fa-notebook');return{title:root.querySelector('.fw-artifact-tools strong').textContent,count:root.querySelector('.fw-artifact-tools small').textContent,actions:[...root.querySelectorAll('.fw-artifact-tools button')].map(e=>({label:e.getAttribute('aria-label'),disabled:e.disabled})),cells:[...root.querySelectorAll('.fa-notebook-cell>summary')].map(e=>({title:e.querySelector('span[title]').title,ordinal:e.querySelector('small').textContent,run:e.querySelector('.fa-notebook-execution small')?.textContent??null,runElement:e.querySelector('.fw-notebook-run')?.tagName??null,runInteractive:Boolean(e.querySelector('button,a,[role=button]'))}))}})()`);
    assert.equal(header.count,'4 个单元');assert.deepEqual(header.cells.map(c=>c.ordinal),['Cell 1 of 4','Cell 2 of 4','Cell 3 of 4','Cell 4 of 4']);
    assert.deepEqual(header.cells.map(c=>c.title),['代码标题 中文🙂','说明标题','Markdown 标题','Raw cell 4']);
    assert.deepEqual(header.cells.map(c=>c.run),['Run 0','Run 7',null,null]);assert(header.cells.every(c=>!c.runInteractive));
    await app.screenshot(join(scratch,name+'.png'));
    result.checks.push({file:name,header});
    assert.deepEqual(header.actions,[{label:'下载 Notebook',disabled:false}],'Ordinary Notebook must expose the approved download action');
  }
  assert.deepEqual(await fingerprints(),result.before);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);
  result.status='passed-header';result.boundary='Header, titles, ordinals, disabled run affordance and download entry verified; native save destination/cancellation and byte comparison are separate.';
  if(process.env.WILLYOU_NOTEBOOK_NATIVE_SAVE==='1'){
    await app.click('[aria-label="下载 Notebook"]');result.status='awaiting-native-save';
    await writeFile(join(scratch,'ready.json'),JSON.stringify({scratch,projectPath,source:join(projectPath,'filename-fallback.ipynb'),destination:join(projectPath,'filename-fallback 副本.ipynb'),app:executable})+'\n');
    console.log(JSON.stringify({status:result.status,artifacts:scratch}));
    const limit=Date.now()+180000;
    while(Date.now()<limit){
      try{const copy=await readFile(join(projectPath,'filename-fallback 副本.ipynb'));assert.equal(sha(copy),result.before['filename-fallback.ipynb'].sha256);result.copy={sha256:sha(copy),exactOriginalBytes:true};result.status='passed';break;}catch(error){if(error.code!=='ENOENT')throw error;}
      await new Promise(r=>setTimeout(r,200));
    }
    if(result.status!=='passed')result.status='native-save-deferred';
  }
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}

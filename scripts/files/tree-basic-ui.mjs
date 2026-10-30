// Actual packaged UI completion of B01/B04/B05/B18. Synthetic fixture bytes
// stay untouched. Project creation is setup; every tested action uses input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openElectron, pause } from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP, manifestPath=process.env.SMARTDD_TREE_FIXTURES;
assert(executable&&manifestPath,'Set WILLYOU_FILES_APP and SMARTDD_TREE_FIXTURES');
const manifest=JSON.parse(await readFile(manifestPath,'utf8')), root=manifest.root;
const scratch=await mkdtemp('/private/tmp/willyou-tree-basic-ui-');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(manifest.files.map(async file=>{
  const path=join(root,file.relativePath), s=await stat(path,{bigint:true});
  return [file.relativePath,{sha256:sha(await readFile(path)),size:String(s.size),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}];
})));
const before=await fingerprints();for(const file of manifest.files)assert.equal(before[file.relativePath].sha256,file.sha256);
const resources=resolve(dirname(executable),'../Resources');
const result={startedAt:new Date().toISOString(),app:resolve(executable),asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),system:{platform:process.platform,arch:arch(),release:release()},fixtureManifest:resolve(manifestPath),root,scratch,before,checks:[],status:'running',input:'Actual packaged Electron renderer CDP pointer events, including a first-double-click sequence; no DOM .click() or store/API replacement.'};
let app;
try{
  app=await openElectron({executable,userData:join(scratch,'userdata')});
  const {evaluate,cdp,invoke,waitFor}=app;
  const tree=path=>`[role="treeitem"][title=${JSON.stringify(join(root,path))}]`;
  const exists=selector=>`Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  const expanded=path=>`document.querySelector(${JSON.stringify(tree(path))})?.getAttribute('aria-expanded')`;
  const point=async selector=>{
    let value;const deadline=Date.now()+10000;
    while(!value){value=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);if(!value){assert(Date.now()<deadline,`Missing UI target ${selector}`);await pause(80);}}
    return value;
  };
  const click=async(selector,double=false)=>{
    const position=await point(selector);await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...position});
    for(const count of double?[1,2]:[1]){
      await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:count,...position});
      await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:count,...position});
      if(double&&count===1)await pause(40);
    }
  };
  const project=await invoke('projects.create',{name:'M9 tree basic acceptance',aliases:[],description:'Read-only D02 acceptance fixture',rulesPath:null},[{label:'D02 synthetic tree',path:root}]);result.projectId=project.id;
  await cdp('Page.reload');await waitFor(exists(`[data-project-id="${project.id}"]`));
  await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);await click('[data-testid=sidebar-project-edit]');await waitFor(exists('[data-testid=project-files]'));await click('[data-testid=project-files]');await waitFor(exists(tree('level1')));
  assert(!await evaluate(exists(tree('level1/level2'))));assert.equal(await evaluate(expanded('level1')),'false');
  await click(tree('level1'));await waitFor(exists(tree('level1/level2')));assert(!await evaluate(exists(tree('level1/level2/level3'))));
  await click(tree('level1/level2'));await waitFor(exists(tree('level1/level2/level3')));assert(!await evaluate(exists(tree('level1/level2/level3/level4'))));
  await click(tree('level1'));await waitFor(`!${exists(tree('level1/level2'))}`);await click(tree('level1'));await waitFor(exists(tree('level1/level2/level3')));
  await app.screenshot(join(scratch,'b01-lazy-levels.png'));
  result.checks.push({caseId:'M9-T-B01',initialRootOnly:true,firstExpandShowsOnlyLevel2:true,secondExpandShowsOnlyLevel3:true,collapseAndReexpandKeepsNestedExpansion:true,level4Absent:true,requestAccounting:'Exact root/level1/level2 requests and pending/cache deduplication are verified by current production native integration, not inferred from DOM.'});
  await click(tree('level1'));
  for(const path of ['.env','.gitignore','.hidden','node_modules'])await waitFor(exists(tree(path)));
  for(const path of ['.hidden','node_modules']){await click(tree(path));await waitFor(exists(tree(path+'/x')));}
  await app.screenshot(join(scratch,'b04-hidden-and-dependencies.png'));
  result.checks.push({caseId:'M9-T-B04',visible:['.env','.gitignore','.hidden/x','node_modules/x'],filter:'ordinary tree, filename filter empty and changes-only disabled'});
  for(const path of ['.hidden','node_modules'])await click(tree(path));
  // Collapsing updates the watched directory membership and may trigger a
  // short root rescan. Count the known collapsed fixture only after it returns.
  await waitFor("document.querySelectorAll('[role=treeitem]').length===8 && !document.querySelector('.fw-tree-status.loading')");
  const items=8;await click(tree('empty'));
  await waitFor("[...document.querySelectorAll('.fw-tree-status')].some(e=>e.textContent==='空目录')");assert.equal(await evaluate(expanded('empty')),'true');
  assert.equal(await evaluate("document.querySelectorAll('[role=treeitem]').length"),items);assert(!await evaluate("[...document.querySelectorAll('.fw-tree-status')].some(e=>e.textContent.includes('正在读取'))"));
  await app.screenshot(join(scratch,'b05-empty-directory.png'));await click(tree('empty'));await waitFor(`${expanded('empty')}==='false'`);assert(!await evaluate("[...document.querySelectorAll('.fw-tree-status')].some(e=>e.textContent==='空目录')"));
  result.checks.push({caseId:'M9-T-B05',explicitEmpty:true,fakeFileRows:0,spinnerAfterReady:false,collapsible:true});
  await click(tree('A.txt'));await waitFor("document.querySelector('.cm-content')?.textContent.includes('Tree A baseline')");assert(await evaluate(exists('.fw-tab.selected.preview')));
  await evaluate("(()=>{window.__basicInputs=[];for(const type of ['pointerdown','pointerup','click','dblclick'])document.addEventListener(type,e=>window.__basicInputs.push({type,detail:e.detail,title:e.target.closest('[role=treeitem]')?.title,tag:e.target.tagName,at:performance.now()}),true);return true})()");await click(tree('B.txt'),true);await waitFor("document.querySelector('.cm-content')?.textContent.includes('Tree B baseline')");await waitFor(exists('.fw-tab.selected:not(.preview)'));assert(await evaluate(exists('.fw-tab.selected:not(.preview)')));
  let tabs=await evaluate("[...document.querySelectorAll('.fw-tab [role=tab]')].map(e=>({title:e.title,selected:e.getAttribute('aria-selected')}))");assert.equal(tabs.length,1);assert.equal(tabs[0].title,join(root,'B.txt'));
  await click(tree('empty'));await waitFor(`${expanded('empty')}==='true'`);await click(tree('empty'));await waitFor(`${expanded('empty')}==='false'`);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.fw-tab [role=tab]')].map(e=>({title:e.title,selected:e.getAttribute('aria-selected')}))"),tabs);assert(await evaluate("document.querySelector('.cm-content')?.textContent.includes('Tree B baseline')"));
  await app.screenshot(join(scratch,'b18-first-double-click.png'));
  result.checks.push({caseId:'M9-T-B18',firstSingleAPreview:true,firstDoubleBPinned:true,tabs,directoryTogglePreservesB:true});
  result.inputEvents=await evaluate('window.__basicInputs');assert.deepEqual(app.rendererErrors,[]);result.after=await fingerprints();assert.deepEqual(result.after,before);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;if(app){try{await app.screenshot(join(scratch,'failure.png'));result.failureInputs=await app.evaluate('window.__basicInputs');result.failureDom=await app.evaluate('document.body.innerText');}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,error:result.error,artifacts:scratch}));}

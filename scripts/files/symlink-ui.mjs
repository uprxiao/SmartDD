// B20 actual packaged UI: permitted contained aliases; rejected escapes/cycles.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openElectron, pause } from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable,'Set WILLYOU_FILES_APP');
const scratch=await mkdtemp('/private/tmp/willyou-symlink-ui-'),projectPath=join(scratch,'project');await mkdir(projectPath);await mkdir(join(projectPath,'inner'));await mkdir(join(scratch,'outside'));
await writeFile(join(projectPath,'inner/child.txt'),'contained symbolic target');await writeFile(join(scratch,'outside/secret.txt'),'outside sentinel must stay inaccessible');
for(const [path,target]of Object.entries({'link-dir':'inner','link-file.txt':'inner/child.txt','outside-dir':'../outside','outside-file.txt':'../outside/secret.txt','loop-a':'loop-b','loop-b':'loop-a'}))await symlink(target,join(projectPath,path));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprint=async path=>{const s=await stat(path,{bigint:true});return{hash:sha(await readFile(path)),inode:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)};};
const resources=resolve(dirname(executable),'../Resources'),before={inside:await fingerprint(join(projectPath,'inner/child.txt')),outside:await fingerprint(join(scratch,'outside/secret.txt'))};
const result={caseId:'M9-T-B20',startedAt:new Date().toISOString(),app:resolve(executable),asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),system:{platform:process.platform,arch:arch(),release:release()},scratch,projectPath,before,status:'running',checks:[],input:'Real packaged renderer pointer input, public IPC project setup only.'};let app;
try{
  app=await openElectron({executable,userData:join(scratch,'userdata')});const{evaluate,cdp,invoke,waitFor}=app;
  const tree=path=>`[role="treeitem"][title=${JSON.stringify(join(projectPath,path))}]`,exists=selector=>`Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  const click=async(selector,name)=>{let point;const deadline=Date.now()+10000;while(!point){point=await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${name===undefined?'true':`e.textContent.trim()===${JSON.stringify(name)}`});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);if(!point){assert(Date.now()<deadline,`Missing UI target ${selector}`);await pause(80);}}await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
  const project=await invoke('projects.create',{name:'M9 contained symlink acceptance',aliases:[],description:'Isolated contained/outside/cyclic D03 links',rulesPath:null},[{label:'D03 synthetic links',path:projectPath}]);result.projectId=project.id;
  await cdp('Page.reload');await waitFor(exists(`[data-project-id="${project.id}"]`));await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);await click('[data-testid=sidebar-project-edit]');await waitFor(exists('[data-testid=project-files]'));await click('[data-testid=project-files]');await waitFor("document.querySelectorAll('[role=treeitem]').length===7");
  const rejected=[];
  for(const name of ['outside-dir','outside-file.txt','loop-a','loop-b']){
    const item=await evaluate(`(()=>{const e=[...document.querySelectorAll('[role=treeitem]')].find(e=>e.textContent.trim()===${JSON.stringify(name)});return e?{name:e.textContent.trim(),disabled:e.disabled,reason:e.title}:null})()`);
    assert(item&&item.disabled&&item.reason);await click('[role=treeitem]',name);assert.equal(await evaluate("document.querySelectorAll('.fw-tab').length"),0);rejected.push(item);
  }
  await app.screenshot(join(scratch,'b20-outside-and-cycles-disabled.png'));result.checks.push({branch:'outside directory/file and cyclic aliases',rejected,clicksOpenNoFile:true,unboundedExpansion:false});
  await click(tree('link-file.txt'));await waitFor("document.querySelector('.cm-content')?.textContent==='contained symbolic target'");
  await click(tree('link-dir'));await waitFor(exists(tree('inner/child.txt')));await click(tree('inner/child.txt'));await waitFor("document.querySelector('.cm-content')?.textContent==='contained symbolic target'");
  assert.equal(await evaluate("document.querySelectorAll('.fw-tab').length"),1);await app.screenshot(join(scratch,'b20-contained-directory-and-file.png'));
  result.checks.push({branch:'contained directory/file aliases',directoryChildCanonicalPath:join(projectPath,'inner/child.txt'),correctText:true,sharedOpenBufferTabs:1});
  result.after={inside:await fingerprint(join(projectPath,'inner/child.txt')),outside:await fingerprint(join(scratch,'outside/secret.txt'))};assert.deepEqual(result.after,before);assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;if(app){try{await app.screenshot(join(scratch,'failure.png'));result.failureDom=await app.evaluate('document.body.innerText');}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,error:result.error,artifacts:scratch}));}

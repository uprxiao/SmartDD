// L18: actual packaged App, original file renamed and old pathname recreated.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openElectron, pause } from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable,'Set WILLYOU_FILES_APP');
const scratch=await mkdtemp('/private/tmp/willyou-rename-identity-ui-'),projectPath=join(scratch,'project');await mkdir(projectPath);
for(const name of ['clean','dirty']){await mkdir(join(projectPath,name));await writeFile(join(projectPath,name,'a.txt'),`original ${name} a`);}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const disk=async path=>{const s=await stat(path,{bigint:true}),bytes=await readFile(path);return{text:bytes.toString(),hash:sha(bytes),device:String(s.dev),inode:String(s.ino)};};
const resources=resolve(dirname(executable),'../Resources');
const result={caseId:'M9-T-L18',defect:'M9-DEV-060',startedAt:new Date().toISOString(),app:resolve(executable),asarSha256:sha(await readFile(join(resources,'app.asar'))),brokerSha256:sha(await readFile(join(resources,'native/willyou-files'))),system:{platform:process.platform,arch:arch(),release:release()},scratch,projectPath,status:'running',checks:[],input:'Real packaged renderer CDP pointer/keyboard input. Public IPC only seeds the isolated project; independent CLI performs the rename/recreate.'};
let app;
try{
  app=await openElectron({executable,userData:join(scratch,'userdata')});const{evaluate,cdp,invoke,waitFor}=app;
  const exists=selector=>`Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  const tree=path=>`[role="treeitem"][title=${JSON.stringify(join(projectPath,path))}]`;
  const click=async selector=>{let point;const deadline=Date.now()+10000;while(!point){point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);if(!point){assert(Date.now()<deadline,`Missing UI target ${selector}`);await pause(80);}}await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
  const key=async(key,code,modifiers=0)=>{await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
  const project=await invoke('projects.create',{name:'M9 rename identity acceptance',aliases:[],description:'Isolated original/renamed/new-name fixtures',rulesPath:null},[{label:'Temporary file identities',path:projectPath}]);result.projectId=project.id;
  await cdp('Page.reload');await waitFor(exists(`[data-project-id="${project.id}"]`));await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);await click('[data-testid=sidebar-project-edit]');await waitFor(exists('[data-testid=project-files]'));await click('[data-testid=project-files]');
  for(const name of ['clean','dirty']){
    await click(tree(name));await click(tree(`${name}/a.txt`));await waitFor(`document.querySelector('.cm-content')?.textContent.includes(${JSON.stringify(`original ${name} a`)})`);
    const path=join(projectPath,name,'a.txt'),moved=join(projectPath,name,'b.txt'),original=await disk(path),local=name==='dirty'?'manual draft for renamed original':original.text;
    if(name==='dirty'){await click('.cm-content');await key('a','KeyA',4);await cdp('Input.insertText',{text:local});await waitFor(exists('.fw-tab.selected .fw-dirty'));await pause(650);}
    execFileSync(process.execPath,['-e',"const f=require('node:fs'),[a,b,text]=process.argv.slice(1);f.renameSync(a,b);f.writeFileSync(a,text);",path,moved,original.text],{env:{PATH:'/usr/bin:/bin'},timeout:5000});
    const replacement=await disk(path);assert.notEqual(replacement.inode,original.inode);assert.deepEqual(await disk(moved),original);
    await waitFor("document.querySelector('.fw-save-strip')?.textContent.includes('另一文件')");
    assert(await evaluate(`document.querySelector('.cm-content')?.textContent===${JSON.stringify(local)}`));
    if(name==='dirty'){
      await click('.cm-content');await key('s','KeyS',4);await pause(3200);
      assert(await evaluate(exists('.fw-tab.selected .fw-dirty')));assert(await evaluate(`document.querySelector('.cm-content')?.textContent===${JSON.stringify(local)}`));
    }
    assert.deepEqual(await disk(path),replacement);assert.deepEqual(await disk(moved),original);
    await app.screenshot(join(scratch,`l18-${name}-identity-protected.png`));
    result.checks.push({kind:name,original,replacement,moved:await disk(moved),after:await disk(path),localText:local,missingPolicyVisible:true,explicitAndAutosavePreserveNewFile:true});
  }
  assert.deepEqual(app.rendererErrors,[]);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;if(app){try{await app.screenshot(join(scratch,'failure.png'));result.failureDom=await app.evaluate('document.body.innerText');}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,error:result.error,artifacts:scratch}));}

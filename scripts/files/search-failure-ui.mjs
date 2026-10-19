import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod,copyFile,mkdir,mkdtemp,readFile,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';

const executable=process.env.WILLYOU_FILES_APP;assert(executable);
const scratch=await mkdtemp('/private/tmp/willyou-search-failure-app-');
const root=join(scratch,'project'),gates=join(scratch,'gates');await mkdir(root);await mkdir(gates);
const source=new Map([['sentinel.txt','SENTINEL stable document\n'],['victim-delete.txt','DELETE target original\n'],['victim-rename.txt','RENAME target original\n'],['TimeoutMatch.txt','TIMEOUT recovery original\n']]);
for(const[p,text]of source)await writeFile(join(root,p),text);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprint=async p=>{const s=await stat(p);return{sha256:sha(await readFile(p)),ino:s.ino,size:s.size,mtimeMs:s.mtimeMs}};
const before=Object.fromEntries(await Promise.all([...source.keys()].map(async p=>[p,await fingerprint(join(root,p))])));
const result={at:new Date().toISOString(),scratch,root,checks:[],before,boundary:'C15 uses unchanged packaged App/native. C12 uses COW App with identical ASAR and transparent broker wrapper; only one genuine walk success is withheld to exercise unchanged 15s main timeout. Permissions are real chmod on this synthetic root. No daily data, terminal tasks, clipboard or model.'};
let app,stage='initial';
const ev=(fn,...args)=>app.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const wait=async(fn,...args)=>{const end=Date.now()+23000;for(;;){if(await ev(fn,...args))return;if(Date.now()>end)throw Error('Timed out at '+stage);await pause(35)}};
const field=async text=>{await app.click('[aria-label="筛选文件"]');await wait(()=>document.activeElement?.getAttribute('aria-label')==='筛选文件');await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4});await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});if(text)await app.cdp('Input.insertText',{text});await wait(text=>document.querySelector('[aria-label="筛选文件"]')?.value===text,text)};
const paths=()=>ev(()=>[...document.querySelectorAll('.fw-name-results [role=option]')].map(e=>e.title));
const doc=()=>ev(()=>document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()??null);
const begin=async(exe,tag)=>{
 app=await openFileAcceptanceApp({executable:exe,projectPath:root,userData:join(scratch,'userdata-'+tag),name:'M9 search failures '+tag});
 await app.cdp('Page.bringToFront');await wait(selector=>!!document.querySelector(selector),app.tree('sentinel.txt'));
 await wait(()=>!!document.querySelector('[aria-label="筛选文件"]'));
};
const finish=async tag=>{assert.deepEqual(app.rendererErrors,[]);await writeFile(join(scratch,tag+'-electron.log'),app.logs());await app.close();app=null};
try{
 stage='normal-app';await begin(executable,'normal');
 // A pinned unrelated document proves that a stale search cannot silently
 // replace the selected target with its neighbor or a previous editor buffer.
 await app.open('sentinel.txt');await wait(()=>!!document.querySelector('.cm-content'));
 await app.click('.fw-tab [role=tab][aria-selected=true]');
 // Pin through the actual tab double click (two consecutive real clicks).
 const p=await ev(()=>{const r=document.querySelector('.fw-tab [role=tab][aria-selected=true]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}});
 await app.cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:2,...p});await app.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:2,...p});
 for(const action of ['delete','rename']){
  stage='C15-'+action;const name='victim-'+action+'.txt';await field('victim');
  await wait(want=>[...document.querySelectorAll('.fw-name-results [role=option]')].some(e=>e.title===want),join(root,name));
  const want=join(root,name);let selected;
  for(let n=0;n<5;n++){selected=await ev(()=>document.querySelector('.fw-name-results [aria-selected=true]')?.title);if(selected===want)break;await app.key('ArrowDown','ArrowDown')}
  assert.equal(selected,want);const listed=await paths();
  if(action==='delete')await unlink(want);else await rename(want,join(root,'renamed.txt'));
  assert.equal(await ev(()=>document.querySelector('.fw-name-results [aria-selected=true]')?.title),want);
  await app.key('Enter','Enter');await wait(want=>document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.title===want&&!!document.querySelector('.fw-content [role=alert]'),want);
  const error=await ev(()=>document.querySelector('.fw-content [role=alert]').textContent);assert.match(error,/MISSING|不存在|文件已被删除|找不到/);
  assert.equal(await doc(),null);assert.equal(await ev(()=>!!document.querySelector(`.fw-tab [title$="sentinel.txt"]`)),true);
  await app.screenshot(join(scratch,'C15-'+action+'.png'));result.checks.push({caseId:'M9-T-C15',action,selected,want,listed,error,editor:null});
 }
 stage='C15-rename-recovery';await field('renamed');await wait(()=>document.querySelectorAll('.fw-name-results [role=option]').length===1);await app.key('Enter','Enter');await wait(()=>document.querySelector('.cm-content')?.cmTile?.root?.view?.state.doc.toString()==='RENAME target original\n');
 result.checks.push({caseId:'M9-T-C15',action:'renamed-path-recovery',text:await doc()});await finish('normal');
 stage='fault-copy';const bundle=resolve(executable,'../../..'),clone=join(scratch,'Timeout WillYou.app');const copied=spawnSync('/bin/cp',['-cR',bundle,clone],{encoding:'utf8'});assert.equal(copied.status,0,copied.stderr);
 const broker=join(clone,'Contents/Resources/native/willyou-files'),originalBroker=join(bundle,'Contents/Resources/native/willyou-files');
 await copyFile(fileURLToPath(new URL('./search-timeout-broker.py',import.meta.url)),broker);await chmod(broker,0o755);
 await writeFile(broker+'.json',JSON.stringify({root,gates,nativeBroker:originalBroker,log:join(scratch,'native.jsonl')}));
 result.faultCopy={bundle,clone,asarSha256:sha(await readFile(join(clone,'Contents/Resources/app.asar'))),originalAsarSha256:sha(await readFile(join(bundle,'Contents/Resources/app.asar'))),originalBrokerSha256:sha(await readFile(originalBroker)),wrapperSha256:sha(await readFile(broker))};assert.equal(result.faultCopy.asarSha256,result.faultCopy.originalAsarSha256);
 await begin(join(clone,'Contents/MacOS/WillYou'),'fault');
 stage='C12-empty';await field('NO_MATCH_xyz_987');await wait(()=>document.querySelector('.fw-name-results')?.textContent==='没有匹配文件');assert.equal(await ev(()=>!!document.querySelector('.fw-name-results [role=alert]')),false);
 result.checks.push({caseId:'M9-T-C12',state:'empty',text:await ev(()=>document.querySelector('.fw-name-results').textContent)});await app.screenshot(join(scratch,'C12-empty.png'));
 stage='C12-permission';await chmod(root,0o000);await field('TimeoutMatch');await wait(()=>!!document.querySelector('.fw-name-results [role=alert]'));
 const permission=await ev(()=>document.querySelector('.fw-name-results [role=alert]').textContent);assert.match(permission,/PERMISSION|权限|Permission denied/);assert(!permission.includes('没有匹配文件'));await app.screenshot(join(scratch,'C12-permission.png'));
 await chmod(root,0o755);await app.click('.fw-name-results [role=alert] button');await wait(()=>document.querySelector('.fw-name-results [role=option]')?.title.endsWith('/TimeoutMatch.txt'));
 result.checks.push({caseId:'M9-T-C12',state:'permission-and-retry',error:permission,paths:await paths()});
 stage='C12-timeout';await field('');await writeFile(join(gates,'timeout.arm'),'armed');const started=Date.now();await field('Timeout');await wait(()=>!!document.querySelector('.fw-name-results [role=alert]'));
 const timeout=await ev(()=>document.querySelector('.fw-name-results [role=alert]').textContent),elapsedMs=Date.now()-started;assert.match(timeout,/TIMEOUT|超时/);assert.notEqual(timeout,permission);assert(!timeout.includes('没有匹配文件'));
 const native=String(await readFile(join(scratch,'native.jsonl'))).trim().split('\n').map(JSON.parse),waiting=native.find(n=>n.event==='waiting'),cancelled=native.find(n=>n.event==='cancelled'&&n.held);assert(waiting&&cancelled);assert.equal(waiting.nativeExit,0);assert.equal(waiting.outputSha256,sha(await readFile(join(gates,'timeout.native-output.jsonl'))));assert(!native.some(n=>n.event==='delivered'&&n.held));
 await app.screenshot(join(scratch,'C12-timeout.png'));await app.click('.fw-name-results [role=alert] button');await wait(()=>document.querySelector('.fw-name-results [role=option]')?.title.endsWith('/TimeoutMatch.txt'));
 result.checks.push({caseId:'M9-T-C12',state:'timeout-and-retry',error:timeout,elapsedMs,waiting,cancelled,paths:await paths()});
 await finish('fault');result.after={sentinel:await fingerprint(join(root,'sentinel.txt')),timeout:await fingerprint(join(root,'TimeoutMatch.txt')),renamed:await fingerprint(join(root,'renamed.txt'))};assert.deepEqual(result.after.sentinel,before['sentinel.txt']);assert.deepEqual(result.after.timeout,before['TimeoutMatch.txt']);assert.deepEqual(result.after.renamed,before['victim-rename.txt']);
 result.status='passed';
}catch(error){result.status='failed';result.failedStage=stage;result.error=String(error);process.exitCode=1;if(app)try{result.dom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'))}catch{}}
finally{await chmod(root,0o755);if(app){await writeFile(join(scratch,'failure-electron.log'),app.logs());await app.close()}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}))}

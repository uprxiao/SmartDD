// Run only after the user's explicit approval and public clipboard preparation.
// The environment guard is an accident guard, never authorization by itself.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {notebookDetailFixtures} from './notebook-detail-fixtures.mjs';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
assert(process.env.WILLYOU_CLIPBOARD_TEST_APPROVED==='1','Explicit user approval and public clipboard preparation are required.');
const executable=process.env.WILLYOU_FILES_APP;assert(executable);const scratch=await mkdtemp('/private/tmp/willyou-notebook-copy-ui-'),projectPath=join(scratch,'project');await mkdir(projectPath);const data=notebookDetailFixtures(),names=['copy-code.ipynb','copy-raw.ipynb'];for(const name of names)await writeFile(join(projectPath,name),data.fixtures[name]);
const result={startedAt:new Date().toISOString(),scratch,checks:[],status:'running',boundary:'Known synthetic text only. No original clipboard read, backup, main inspector or daily user data.'};let app;
try{
 app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'Approved synthetic copy acceptance'});
 for(const name of names){
  await app.open(name);await app.waitFor("Boolean(document.querySelector('.fa-notebook [aria-label=\"Copy code\"]'))");await app.click('.fa-notebook [aria-label="Copy code"]');await app.waitFor("Boolean(document.querySelector('.fa-notebook [aria-label=\"Copy code\"] .lucide-check'))");const expected=name==='copy-code.ipynb'?data.longCode:data.longRaw;
  const matches=await app.evaluate(`(async()=>{const value=await navigator.clipboard.readText();return value===${JSON.stringify(expected)}})()`);assert(matches,'Copied fixture did not match; no clipboard contents logged.');
  assert.equal(await app.evaluate("getComputedStyle(document.querySelector('.fa-code-block pre')).whiteSpace"),'pre-wrap');assert.equal(await app.evaluate("[...document.querySelectorAll('.fa-notebook button')].filter(e=>/wrap|换行/i.test(e.textContent+' '+e.getAttribute('aria-label'))).length"),0);result.checks.push({caseId:'M9-T-T34',file:name,characters:expected.length,sha256:createHash('sha256').update(expected).digest('hex'),systemClipboardMatched:true,defaultWrap:true,noWrapToggle:true});
 }
 for(const name of names)assert.equal(await readFile(join(projectPath,name),'utf8'),data.fixtures[name]);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){try{await app.evaluate("navigator.clipboard.writeText('M9 剪贴板验收')");result.publicMarkerRestored=true;}catch{result.publicMarkerRestored=false;result.status='failed';result.error='Public clipboard marker cleanup did not complete.';process.exitCode=1;}await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,artifacts:scratch}));}

import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
const path=process.argv[2],bytes=await readFile(path),r=JSON.parse(bytes),cases=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
const check=(id,work)=>{try{work();cases.push({caseId:id,layer:'A',status:'passed'});}catch(e){cases.push({caseId:id,layer:'A',status:'failed',error:String(e.stack??e)});}};
assert(r.formal,'This judge requires a formal batch, not a preflight');
if(!r.scrollOnly){
check('M12-T001',()=>{
 assert.equal(r.fileSwitches.length,6);for(const entry of r.fileSwitches){if(entry.kind==='file'){assert.equal(entry.file.text,r.fileTextBefore);assert.equal(entry.browser.activeId,null);}else{const s=entry.observation;assert.equal(s.ui.selectedTabs.length,1);assert.equal(s.browser.activeId,entry.kind==='web-a'?r.firstTwo.a:r.firstTwo.b);}}
 assert.equal(r.afterFirstClose.browser.tabs.length,1);assert.equal(r.afterFirstClose.browser.tabs[0].id,r.firstTwo.b);assert.equal(r.afterFirstClose.file.text,r.fileTextBefore);
});
check('M12-T002',()=>{
 assert.equal(r.taskSwitches.length,6);for(let round=0;round<3;round++){const a=r.taskSwitches[round*2],b=r.taskSwitches[round*2+1];assert.equal(a.taskId,r.taskIds[0]);assert.equal(b.taskId,r.taskIds[1]);assert.equal(a.ui.selectedTask,a.taskId);assert.equal(b.ui.selectedTask,b.taskId);assert.deepEqual(a.browser.tabs.map(t=>t.id),[r.firstTwo.a,r.firstTwo.b]);assert.equal(a.browser.activeId,r.firstTwo.b);assert.deepEqual(b.browser.tabs.map(t=>t.id),r.expectedT2.tabs.map(t=>t.id));assert.equal(b.browser.activeId,r.expectedT2.activeId);assert(a.ui.address.endsWith('/b'));assert(b.ui.address.endsWith('/b?t2'));}
});
}
check('M12-T020',()=>{
 if(r.scrollOnly){assert(r.scrollTaskRepro,'Targeted retest must include the original hidden task-switch trigger');assert.equal(r.scrollTaskRepro.browser.activeId,r.firstTwo.b);}
 assert.equal(r.fileAfterClose.text,r.fileTextBefore);assert.equal(r.fileAfterNew.text,r.fileTextBefore);assert(r.fileScrollBefore>0);assert.equal(r.fileAfterClose.top,r.fileScrollBefore);assert.equal(r.fileAfterNew.top,r.fileScrollBefore);assert.equal(r.afterNewTask.ptyId,r.initialPty);assert.deepEqual(r.afterPidIdentities,r.initialPidIdentities);assert(r.initialPidIdentities.length>=2);for(const p of r.initialPidIdentities)assert(p.identity.endsWith('/bin/sleep'));assert.equal(r.finalT1.tabs.length,1);assert.equal(r.finalT1.tabs[0].url,'about:blank');assert.equal(hash(Buffer.from(r.fileTextBefore)),r.fileSha256);
});
const verdict={at:new Date().toISOString(),source:path,sourceSha256:hash(bytes),asarSha256:r.asarSha256,cases,status:cases.every(c=>c.status==='passed')?'passed':'failed'};await writeFile(join(dirname(path),'workspace-adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));if(verdict.status!=='passed')process.exitCode=1;

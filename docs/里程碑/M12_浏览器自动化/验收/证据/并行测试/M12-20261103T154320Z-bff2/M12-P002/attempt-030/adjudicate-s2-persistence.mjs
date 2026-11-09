import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],bytes=await readFile(join(root,'result.json')),r=JSON.parse(bytes);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),tabs=s=>s?.tabs.map(t=>({id:t.id,url:t.url})),file=rows=>rows?.find(row=>row.key==='fileWorkspace.v1:task:'+r.taskIds[0])?.value;
const reopened=r.reopened?.tabs.find(t=>t.id===r.reopened.activeId),baseline=file(r.fileRecordBefore);let pinned=false;try{pinned=JSON.parse(baseline).routes.length>0;}catch{}
const checks={
 T018:{precondition:r.before?.t1.tabs.length===3&&r.before?.t2.tabs.length===1&&r.formBefore==='must not survive restart',normalExit:r.normalExits?.[0]?.code===0&&r.normalExits[0].signal===null&&r.restartedAppPid!==r.appPid,t1:same(tabs(r.before?.t1),tabs(r.restored?.t1))&&r.before?.t1.activeId===r.restored?.t1.activeId,t2:same(tabs(r.before?.t2),tabs(r.restored?.t2))&&r.before?.t2.activeId===r.restored?.t2.activeId&&r.t2Address===r.restored?.t2.tabs[0].url,formCleared:r.formAfter==='',close:r.afterClose?.tabs.length===2&&!r.afterClose.tabs.some(t=>t.id===r.closedTab?.id),reopen:r.reopened?.tabs.length===3&&reopened?.url===r.closedTab?.url&&reopened?.id!==r.closedTab?.id},
 T019_A:{durableM9Precondition:pinned,unchangedBeforeQuit:!!baseline&&file(r.recordsBeforeQuit)===baseline,unchangedAfterRestart:!!baseline&&file(r.recordsAfterRestart)===baseline,fileModel:r.restoredFile?.text===r.fileTextBefore&&r.fileDiskAfter===r.fileSha256,browserSeparate:r.recordsAfterRestart?.filter(v=>v.key.startsWith('browserWorkspace.v1:')).length===2}
};
const selected=r.compatOnly?['T019_A']:['T018','T019_A'];
const cases=Object.fromEntries(Object.entries(checks).map(([id,c])=>[id,{checks:c,passed:r.appClosed===true&&r.fixtureServerClosed===true&&Object.values(c).every(Boolean)}]));
const verdict={selected,at:new Date().toISOString(),sourceSha256:createHash('sha256').update(bytes).digest('hex'),asarSha256:r.asarSha256,layer:'A real packaged normal lifecycle; T019 separate native I still required',recordTiming:{comparison:'raw bytes after web open/close and actual restart, before file display updates existing M9 reading hints',extraFileDisplayRecordEqual:file(r.fileRecordAfter)===baseline},cases,passed:selected.every(id=>cases[id].passed)};await writeFile(join(root,'persistence-adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));if(!verdict.passed)process.exitCode=1;

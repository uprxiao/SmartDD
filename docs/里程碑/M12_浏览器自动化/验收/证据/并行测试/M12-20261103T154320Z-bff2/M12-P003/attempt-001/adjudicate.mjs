// Independent, read-only judgement: uses raw App UI/DB/native outputs, not driver's status/exit.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root='/private/tmp/willyou-m12-t004-executor-001',read=async n=>JSON.parse(await readFile(join(root,n),'utf8'));
const r=await read('raw-result.json'),cleanup=await read('cleanup.json'),checks=[];
const put=(id,layer,pass,actual)=>checks.push({id,layer,status:pass===null?'not-executed':pass?'passed':'failed',actual});
const noWeb=o=>o&&!o.newHeader&&!o.newTab&&!o.viewport&&!o.browserView&&o.webTabs.length===0;
const text0='T004 T0 task-cwd file retained\nM12_T004_PRIVATE_001\n',text1='T004 P1 task-cwd file retained\nM12_T004_PRIVATE_001\n';
put('A-T0-no-web','A',r.t0Before?noWeb(r.t0Before):null,r.t0Before??null);
put('A-T0-file','A',r.t0Before?r.t0Before.files&&r.t0Before.fileText===text0&&!r.t0Before.fileHidden&&r.t0Before.pinned.includes('t0.txt'):null,r.t0Before??null);
const workspace=r.beforeDelete?.workspace?.find(x=>x.key==='fileWorkspace.v1:task:'+r.p1TaskId);const routes=workspace?JSON.parse(workspace.value).routes:[];put('A-P1-precondition-task-cwd-file-and-web','A',r.p1Before&&r.p1BrowserBefore?r.p1Before.fileText===text1&&r.p1Before.pinned.includes('p1.txt')&&routes.some(x=>x.source==='task-cwd'&&x.relativePath==='p1.txt')&&r.p1BrowserBefore.tabs.some(x=>x.title==='T004 live page'):null,{file:r.p1Before,routes,browser:r.p1BrowserBefore});
put('A-project-deleted','A',r.afterDelete?!r.afterDelete.projects.some(p=>p.id===r.projectId):null,{projectId:r.projectId,after:r.afterDelete?.projects});
put('A-project-task-retained','A',r.afterDelete?!!r.p1Retained:null,r.p1Retained??null);
put('A-deleted-project-no-web','A',r.p1After?noWeb(r.p1After):r.afterDelete&&!r.p1Retained?false:null,r.p1After??null);
put('A-deleted-project-file','A',r.p1After?r.p1After.files&&r.p1After.fileText===text1&&!r.p1After.fileHidden&&r.p1After.pinned.includes('p1.txt'):r.afterDelete&&!r.p1Retained?false:null,r.p1After??null);
const calls=r.calls??[],outputs=r.outputs??[],actualOutput=outputs.map(o=>o.text).join('\n');
let native=[];for(const file of r.nativeSessions??[]){const bytes=await readFile(join(root,file.evidence));if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Native evidence SHA mismatch');native.push(bytes.toString());}
const nativeRaw=native.join('\n'),nativeRows=nativeRaw.split('\n').filter(Boolean).map(s=>JSON.parse(s));
const ownCalls=nativeRows.filter(x=>x.type==='response_item'&&x.payload?.type==='function_call'&&x.payload?.name==='exec_command').map(x=>({call_id:x.payload.call_id,args:JSON.parse(x.payload.arguments)}));
const matched=ownCalls.find(x=>x.args.cmd==='willyou-app browser tab list');
put('R-real-ui-start-no-project','R',r.t0Started? r.t0Started.projectId===null&&!!r.t0Started.ptyId&&!r.t0Started.runtimeSnapshot&&r.actions.some(x=>x.stage==='t0-real-ui-start'&&x.selector==='[data-testid=task-resume]'):null,{task:r.t0Started??null,cliSha256:r.codexSha256,health:r.realHealth});
put('R-exact-command-once','R',r.outputs?.length?calls.filter(c=>c.name==='exec_command'&&c.args.cmd==='willyou-app browser tab list').length===1&&!!matched:null,{calls,matched,nativeFiles:r.nativeSessions});
put('R-command-not-found','R',outputs.length?/command not found[^\n]*willyou-app|willyou-app[^\n]*(?:not found|command not found)/i.test(actualOutput)&&/Process exited with code 127|exit_code["':\s]+127|Exit code:\s*127/i.test(actualOutput)&&nativeRaw.includes('willyou-app')&&nativeRaw.includes('127'):null,{outputs});
put('cleanup','cleanup',cleanup.appClosed&&cleanup.fixtureServerClosed&&cleanup.remainingKnownPids.length===0,cleanup);
const contract=checks.filter(x=>x.layer==='A'||x.layer==='R'),status=contract.every(x=>x.status==='passed')?'passed':contract.some(x=>x.status==='failed')?'failed':'partial';
const layerStatus=layer=>{const c=checks.filter(x=>x.layer===layer);return c.every(x=>x.status==='passed')?'passed':c.some(x=>x.status==='failed')?'failed':'partial'};
const result={caseId:'M12-T004',status,layers:{A:layerStatus('A'),R:layerStatus('R')},at:new Date().toISOString(),requirementsRevision:'R1.2',asarSha256:r.asarSha256,boundary:r.boundary,checks,failedStage:r.failedStage??null,error:r.error??null,missing:checks.filter(x=>x.status==='not-executed').map(x=>x.id),failureClassification:r.afterDelete&&!r.p1Retained?'acceptance-contract-conflict':r.fixtureFailure?'fixture':r.status==='deferred-focus-loss'?'environment-focus':status==='failed'?'product-or-assertion':'none',contractDisposition:r.afterDelete&&!r.p1Retained?'T004 requires the deleted-project task and files remain usable, while existing project deletion contract explicitly deletes its tasks and actual migrated FK is CASCADE. Preserve original red; user decision pending; no test expectation or production deletion behavior changed.':null,raw:'raw-result.json',cleanup:'cleanup.json'};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');
const files=await readdir(root,{recursive:true}),manifest=[];for(const name of files.sort()){if(name==='manifest.json'||name.startsWith('userdata/')||name.startsWith('home/')||name.startsWith('codex/')||name.startsWith('tools/')||name.startsWith('cache/')||name.startsWith('t0-cwd/')||name.startsWith('p1-cwd/'))continue;try{const b=await readFile(join(root,name));manifest.push({path:name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})}catch(e){if(e.code!=='EISDIR')throw e;}}
await writeFile(join(root,'manifest.json'),JSON.stringify({at:new Date().toISOString(),files:manifest},null,2)+'\n');console.log(JSON.stringify({status,checks:checks.map(x=>({id:x.id,status:x.status})),missing:result.missing}));

// File-only readiness, never imports run/cleanup/judge or touches auth/runtime.
import assert from 'node:assert/strict';
import {readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import {ROOT,verifyPin,sha} from './io.mjs';
const payload=JSON.parse(await readFile(ROOT+'/payload-review.json')),pin=JSON.parse(await readFile(ROOT+'/pin.json')),run=await readFile(ROOT+'/run.mjs','utf8');
assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node');
try{await lstat(ROOT+'/runtime-001');throw Error('Fresh runtime already exists');}catch(error){assert.equal(error.code,'ENOENT');}
assert.equal(payload.scope,'M12-T123-T124-R-A');assert.equal(Object.keys(payload.fixedPrompts).length,6);assert.equal(payload.health.automaticCreates,1);assert.equal(payload.destination.provider,'openai');assert.equal(payload.destination.model,'gpt-6.1-sol');assert.equal(payload.businessPolicy.sandbox,'workspace-write');assert.equal(payload.businessPolicy.approval,'on-request');
for(const[key,text]of Object.entries(payload.fixedPrompts)){assert(text.startsWith(payload.marker+'_'));assert(!/[\r\n]/.test(text));if(key.startsWith('T123'))assert(!text.includes('Qa-Pass-1'));}
assert(payload.syntheticBugs.T123.bug.steps.includes('密码未提供')&&!payload.syntheticBugs.T123.bug.steps.includes('Qa-Pass-1'));assert.equal(payload.syntheticBugs.T124.account,'qa2');assert.equal(payload.reviewablePublicSkills.length,4);
assert(!/app\.invoke\(['"](?:tasks\.(?:create|open)|browser\.(?:pause|createProfile|useProfile))['"]/.test(run),'Accepted startup/pause/profile actions must not be API substitutes');
assert(run.includes("key==='paused-single-probe'?{receipts:[]")&&run.includes('successCollectorSkipped:true')&&run.includes('bindPausedSnapshotProof'));
const paused=JSON.parse(await readFile(ROOT+'/paused-contract-controls.json'));assert.equal(paused.passed,10);assert.equal(paused.total,10);assert.equal(paused.newNativeOrCLIExecution,false);
const syntax=[];async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){if(['node_modules','cache','sent-data'].includes(entry.name))continue;const path=directory+'/'+entry.name;if(entry.isDirectory())await scan(path);else if(entry.name.endsWith('.mjs')){const bytes=await readFile(path),source=ts.createSourceFile(path,bytes.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(source.parseDiagnostics.length,0,path);const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',NODE_COMPILE_CACHE:ROOT+'/cache/node'}});assert.equal(result.status,0,path+' '+result.stderr);syntax.push({path:path.slice(ROOT.length+1),sha256:sha(bytes),nodeCheckExit:result.status});}}}await scan(ROOT);
const packageCheck=await verifyPin(pin);for(const file of payload.reviewablePublicSkills)assert.equal(sha(await readFile(ROOT+'/'+file.path)),file.sha256);
const result={schema:'t123-t124-file-static-ready-v1',status:'static-ready-await-Root-review-and-full-lease',syntax,syntaxCount:syntax.length,pausedContractControls:{passed:10,total:10},packageCheck,payloadSHA256:sha(await readFile(ROOT+'/payload-review.json')),authReadOrCopyOrHash:false,NativeAppUIHTTPModelExecution:false,formalNewPasses:0};await writeFile(ROOT+'/static-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,syntaxFiles:syntax.length,pausedControls:'10/10',publicSkillTemplates:4,authReadOrCopy:false,NativeExecution:false,formalNewPasses:0}));

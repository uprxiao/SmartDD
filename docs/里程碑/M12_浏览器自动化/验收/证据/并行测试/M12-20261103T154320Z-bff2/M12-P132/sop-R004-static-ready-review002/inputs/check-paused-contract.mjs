// Reuse actual saved T113 errors, not a new browser/CLI execution.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ROOT} from './io.mjs';
import {parsePausedOutput} from './paused-proof.mjs';
const path='/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-P067/attempt-001/raw.json',bytes=await readFile(path),source=JSON.parse(bytes),sha=value=>createHash('sha256').update(value).digest('hex'),checks=[];
const records=[13,15].map(index=>({index,value:source.commands[index]}));
for(const{index,value}of records){assert.equal(value.args[1],'snapshot');const parsed=parsePausedOutput({exitCode:value.raw.code,stdout:value.raw.stdout,stderr:value.raw.stderr});assert.equal(parsed.value.error.effectState,'read-only');assert.deepEqual(parsed.value,value.parsed);checks.push({name:'actual-T113-paused-snapshot-'+index,pass:true,actualChildExitCode:value.raw.code,errorCode:parsed.value.error.code,effectState:parsed.value.error.effectState,sourceSelector:'commands['+index+']',commandId:value.id,runId:value.runId,operationId:parsed.value.operationId,requestId:parsed.value.requestId,stdoutSHA256:sha(value.raw.stdout),stderrSHA256:sha(value.raw.stderr)});}
const raw=records[0].value.raw,base={exitCode:raw.code,stdout:raw.stdout,stderr:raw.stderr};
for(const[name,change]of[
 ['wrong-exit',value=>value.exitCode=0],
 ['wrong-code',value=>{const json=JSON.parse(value.stdout);json.error.code='BROWSER_TIMEOUT';value.stdout=JSON.stringify(json);}],
 ['wrong-effect',value=>{const json=JSON.parse(value.stdout);json.error.effectState='unknown';value.stdout=JSON.stringify(json);}],
 ['retryable-error',value=>{const json=JSON.parse(value.stdout);json.error.retryable=true;value.stdout=JSON.stringify(json);}],
 ['missing-operation',value=>{const json=JSON.parse(value.stdout);delete json.operationId;value.stdout=JSON.stringify(json);}],
 ['unknown-stderr',value=>value.stderr+='other output\n']
]){const value=structuredClone(base);change(value);assert.throws(()=>parsePausedOutput(value));checks.push({name,pass:true,controlOnly:true});}
// Native joins channels; these are explicit synthetic aggregation controls of exact original bytes, not actual Native evidence.
for(const order of['stdout-first','stderr-first']){const aggregate=order==='stdout-first'?raw.stdout+raw.stderr:raw.stderr+raw.stdout;const value=parsePausedOutput({exitCode:raw.code,aggregatedOutput:aggregate});assert.equal(value.value.error.code,'BROWSER_PAUSED');checks.push({name:'synthetic-channel-aggregation-'+order,pass:true,controlOnly:true});}
const result={schema:'T123-expected-paused-original-contract-controls-v1',source:{path,bytes:bytes.length,sha256:sha(bytes)},checks,passed:checks.length,total:checks.length,newNativeOrCLIExecution:false,formalNewPasses:0,scope:'Error format only; future typed event and current Host operation/run/task/project/package/plan are separately bound by bindPausedSnapshotProof. Expected snapshot read-only+attempt1 is observed in old real T113 and fixed source029 tool-service/browser read semantics; no write not-started substitution.'};await writeFile(ROOT+'/paused-contract-controls.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:checks.length,total:checks.length,actualSavedPositive:2,newNativeOrCLIExecution:false}));

// Expected-error contract, deliberately separate from success-only typed-primary receipts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function parsePausedOutput({exitCode,stdout,stderr,aggregatedOutput}){
 assert.equal(exitCode,2,'Actual numeric paused child exit must be 2, never coerced to 0');
 let errorJSON,stderrObserved=false;
 if(aggregatedOutput!==undefined){
  assert(typeof aggregatedOutput==='string'&&Buffer.byteLength(aggregatedOutput)<=262144);
  const lines=aggregatedOutput.trimEnd().split('\n');assert(lines.length>=1&&lines.length<=2,'Only exact JSON plus optional fixed CLI stderr line accepted');
  const jsonLines=lines.filter(line=>line.startsWith('{')&&line.endsWith('}'));assert.equal(jsonLines.length,1);
  for(const line of lines)if(line!==jsonLines[0]){assert.equal(line,'willyou-app: BROWSER_PAUSED');stderrObserved=true;}
  errorJSON=JSON.parse(jsonLines[0]);
 }else{
  assert(typeof stdout==='string'&&typeof stderr==='string');errorJSON=JSON.parse(stdout.trim());assert(stderr===''||stderr==='willyou-app: BROWSER_PAUSED\n');stderrObserved=stderr!=='';
 }
 assert.equal(errorJSON.error?.code,'BROWSER_PAUSED');assert.equal(errorJSON.error.layer,'provider');assert(['read-only','not-started'].includes(errorJSON.error.effectState));assert.equal(errorJSON.error.retryable,false);assert.equal(errorJSON.error.retryExhausted,false);assert.equal(errorJSON.error.attemptCount,1);assert(uuid(errorJSON.operationId)&&uuid(errorJSON.requestId));
 return{value:errorJSON,actualExitCode:exitCode,stderrObserved,outputJSONSHA256:sha(JSON.stringify(errorJSON)),sourceKind:aggregatedOutput===undefined?'actual-separate-CLI-stdout-stderr':'actual-Native-aggregated-output'};
}
export function bindPausedSnapshotProof({typedCommands,hostRows,expected,plan}){
 const commands=typedCommands.filter(command=>command.item.command.some(arg=>typeof arg==='string'&&/\bwillyou-app\s+browser\b/.test(arg)));assert.equal(commands.length,1,'Exactly one browser invocation in paused turn; never suppress retry');
 const command=commands[0],item=command.item;assert.equal(command.threadId,expected.nativeSessionId);assert.equal(command.turnId,expected.turnId);assert.equal(fileURLToPath(item.cwd),expected.cwd);assert.equal(item.status,'completed');assert(Array.isArray(item.command)&&item.command.length===3&&['/bin/zsh','/bin/bash'].includes(item.command[0])&&item.command[1]==='-lc');
 const plain=item.command[2];assert(/^willyou-app\s+browser\s+snapshot(?:\s|$)/.test(plain)&&!/[;&|`$\r\n<>]/.test(plain),'Only direct single snapshot can prove this expected error');
 const output=parsePausedOutput({exitCode:item.exit_code,aggregatedOutput:item.aggregated_output});assert.equal(output.value.error.effectState,'read-only','snapshot uses original read-only failure contract, not write preflight not-started');
 const rows=hostRows.filter(row=>row.operation_id===output.value.operationId||row.request_id===output.value.requestId);assert.equal(rows.length,1);const host=rows[0];assert.equal(host.operation_id,output.value.operationId);assert.equal(host.request_id,output.value.requestId);
 for(const[k,column]of[['runId','run_id'],['taskId','task_id'],['projectId','project_id']]){assert.equal(host[column],expected[k]);assert.equal(plan[k],expected[k]);}
 assert.equal(host.tool_name,'browser.nav.snapshot');assert.equal(host.app_id,'browser');assert.equal(host.state,'failed');assert.equal(host.error_code,'BROWSER_PAUSED');assert.equal(host.attempt_count,1);assert.equal(host.effect_state,'read-only');assert.equal(hostRows.filter(row=>row.app_id==='browser').length,1);
 const allowed=plan.allowed.filter(entry=>entry.capabilityId==='browser.nav.snapshot'&&entry.entry==='cli'&&entry.packageHash===host.package_hash&&entry.appId==='browser');assert.equal(allowed.length,1);
 return{schema:'expected-paused-snapshot-proof-v1',valid:true,typedCommandLine:command.line,nativeSessionId:expected.nativeSessionId,turnId:expected.turnId,runId:expected.runId,taskId:expected.taskId,projectId:expected.projectId,cwd:expected.cwd,planHash:plan.planHash,packageHash:host.package_hash,operationId:host.operation_id,requestId:host.request_id,actualChildExitCode:item.exit_code,errorCode:'BROWSER_PAUSED',effectState:'read-only',hostState:'failed',attemptCount:1,noBrowserRetryInTurn:true,typedRowSHA256:command.rowSHA256,hostRowSHA256:sha(JSON.stringify(host)),outputJSONSHA256:output.outputJSONSHA256,stderrObserved:output.stderrObserved,successReceiptFabricated:false};
}

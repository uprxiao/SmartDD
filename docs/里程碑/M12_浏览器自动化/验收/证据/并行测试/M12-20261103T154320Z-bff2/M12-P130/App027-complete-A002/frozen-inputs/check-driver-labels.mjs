// Pure source controls; all actual branches in the run import closure are checked.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {ROOT} from './io.mjs';
import {assertDriverLabels,readDriverGraph,inspectDriverLabels} from './check-labels.mjs';
const files=await readDriverGraph(ROOT),actual=await assertDriverLabels(ROOT),controls=[];
function sample(name,path,edit,expect){const copy=new Map(files);copy.set(ROOT+'/'+path,edit(copy.get(ROOT+'/'+path)));const result=inspectDriverLabels(copy,ROOT);assert.equal(result.issues.length,expect,name);controls.push({name,issues:result.issues})}
sample('normal-cleanup-uppercase-rejected','run.mjs',s=>s.replace("'normal-t132-quit'","'normal-t132-Quit'"),1);
sample('exception-branch-observer-uppercase-rejected','view-observer.mjs',s=>s.replace("'t132-view-capture'","'t132-view-Capture'"),1);
sample('observer-dynamic-label-rejected','view-observer.mjs',s=>s.replace("'t132-view-capture'",'unknownRuntimeLabel'),1);
sample('wrong-own-label-forwarding-rejected','run.mjs',s=>s.replace('{timeoutMs:options.timeoutMs,label}','{timeoutMs:options.timeoutMs,label:body}'),2);
sample('unexpected-third-option-rejected','run.mjs',s=>s+";own('return 1','lowercase',{synchronous:true});",1);
sample('third-option-spread-rejected','run.mjs',s=>s+";own('return 1','lowercase',{...runtimeOptions});",1);
sample('direct-helper-uppercase-rejected','activate-initial-exact-pid.mjs',s=>s.replace("'readonly-owned-initial-focus'","'readonly-owned-initial-Focus'"),1);
sample('direct-fixed-label-accepted','run.mjs',s=>s+";app.mainEvaluate('x',{label:'lowercase-valid'});",0);
sample('direct-options-spread-rejected','run.mjs',s=>s+";app.mainEvaluate('x',{...runtimeOptions,label:'lowercase'});",1);
assert.equal(actual.delegations.length,1);assert.equal(actual.delegations[0].sourceParameter,2);assert.equal(actual.delegations[0].optionalTimeoutArgument,3);
const result={status:'all-actual-labels-and-pure-controls-pass',actual,controls,NativeAppOSHTTPAuthModelExecution:false,scope:'Every real own literal/finite conditional label and direct mainEvaluate label, including initial focus, normal cleanup, failure branches. Only third timeoutMs forwarding permitted; no option spread.'};await writeFile(ROOT+'/label-preflight.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({labels:actual.calls.length,driverModules:actual.files.length,controls:controls.length,NativeExecution:false}));

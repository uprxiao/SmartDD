// Pure negative controls for the exact driver graph; no App or OS calls.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ROOT} from './io.mjs';
import {assertDriverLabels,readDriverGraph,inspectDriverLabels} from './check-labels.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');
assert.equal(process.env.NODE_COMPILE_CACHE,ROOT+'/cache/node');
const files=await readDriverGraph(ROOT),run=files.get(ROOT+'/run.mjs'),actual=await assertDriverLabels(ROOT),controls=[];
function inspect(name,text,expectedIssues){const sample=new Map(files);sample.set(ROOT+'/run.mjs',text);const result=inspectDriverLabels(sample,ROOT);assert.equal(result.issues.length,expectedIssues,name);controls.push({name,expectedIssues,actualIssues:result.issues});}
assert.equal(actual.calls.length,4);assert.equal(actual.delegations.length,1);
const old='/private/tmp/willyou-m12-t017-App025-I-001/run.mjs',oldBytes=await readFile(old);
inspect('original-I001-two-uppercase-labels-rejected',oldBytes.toString(),2);
inspect('own-uppercase-rejected',run.replace("'load-owned-current-permission-i'","'load-owned-current-permission-I'"),1);
inspect('own-label-65-characters-rejected',run.replace("'load-owned-current-permission-i'",JSON.stringify('a'.repeat(65))),1);
inspect('own-dynamic-label-rejected',run.replace("'load-owned-current-permission-i'",'runtimeLabel'),1);
inspect('direct-literal-label-accepted',run+";app.mainEvaluate('x',{label:'direct-valid'});",0);
inspect('direct-uppercase-label-rejected',run+";app.mainEvaluate('x',{label:'direct-Invalid'});",1);
inspect('direct-dynamic-label-rejected',run+";app.mainEvaluate('x',{label:runtimeLabel});",1);
inspect('direct-missing-label-rejected',run+";app.mainEvaluate('x',{});",1);
inspect('wrong-wrapper-parameter-forwarding-rejected',run.replace('`,{label});','`,{label:body});'),2);
const result={status:'all-driver-labels-and-controls-pass',actual,controls,originalI001Run:{path:old,sha256:sha(oldBytes)},harness:{path:'driver-source/scripts/lib/electron-harness.mjs',sha256:sha(await readFile(ROOT+'/driver-source/scripts/lib/electron-harness.mjs')),guardLines:[411,412,413]},runtimeOrder:'run imports verifier and awaits assertDriverLabels(ROOT) before permit and openElectron',NativeAppOSHTTPModelAuthExecution:false};
await writeFile(ROOT+'/label-preflight.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,driverModules:actual.files.length,actualLabels:actual.calls.length,delegation:actual.delegations.length,controls:controls.length,NativeAppOSExecution:false}));

// Pure protocol/identity checks. No App, DB, process, network, or output rewriting.
import assert from 'node:assert/strict';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
export function cliPlan(c){
 const cookie=(tag,url)=>({tag,argv:['browser','cookie','get','--url',url,'--page',c.pageId],expectedCode:0,expectedError:null,capability:'browser.cookie.get',effect:'read-only'});
 return [
  {tag:'identity',argv:['browser','identity','get'],expectedCode:0,expectedError:null,capability:'browser.identity.get',effect:'read-only'},
  {tag:'create-local-page',argv:['browser','tab','create','--url',c.url],expectedCode:0,expectedError:null,capability:'browser.tab.create',effect:'completed'},
  {tag:'create-form-page',argv:['browser','tab','create','--url',c.formURL],expectedCode:0,expectedError:null,capability:'browser.tab.create',effect:'completed'},
  ...[['prepare-writer-snapshot',c.pageId],['prepare-form-snapshot',c.formPageId]].map(([tag,page])=>({tag,argv:['browser','snapshot','--page',page],expectedCode:0,expectedError:null,capability:'browser.nav.snapshot',effect:'read-only'})),
  ...[['before-qa','http://qa.example.test/'],['before-other','http://other.example.test/'],['before-google','http://google.com/'],['before-youtube','http://youtube.com/']].map(([tag,url])=>cookie(tag,url)),
  {tag:'importing-real-cli-unavailable',argv:['browser','snapshot','--page',c.pageId],expectedCode:2,expectedError:'BROWSER_UNAVAILABLE',capability:'browser.nav.snapshot',effect:'read-only'},
  ...[['success-actual-qa','http://qa.example.test/'],['success-actual-other','http://other.example.test/'],['lost-ack-actual-qa','http://qa.example.test/'],['lost-ack-actual-other','http://other.example.test/']].map(([tag,url])=>cookie(tag,url))
 ];
}
export function parseCliActual(row,c){
 const p=cliPlan(c).find(x=>x.tag===row.tag);assert(p,'Only original fourteen CLI tags');
 assert.deepEqual(row.argv,p.argv);assert.equal(row.expectedCode,p.expectedCode);assert.equal(row.expectedError,p.expectedError);
 const a=row.actual;assert(object(a));assert.equal(a.kind,'cli-result');assert.equal(a.tag,row.tag);assert(Number.isInteger(a.pid)&&a.pid>0);
 assert.deepEqual(a.argv,row.argv);assert.equal(a.code,p.expectedCode);assert.equal(a.signal,null);assert.equal(a.timedOut,false);assert.deepEqual(a.cleanupSignals,[]);
 assert.equal(c.receiver.binary,c.cliPath);assert.equal(c.receiver.binarySha256,c.cliSHA256);assert(c.receiver.hasCliToken&&c.receiver.hasCliEndpoint);assert(Number.isInteger(c.receiver.pid)&&c.receiver.pid>0);
 assert.equal(typeof a.stdout,'string');assert(a.stdout.trim());const parsed=JSON.parse(a.stdout);assert(object(parsed));
 let operationId,requestId,kind;
 if(p.expectedCode===0){
  kind='success-v2';assert.equal(parsed.schema,'willyou-app-result-v2');assert.equal(parsed.status,'ok');assert.equal(parsed.contractMajor,2);assert(!Object.hasOwn(parsed,'error'));assert(object(parsed.data));
  assert.equal(parsed.source?.appId,'browser');assert.equal(parsed.source.packageHash,c.packageHash);assert.equal(parsed.capabilityId,p.capability);
  assert.equal(parsed.operation?.origin,'cli');assert.equal(parsed.operation.effectState,p.effect);operationId=parsed.operation.id;requestId=parsed.operation.requestId;
 }else{
  kind='native-error';assert.deepEqual(Object.keys(parsed).sort(),['error','operationId','requestId']);assert(object(parsed.error));
  assert.equal(parsed.error.code,p.expectedError);assert.equal(parsed.error.layer,'provider');assert.equal(parsed.error.effectState,'read-only');assert.equal(parsed.error.attemptCount,1);assert.equal(parsed.error.retryable,false);assert.equal(parsed.error.retryExhausted,false);
  assert.equal(typeof parsed.error.message,'string');assert(parsed.error.message.length>0);assert.equal(typeof parsed.error.nextAction,'string');assert(parsed.error.nextAction.length>0);
  operationId=parsed.operationId;requestId=parsed.requestId;
 }
 assert(id(operationId)&&id(requestId));return{parsed,operationId,requestId,kind,capability:p.capability,effect:p.effect};
}
export function assertCliProof(row,c){
 const p=parseCliActual(row,c);assert.deepEqual(row.parsed,p.parsed,'Parsed must be untouched actual stdout');
 assert(Array.isArray(row.host));assert.equal(row.host.length,1,'Exactly one Host invocation');const h=row.host[0];
 assert.equal(h.operation_id,p.operationId);assert.equal(h.request_id,p.requestId);assert.equal(h.run_id,c.runId);assert.equal(h.task_id,c.taskId);assert.equal(h.project_id,c.projectId);
 assert.equal(h.app_id,'browser');assert.equal(h.package_hash,c.packageHash);assert.equal(h.tool_name,p.capability);assert.equal(h.state,row.expectedCode===0?'succeeded':'failed');assert.equal(h.effect_state,p.effect);assert.equal(h.attempt_count,1);
 return{kind:p.kind,operationId:p.operationId,requestId:p.requestId,capability:p.capability,packageHash:h.package_hash,identitySource:p.kind==='native-error'?'original top-level IDs + unique Host; no source/operation fabricated':'original V2 + unique Host'};
}

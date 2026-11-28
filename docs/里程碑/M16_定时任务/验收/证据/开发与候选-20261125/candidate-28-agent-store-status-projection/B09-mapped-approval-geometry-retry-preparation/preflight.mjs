import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {repo,support,expectedArgs,digest,verifyPins} from '../guards.mjs';
import {cliPath,cliSha,verifyNativeRunner,verifyOriginalKeys} from './pins.mjs';
import {declaredRequestTool,findAwaitingReceipt,choices,modes} from './model-fixture.mjs';
import {checkGeometryRecovery} from './geometry-contract.mjs';
import {checkSerializedCallbacks} from './callback-contract.mjs';
const dir=join(support,'mapped-approvals-geometry-retry'),pins=await verifyPins(expectedArgs),cli=await verifyNativeRunner([cliPath,cliSha]),contract=await verifyOriginalKeys();
const geometryRecovery=await checkGeometryRecovery(),callbackScope=await checkSerializedCallbacks(dir);assert.deepEqual(callbackScope.unresolved,[]);
const archive=join(repo,'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125/candidate-10-cross-scope');
const prior=join(archive,'A48-actual-host-approval-readonly.json'),previousDriver=join(archive,'driver.snapshot.mjs'),previousModel=join(archive,'model-fixture.snapshot.ts');
assert.equal(await digest(prior),'137291e95f15d5b854ff94fa910c46dcbc813843fd1d5e7ae490c339b31b40f4');
assert.equal(await digest(previousDriver),'ad3246d09462762affc6630eaab758bd6b4908289c94285023b6b33beccd7ca2');
assert.equal(await digest(previousModel),'ddf5d4cdb665bbc5c6267c66d226d866c30f6de5979b6cb3bc661d6009e06eeb');
const evidence=JSON.parse(await readFile(prior,'utf8')),modelSource=await readFile(previousModel,'utf8'),driverSource=await readFile(previousDriver,'utf8');
assert(evidence.actualReadOnlyEvidence&&evidence.ordinaryActualRequest.status==='resolved'&&evidence.ordinaryActualRequest.pages.length===1&&evidence.ordinaryActualRequest.choice.choice==='observe');
assert(modelSource.includes("String(t.name).endsWith('browser_access_request_v2')")&&modelSource.includes("{task:ownedBrowserTarget,mode:'observe'}"));
assert(driverSource.includes("r.payload?.businessKind==='browser_access'")&&driverSource.includes("ordinary-later-exact-approval"));
const catalog=JSON.parse(await readFile(join(repo,'src/shared/browser-commands.generated.json'),'utf8'));
const capability=catalog.find(x=>x.id==='browser.access.request');assert(capability&&capability.input.properties.mode.enum.join(',')==='observe,control');
// Parser checks only against the source schema/known response contract, not a
// new App request; no HTTP service, native turn, or approval is started here.
const tool=declaredRequestTool([{type:'namespace',name:'mcp__owned_fixture',tools:[{type:'function',name:'smartdd_browser_access_request_v2',parameters:capability.input}]}]);
assert.equal(tool.name,'smartdd_browser_access_request_v2');
assert.throws(()=>declaredRequestTool([{type:'function',name:'smartdd_browser_page_click_v2',parameters:capability.input}]));
const syntheticReceipt={requestId:'00112233-4455-6677-8899-aabbccddeeff',operationId:'parser-only',state:'awaiting_user',duplicate:false};
assert.deepEqual(findAwaitingReceipt({content:[{type:'text',text:JSON.stringify({result:syntheticReceipt})}]}),syntheticReceipt);
assert.equal(findAwaitingReceipt({result:{...syntheticReceipt,state:'authorized'}}),null);assert.equal(findAwaitingReceipt({result:{...syntheticReceipt,duplicate:true}}),null);
const files=['driver.mjs','model-fixture.mjs','pins.mjs','geometry-contract.mjs','callback-contract.mjs','preflight.mjs'];
for(const n of files)execFileSync(process.execPath,['--check',join(dir,n)]);
execFileSync('python3',['-c','import ast,sys;from PIL import Image;ast.parse(open(sys.argv[1]).read())',join(dir,'review.py')]);files.push('review.py');
const cdp=JSON.parse(execFileSync(process.execPath,[join(repo,'scripts/lib/check-cdp-expressions.mjs'),join(dir,'driver.mjs'),join(support,'isolated-electron.mjs')],{encoding:'utf8'}).trim());assert.equal(cdp.failures,0);
const packageSource=JSON.parse(execFileSync('python3',['-c',`import struct,json,sys,hashlib
out=[]
for path in sys.argv[1:]:
 with open(path,'rb') as f:
  _,h,_,j=struct.unpack('<IIII',f.read(16));hdr=json.loads(f.read(j));start=8+h
  def read(v):
   f.seek(start+int(v['offset']));raw=f.read(v['size']);return raw.decode(),hashlib.sha256(raw).hexdigest()
  main,mainSha=read(hdr['files']['out']['files']['main']['files']['index.js'])
  assets=hdr['files']['out']['files']['renderer']['files']['assets']['files'];name=next(n for n in assets if n.startswith('index-') and n.endswith('.js'));renderer,rendererSha=read(assets[name])
  def cut(data,needle,before=0,after=200):
   k=data.index(needle);return data[max(0,k-before):k+after]
  out.append({'path':path,'mainSha':mainSha,'rendererAsset':name,'rendererSha':rendererSha,
   'registration':cut(main,'title: "跨任务浏览器授权"',120,350),'realRequestReceipt':cut(main,'state: "awaiting_user", duplicate: false',70,75),'deny':cut(main,'choice.choice === "deny" || choice.choice === "cancel"',0,220),'hasActualCapabilityRunsTable':"INSERT INTO capability_runs" in main,
   'reviewUI':cut(renderer,'aria-label": "网页授权详情"',80,180),'observeUI':cut(renderer,'只读，可查看页面、截图和读取内容',40,75),'controlUI':cut(renderer,'可点击、输入和执行页面脚本',40,75)})
print(json.dumps(out,ensure_ascii=False))
`,...pins.specs.map(s=>join(s.bundle,'Contents/Resources/app.asar'))],{encoding:'utf8'}));
for(const a of packageSource){assert(a.registration.includes('review: { requester: scope.taskId, targetTaskId, mode, pages: target.pages }'));assert(a.registration.includes('允许观察')&&a.registration.includes('允许控制'));assert(a.deny.includes('用户拒绝')&&a.hasActualCapabilityRunsTable);assert(a.realRequestReceipt.includes('requestId: id')&&a.realRequestReceipt.includes('duplicate: false'));}
const prepared=await readFile(join(dir,'driver.mjs'),'utf8'),fixture=await readFile(join(dir,'model-fixture.mjs'),'utf8');
assert(prepared.includes('agentTasks.create')&&prepared.includes('agents.customToolPath')&&prepared.includes('capability_runs where run_id=?')&&prepared.includes('businessRequestRetired')&&prepared.includes('await noGrant()'));
assert(prepared.includes('拒绝"]')&&!/shellClick\([^\n]*(?:允许观察|允许控制)/.test(prepared));
assert(!fixture.includes('exec_command')&&!fixture.includes('browser_tab_list')&&!fixture.includes('browser_page_click'));
assert.deepEqual(choices,{observe:['允许观察','拒绝'],control:['允许观察','允许控制','拒绝']});
const info={schema:'M16-B09-mapped-approval-pair-static-preflight',pins,cli,geometryRecovery,callbackScope,originalContract:contract,originalKeys:contract.keys.length,oldNewRows:contract.keys.length*2,modes,choices,previousActualEvidence:{file:prior,sha:await digest(prior),scope:'Archived actual C10 ordinary same-project native observe request; not a new result or permission',driverSha:await digest(previousDriver),modelSha:await digest(previousModel)},packageSource,cdp,files:Object.fromEntries(await Promise.all(files.map(async n=>[n,await digest(join(dir,n))]))),frontObserverSha:await digest(join(support,'next-13/front-observer')),parserChecks:'schema/receipt/envelope positive and denied/non-requested negative; no actual live data fabricated',actualAppLaunch:false,actualNativeInput:false,actualRequests:0,actualCaptures:0};
console.log(JSON.stringify(info,null,2));

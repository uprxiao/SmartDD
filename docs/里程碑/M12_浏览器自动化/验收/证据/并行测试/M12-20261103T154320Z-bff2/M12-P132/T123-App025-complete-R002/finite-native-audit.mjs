// Static AST interpretation only. No eval, VM, model code execution, App, network or child process.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire('/private/tmp/willyou-m12-t123-real-R-cont-002/node_modules/typescript/package.json'),ts=require('typescript');
const sha=x=>createHash('sha256').update(x).digest('hex');
export function interpret(code){
 const file=ts.createSourceFile('carrier.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(file.parseDiagnostics.length,0);
 const actions=[],emits=[],inventoryExpressions=[],env=new Map();
 function expr(n,e=env){
  if(ts.isAwaitExpression(n)||ts.isParenthesizedExpression(n))return expr(n.expression,e);
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text;
  if(ts.isNumericLiteral(n))return Number(n.text);
  if(n.kind===ts.SyntaxKind.TrueKeyword)return true;if(n.kind===ts.SyntaxKind.FalseKeyword)return false;if(n.kind===ts.SyntaxKind.NullKeyword)return null;
  if(ts.isIdentifier(n)){assert(e.has(n.text),'Unknown identifier '+n.text);return e.get(n.text);}
  if(ts.isArrayLiteralExpression(n)){assert(n.elements.length<=64);return n.elements.map(x=>expr(x,e));}
  if(ts.isObjectLiteralExpression(n)){const o=Object.create(null);for(const p of n.properties){assert(ts.isPropertyAssignment(p)||ts.isShorthandPropertyAssignment(p));assert(ts.isIdentifier(p.name)||ts.isStringLiteral(p.name));const k=p.name.text;assert(!['__proto__','constructor','prototype'].includes(k)&&!Object.hasOwn(o,k));o[k]=ts.isShorthandPropertyAssignment(p)?expr(p.name,e):expr(p.initializer,e);}return o;}
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken){const a=expr(n.left,e),b=expr(n.right,e);assert(['string','number'].includes(typeof a)&&['string','number'].includes(typeof b));return a+b;}
  if(ts.isTemplateExpression(n)){let s=n.head.text;for(const p of n.templateSpans){const v=expr(p.expression,e);assert(['string','number'].includes(typeof v));s+=v+p.literal.text;}return s;}
  if(ts.isElementAccessExpression(n)){const a=expr(n.expression,e),k=expr(n.argumentExpression,e);assert(Array.isArray(a)&&Number.isInteger(k)&&k>=0&&k<a.length);return a[k];}
  if(ts.isPropertyAccessExpression(n)){const a=expr(n.expression,e),k=n.name.text;assert(a&&typeof a==='object'&&!['__proto__','constructor','prototype'].includes(k)&&Object.hasOwn(a,k),'Only finite literal own property access');return a[k];}
  assert(ts.isCallExpression(n),'Unsupported AST '+ts.SyntaxKind[n.kind]);
  const target=n.expression;
  if(ts.isIdentifier(target)&&target.text==='text'){assert(n.arguments.length===1);const v=expr(n.arguments[0],e);emits.push(v);return v;}
  if(ts.isIdentifier(target)&&target.text==='image'){assert.equal(n.arguments.length,1);const v=expr(n.arguments[0],e);assert(v&&Number.isInteger(v.imageActionIndex));emits.push(v);return v;}
  if(ts.isPropertyAccessExpression(target)&&target.expression.getText(file)==='tools'){
   const method=target.name.text;assert(['exec_command','write_stdin','view_image','apply_patch'].includes(method),'Unsupported tool '+method);assert.equal(n.arguments.length,1);const args=expr(n.arguments[0],e);
   if(method==='apply_patch'){assert.equal(typeof args,'string');const token={method,args:{patch:args},index:actions.length};actions.push(token);return token;}
   const allow=method==='exec_command'?['cmd','yield_time_ms','max_output_tokens','tty','workdir','sandbox_permissions','justification']:method==='view_image'?['path','detail']:['session_id','chars','yield_time_ms','max_output_tokens'];assert(Object.keys(args).every(k=>allow.includes(k)));assert(args.sandbox_permissions!=='require_escalated','Unexpected model escalation');
   const token={method,args,index:actions.length};if(method==='view_image')token.image_url={imageActionIndex:token.index};actions.push(token);return token;
  }
  if(target.getText(file)==='JSON.stringify'){assert(n.arguments.length===1);return JSON.stringify(expr(n.arguments[0],e));}
  if(target.getText(file)==='ALL_TOOLS.filter'){
   assert.equal(n.arguments.length,1);assert.equal(n.arguments[0].getText(file),'x=>/resource_read|profile_create|tool.*search/.test(x.name)');inventoryExpressions.push({kind:'readonly-tool-name-metadata-filter',expressionSHA256:sha(n.getText(file))});return{inventoryToken:true};
  }
  if(target.getText(file)==='String.fromCharCode'){const a=n.arguments.map(x=>expr(x,e));assert.deepEqual(a,[10,4]);return String.fromCharCode(10,4);}
  if(ts.isPropertyAccessExpression(target)&&target.expression.getText(file)==='Promise'&&['all','allSettled'].includes(target.name.text)){assert(n.arguments.length===1);const a=expr(n.arguments[0],e);assert(Array.isArray(a));return target.name.text==='allSettled'?a.map(value=>({settled:value})):a;}
  if(ts.isPropertyAccessExpression(target)&&['map','forEach'].includes(target.name.text)){
   const a=expr(target.expression,e);assert(Array.isArray(a)&&a.length<=64&&n.arguments.length===1);const fn=n.arguments[0];
   if(target.name.text==='forEach'&&ts.isIdentifier(fn)&&fn.text==='text'){emits.push(...a);return undefined;}
   assert(ts.isArrowFunction(fn)&&fn.parameters.length===1&&ts.isIdentifier(fn.parameters[0].name)&&!ts.isBlock(fn.body));return a.map(v=>{const inner=new Map(e);inner.set(fn.parameters[0].name.text,v);return expr(fn.body,inner);});
  }
  throw Error('Unsupported finite call '+target.getText(file));
 }
 function stmt(n,e=env){
  if(ts.isEmptyStatement(n))return;
  if(ts.isVariableStatement(n)){assert(n.declarationList.flags&ts.NodeFlags.Const);for(const d of n.declarationList.declarations){assert(ts.isIdentifier(d.name)&&d.initializer&&!e.has(d.name.text));e.set(d.name.text,expr(d.initializer,e));}return;}
  if(ts.isExpressionStatement(n)){expr(n.expression,e);return;}
  if(ts.isForOfStatement(n)){assert(!n.awaitModifier&&ts.isVariableDeclarationList(n.initializer)&&n.initializer.declarations.length===1);const d=n.initializer.declarations[0];assert(ts.isIdentifier(d.name));const a=expr(n.expression,e);assert(Array.isArray(a)&&a.length<=64);for(const v of a){const inner=new Map(e);inner.set(d.name.text,v);stmt(n.statement,inner);}return;}
  if(ts.isBlock(n)){for(const c of n.statements)stmt(c,e);return;}
  throw Error('Unsupported finite statement '+ts.SyntaxKind[n.kind]);
 }
 for(const n of file.statements)stmt(n);assert(actions.length>0);return{actions,emits,inventoryExpressions};
}
function results(v){
 if(Array.isArray(v))return v.flatMap(results);
 assert(v&&typeof v==='object');if(v.status==='fulfilled')return results(v.value);assert(v.status!=='rejected','Actual nested tool rejected');
 assert(typeof v.output==='string'&&(Number.isInteger(v.exit_code)||Number.isInteger(v.session_id)),'Unknown actual tool output');return[v];
}
export async function audit(root,outDir){
 const rawBytes=await readFile(root+'/raw.json'),raw=JSON.parse(rawBytes),report={schema:'finite-full-native-outer-audit-v1',rawSHA256:sha(rawBytes),root,phases:[],modelCodeExecuted:false};
 for(const task of raw.tasks)for(const phase of task.phases){
  const bytes=await readFile(phase.nativeOriginal.path);assert.equal(sha(bytes),phase.nativeOriginal.sha256);const rows=bytes.toString().trim().split('\n').map(JSON.parse),meta=rows.find(x=>x.type==='session_meta').payload;assert.equal(meta.id,task.nativeSessionId);assert.equal(meta.cwd,task.cwd);assert.equal(meta.model_provider,'openai');
  const turn=phase.promptTurnId,after=Date.parse(phase.after),before=Date.parse(phase.completed?.at??phase.completedAt??phase.final?.at??phase.nativeOriginal.before??'2999-01-01'),calls=[],outputs=new Map(),metadataTruncations=[];
  let currentTurn;
  for(let i=0;i<rows.length;i++){
   const row=rows[i],p=row.payload??{};if(row.type==='event_msg'&&p.type==='task_started')currentTurn=p.turn_id??row.turn_id;
   if(currentTurn!==turn||Date.parse(row.timestamp)<after||Date.parse(row.timestamp)>before)continue;
   if(row.type==='response_item'&&p.type==='custom_tool_call'){assert.equal(p.name,'exec');calls.push({line:i+1,at:row.timestamp,callId:p.call_id,...interpret(p.input),inputSHA256:sha(p.input)});}
   else if(row.type==='response_item'&&p.type==='custom_tool_call_output'){
    assert(!outputs.has(p.call_id));const full=[];for(const [index,b]of p.output.entries()){if(index===0){assert.equal(b.type,'input_text');assert(/^Script completed\nWall time [0-9.]+ seconds\nOutput:\n$/.test(b.text));continue;}if(b.type==='input_image'){assert(typeof b.image_url==='string'&&b.image_url.startsWith('data:image/png;base64,'));const imageBytes=Buffer.from(b.image_url.slice('data:image/png;base64,'.length),'base64');assert(imageBytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));full.push({kind:'actual-native-image',sha256:sha(imageBytes),bytes:imageBytes.length});continue;}assert.equal(b.type,'input_text');
     if(b.text.startsWith('Warning: truncated output')){
      const call=calls.find(c=>c.callId===p.call_id);assert(call&&call.actions.length===1&&call.actions[0].method==='exec_command'&&call.actions[0].args.cmd==='willyou-app --list','Only known public declaration listing may use typed-primary truncation proof');
      const candidates=phase.typedCommands.filter(x=>x.line>call.line&&x.line<i+1&&x.item.command?.[2]==='willyou-app --list');assert.equal(candidates.length,1);const item=candidates[0];assert.equal(item.item.status,'completed');assert.equal(item.item.exit_code,0);assert(b.text.includes('"exit_code":0'));assert(item.item.aggregated_output.startsWith('{"unavailable":'));
      full.push({output:item.item.aggregated_output,exit_code:0,metadataTruncationPrimaryDerived:true});metadataTruncations.push({callId:p.call_id,outerOutputLine:i+1,outerFragmentSHA256:sha(b.text),typedLine:item.line,actualTypedExitCode:0,actualTypedOutputSHA256:sha(item.item.aggregated_output),fullMetadataContentObserved:false,boundary:'Public --list declaration metadata truncated in both outer/typed records. Only finite command execution and actual numeric0 are proved; native CLI line66 returns list without capabilities/call. No full metadata, Skill or business output completeness inferred.'});
     }else{
      const value=JSON.parse(b.text),call=calls.find(c=>c.callId===p.call_id);
      if(call?.inventoryExpressions.length&&Array.isArray(value)&&value.every(v=>v&&typeof v.name==='string'&&typeof v.description==='string'&&Object.keys(v).every(k=>['name','description'].includes(k)))){call.inventoryOutputObserved=(call.inventoryOutputObserved??0)+1;call.inventoryOutputSHA256=sha(b.text);}
      else if(call?.actions.length===1&&call.actions[0].method==='apply_patch'){assert.deepEqual(value,{});full.push({kind:'actual-patch-empty-success-output'});}
      else full.push(...results(value));
     }}outputs.set(p.call_id,{line:i+1,full});
   }else if(row.type==='response_item'&&['function_call','function_call_output'].includes(p.type))throw Error('Unreviewed non-exec outer');
  }
  assert.equal(calls.length,outputs.size);assert(calls.length>0);const operations=[],typed=phase.typedCommands,skillReads=[],sessionMap=new Map(),stdinProofs=[],images=[],localReports=[];
  for(const c of calls){const output=outputs.get(c.callId);assert(output&&output.line>c.line);assert.equal(c.inventoryExpressions.length,c.inventoryOutputObserved??0);assert.equal(output.full.length,c.actions.length,'Exhaustive children and actual outputs');for(let k=0;k<c.actions.length;k++){
   const a=c.actions[k],v=output.full[k];assert(v.exit_code===undefined||Number.isInteger(v.exit_code));
   if(a.method==='apply_patch'){assert.equal(v.kind,'actual-patch-empty-success-output');const lines=a.args.patch.split('\n');assert.equal(lines.shift(),'*** Begin Patch');assert.equal(lines.pop(),'*** End Patch');const header=lines.shift();assert(header.startsWith('*** Add File: '));const path=header.slice('*** Add File: '.length);assert(path.startsWith(task.cwd+'/evidence/')&&path.endsWith('/report.md')&&!path.includes('/../'));assert(lines.every(x=>x.startsWith('+')));const expected=lines.map(x=>x.slice(1)).join('\n')+'\n',actual=await readFile(path,'utf8');assert.equal(actual,expected);localReports.push({path,sha256:sha(actual),literalAddOnly:true,actualFileMatchesPatch:true});}
   else if(a.method==='view_image'){assert(a.args.path.startsWith(task.cwd+'/'));assert.equal(v.kind,'actual-native-image');const source=await readFile(a.args.path);assert(source.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));images.push({path:a.args.path,sourceSHA256:sha(source),nativeImageSHA256:v.sha256,exactBytes:sha(source)===v.sha256,actualImageDelivered:true});}
   else if(a.method==='exec_command'){
    assert(typeof a.args.cmd==='string');const candidates=typed.filter(x=>x.item.command?.length===3&&x.item.command[2]===a.args.cmd&&x.line>c.line&&(x.line<output.line||v.exit_code===undefined));assert.equal(candidates.length,1,'Exact actual typed command binding');const item=candidates[0];assert.equal(item.threadId,task.nativeSessionId);assert.equal(item.turnId,turn);assert.equal(new URL(item.item.cwd).pathname,task.cwd);
    if(v.exit_code!==undefined){assert.equal(item.item.exit_code,v.exit_code);assert.equal(item.item.status,v.exit_code===0?'completed':'failed');}
    else{assert(Number.isInteger(v.session_id));sessionMap.set(v.session_id,{action:a,call:c,typed:item,output:v});}
    const cat=/^cat ((?:'[^'\r\n]+'|[A-Za-z0-9_./-]+)(?:[ \t]+(?:'[^'\r\n]+'|[A-Za-z0-9_./-]+))*)$/.exec(a.args.cmd);
    if(cat){const paths=[...cat[1].matchAll(/'([^']+)'|([^ \t]+)/g)].map(m=>m[1]??m[2]),skills=paths.map(path=>task.deliveredSkills.find(s=>s.path===path));if(skills.every(Boolean)){const content=skills.map(s=>s.content).join('');assert.equal(item.item.aggregated_output,content);assert.equal(v.output,content);for(const skill of skills){assert.equal(sha(skill.content),skill.sha256);skillReads.push({skillId:skill.skillId,sha256:skill.sha256,fullContent:true,actualExitCode:item.item.exit_code,typedLine:item.line});}}}
    const text=item.item.aggregated_output.trim();let value;try{value=JSON.parse(text)}catch{}
    if(value?.schema==='willyou-app-result-v2'){
     assert.equal(value.status,'ok');assert.deepEqual(value.completeness,{missing:[],complete:true});assert.equal(item.item.exit_code,0);if(v.exit_code!==undefined)assert.deepEqual(JSON.parse(v.output),value,'Complete business CLI output must reach actual outer response');const op=value.operation;const host=phase.host.filter(h=>h.operation_id===op.id&&h.request_id===op.requestId);assert.equal(host.length,1);const h=host[0];assert.equal(h.task_id,task.taskId);assert.equal(h.run_id,task.runId);assert.equal(h.project_id,task.projectId);assert.equal(h.tool_name,value.capabilityId);assert.equal(h.package_hash,value.source.packageHash);assert.equal(h.state,'succeeded');assert.equal(h.attempt_count,1);operations.push({operationId:op.id,requestId:op.requestId,capabilityId:value.capabilityId,typedLine:item.line,actualExitCode:0});
    }
   }else{
    const chain=sessionMap.get(a.args.session_id);assert(chain,'Actual non-live/unbound stdin session');const chars=a.args.chars??'';
    if(chars){assert(!chain.delivered);const secret=task.key==='T124-main'?'Qa2-Pass-1':'Qa-Pass-1';assert.equal(chars,secret+'\n\x04');assert.equal(chain.action.args.tty,true);assert(/^stty -echo; cat \| willyou-app browser fill --element '[^']+' --stdin value; result=\$\?; stty echo; exit \$result$/.test(chain.action.args.cmd));assert(calls.every(c=>c.actions.every(a=>a.method!=='exec_command'||!a.args.cmd.includes(secret))));assert.equal(v.exit_code,0);assert.equal(chain.typed.item.exit_code,0);assert.equal(chain.typed.item.status,'completed');const value=JSON.parse(v.output),h=phase.host.filter(x=>x.operation_id===value.operation.id&&x.request_id===value.operation.requestId);assert.equal(h.length,1);assert.equal(h[0].tool_name,'browser.interact.fill');assert.equal(h[0].state,'succeeded');stdinProofs.push({fixtureSecretExact:true,singleDelivery:true,valuePublished:false,originCallId:chain.call.callId,deliveryCallId:c.callId,sessionId:a.args.session_id,actualExitCode:0,operationId:value.operation.id,requestId:value.operation.requestId,typedLine:chain.typed.line});chain.delivered=true;}
   }
  }}
  const contexts=rows.filter(x=>x.type==='turn_context'&&x.payload.turn_id===turn).map(x=>x.payload);assert(contexts.length&&contexts.every(c=>c.cwd===task.cwd&&c.model==='gpt-6.1-sol'&&c.approval_policy==='on-request'&&c.sandbox_policy.type==='workspace-write'));
  report.phases.push({taskKey:task.key,key:phase.key,nativeSessionId:task.nativeSessionId,turnId:turn,sourceSHA256:sha(bytes),outerCalls:calls.length,outerOutputs:outputs.size,children:calls.reduce((n,c)=>n+c.actions.length,0),fullCoverage:true,metadataTruncations,images,localReports,skillReads,stdinProofs,operations,knownOriginalUnsupportedCounts:phase.journals.map(j=>({calls:j.unsupportedCarriers.length,outputs:j.unsupportedOutputs.length})),noArbitraryCodeEvaluation:true,contexts:contexts.map(c=>({model:c.model,approval:c.approval_policy,sandbox:c.sandbox_policy.type}))});
 }
 await mkdir(outDir,{recursive:true});await writeFile(outDir+'/finite-audit.safe.json',JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]==='/private/tmp/m12-finite-native-audit.mjs'){const r=await audit(process.argv[2],process.argv[3]);console.log(JSON.stringify({phases:r.phases.length,fullCoverage:r.phases.every(x=>x.fullCoverage),skillReads:r.phases.reduce((n,x)=>n+x.skillReads.length,0),stdinProofs:r.phases.reduce((n,x)=>n+x.stdinProofs.length,0)}));}

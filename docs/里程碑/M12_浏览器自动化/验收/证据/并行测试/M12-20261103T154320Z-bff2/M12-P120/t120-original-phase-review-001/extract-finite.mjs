// Read-only finite AST reduction of this actual prefix. Model JS is never evaluated.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from '/private/tmp/willyou-m12-t120-t125-app022-retest-001/node_modules/typescript/lib/typescript.js';
const ROOT='/private/tmp/willyou-m12-t120-original-phase-review-001', OLD='/private/tmp/willyou-m12-t120-t125-app022-retest-001';
assert.equal(process.env.WILLYOU_TEST_CACHE_DIR,ROOT+'/cache');
const sha=x=>createHash('sha256').update(x).digest('hex'), raw=JSON.parse(await readFile(OLD+'/raw.private.json')), c=raw.cases[0].phases[0], source=c.nativeSnapshotsBeforeStop[0], bytes=await readFile(source.path);
assert.equal(sha(bytes),'8c28fe86436dc3deeb5e98babb0fd3a822d82a5373c9f6852a2f23e6987c7894');
const rows=bytes.toString().split('\n').filter(Boolean).map((x,i)=>({row:JSON.parse(x),line:i+1}));
function literal(n,env){
 if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text;
 if(ts.isNumericLiteral(n))return Number(n.text);
 if(n.kind===ts.SyntaxKind.TrueKeyword)return true;if(n.kind===ts.SyntaxKind.FalseKeyword)return false;if(n.kind===ts.SyntaxKind.NullKeyword)return null;
 if(ts.isIdentifier(n)){assert(env.has(n.text),'Unbound static literal '+n.text);return env.get(n.text);}
 if(ts.isArrayLiteralExpression(n))return n.elements.flatMap(x=>ts.isSpreadElement(x)?literal(x.expression,env):[literal(x,env)]);
 if(ts.isObjectLiteralExpression(n))return Object.fromEntries(n.properties.map(p=>{assert(!ts.isComputedPropertyName(p.name));if(ts.isShorthandPropertyAssignment(p))return[p.name.text,literal(p.name,env)];assert(ts.isPropertyAssignment(p));return[p.name.text,literal(p.initializer,env)];}));
 if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken){const a=literal(n.left,env),b=literal(n.right,env);assert(typeof a==='string'&&typeof b==='string');return a+b;}
 if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='map'){
  const a=literal(n.expression.expression,env),f=n.arguments[0];assert(Array.isArray(a)&&ts.isArrowFunction(f)&&f.parameters.length===1&&ts.isIdentifier(f.parameters[0].name)&&!ts.isBlock(f.body));
  return a.map(v=>literal(f.body,new Map([...env,[f.parameters[0].name.text,v]])));
 }
 if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='join'){
  const a=literal(n.expression.expression,env),d=literal(n.arguments[0],env);assert(Array.isArray(a)&&a.every(x=>typeof x==='string')&&typeof d==='string');return a.join(d);
 }
 throw Error('Not a finite literal: '+ts.SyntaxKind[n.kind]);
}
const list=[];
for(const item of rows){
 const p=item.row.payload;if(item.row.type!=='response_item'||!['custom_tool_call','function_call'].includes(p?.type))continue;
 const outs=rows.filter(x=>x.row.type==='response_item'&&['custom_tool_call_output','function_call_output'].includes(x.row.payload?.type)&&x.row.payload.call_id===p.call_id);assert.equal(outs.length,1);assert(item.line<outs[0].line);
 const calls=[],metadata=[],env=new Map();let f;
 if(p.type==='custom_tool_call'){
  assert.equal(p.name,'exec');f=ts.createSourceFile('actual.js',p.input,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(f.parseDiagnostics.length,0);
  for(const st of f.statements)if(ts.isVariableStatement(st))for(const d of st.declarationList.declarations)if(ts.isIdentifier(d.name)&&d.initializer){try{env.set(d.name.text,literal(d.initializer,env));}catch{}}
  function scan(n,e){
   if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)){
    if(ts.isIdentifier(n.expression.expression)&&n.expression.expression.text==='tools'){
     assert(['exec_command','apply_patch','view_image'].includes(n.expression.name.text));assert.equal(n.arguments.length,1);
     calls.push({tool:n.expression.name.text,parameters:literal(n.arguments[0],e),sourceSpan:{start:n.pos,end:n.end}});return;
    }
    if(n.expression.name.text==='map'){
     let a;try{a=literal(n.expression.expression,e)}catch{}
     const fn=n.arguments[0];if(Array.isArray(a)&&ts.isArrowFunction(fn)&&fn.parameters.length===1&&ts.isIdentifier(fn.parameters[0].name)){
      for(const v of a)scan(fn.body,new Map([...e,[fn.parameters[0].name.text,v]]));return;
     }
    }
   }
   ts.forEachChild(n,x=>scan(x,e));
  }
  scan(f,env);
 }else {assert(['exec_command','write_stdin'].includes(p.name));calls.push({tool:p.name,parameters:JSON.parse(p.arguments)});}
 const output=outs[0].row.payload.output;assert(Array.isArray(output)&&output[0]?.type==='input_text'&&/^Script completed\nWall time [0-9.]+ seconds\nOutput:\n$/.test(output[0].text));
 const results=[],truncated=output.slice(1).some(b=>b.type==='input_text'&&b.text.startsWith('Warning: truncated output'));
 if(!truncated){let pos=0;
  for(let bi=1;bi<output.length;bi++){
   const block=output[bi],call=calls[pos];
   if(!call){assert.equal(block.type,'input_text');const x=JSON.parse(block.text);assert(Array.isArray(x)&&x.every(y=>y&&typeof y==='object'&&Object.keys(y).every(k=>['name','description'].includes(k))));metadata.push({block:bi,kind:'readonly-tool-inventory-not-business'});continue;}
   if(call.tool==='view_image'){assert.equal(block.type,'input_image');results.push({toolIndex:pos,block:bi,kind:'image-observer'});pos++;continue;}
   assert.equal(block.type,'input_text');let value=JSON.parse(block.text),wrapper='direct';
   if(call.tool==='apply_patch'){assert.deepEqual(value,{});results.push({toolIndex:pos,block:bi,kind:'literal-local-patch',childExitCodeObserved:null});pos++;continue;}
   if(Object.hasOwn(value,'path')){assert.deepEqual(Object.keys(value),['path','result']);assert.equal(call.parameters.cmd,'cat '+value.path);assert.equal(value.result.status,'fulfilled');value=value.result.value;wrapper='path-and-settled-result';}
   else if(Object.hasOwn(value,'i')){assert.equal(value.i,pos);if(Object.hasOwn(value,'result')){assert.deepEqual(Object.keys(value),['i','result']);assert.equal(value.result.status,'fulfilled');value=value.result.value;}else{assert.equal(value.status,'fulfilled');value=value.value;}wrapper='exact-index-settled-result';}
   assert(value&&typeof value==='object'&&Number.isInteger(value.exit_code)&&typeof value.output==='string'&&!value.session_id);assert(Object.keys(value).every(k=>['chunk_id','wall_time_seconds','exit_code','original_token_count','output'].includes(k)));
   results.push({toolIndex:pos,block:bi,wrapper,blockSha256:sha(block.text),outerProcessExitCodeObserved:value.exit_code,stdout:value.output});pos++;
  }
  assert.equal(pos,calls.length);
 }
 list.push({callId:p.call_id,requestLine:item.line,outputLine:outs[0].line,requestAt:item.row.timestamp,outputAt:outs[0].row.timestamp,inputSha256:sha(p.input??p.arguments),outputSha256:sha(JSON.stringify(output)),calls,results,metadata,truncated});
}
await writeFile(ROOT+'/finite-extracted.private.json',JSON.stringify({source,entries:list},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({outerPairs:list.length,toolArgumentsStaticallyReduced:list.reduce((n,x)=>n+x.calls.length,0),truncatedRetained:list.filter(x=>x.truncated).map(x=>({callId:x.callId,requestLine:x.requestLine,outputLine:x.outputLine})),modelCodeExecuted:false}));

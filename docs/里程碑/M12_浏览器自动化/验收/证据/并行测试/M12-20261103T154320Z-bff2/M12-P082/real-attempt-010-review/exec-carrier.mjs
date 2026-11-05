// Pure Codex journal decoding. AST only: model JavaScript is never evaluated.
import assert from 'node:assert/strict';
import ts from 'typescript';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
function literal(node){
 if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
 if(ts.isNumericLiteral(node)){const value=Number(node.text);assert(Number.isFinite(value));return value}
 if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
 if(ts.isArrayLiteralExpression(node))return node.elements.map(literal);
 if(ts.isObjectLiteralExpression(node)){const out={};for(const p of node.properties){assert(ts.isPropertyAssignment(p)&&!ts.isComputedPropertyName(p.name),'No spread/getter/computed/shorthand model parameters');assert(ts.isIdentifier(p.name)||ts.isStringLiteral(p.name));const key=p.name.text;assert(!['__proto__','constructor','prototype'].includes(key)&&!own(out,key));out[key]=literal(p.initializer)}return out}
 throw Error('Nonliteral model expression is not statically attributable');
}
export function parseCustomExecInput({name,input}){
 assert.equal(name,'exec','Only observed Codex custom exec carrier');assert(typeof input==='string'&&Buffer.byteLength(input)<=262144);
 const sf=ts.createSourceFile('model-input.js',input,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(sf.parseDiagnostics.length,0);assert.equal(sf.statements.length,2,'Require a single literal exec_command plus direct text(result.output)');
 const first=sf.statements[0];assert(ts.isVariableStatement(first)&&(first.declarationList.flags&ts.NodeFlags.Const));assert.equal(first.declarationList.declarations.length,1);const declaration=first.declarationList.declarations[0];assert(ts.isIdentifier(declaration.name)&&declaration.initializer&&ts.isAwaitExpression(declaration.initializer));const call=declaration.initializer.expression;
 assert(ts.isCallExpression(call)&&ts.isPropertyAccessExpression(call.expression));assert(ts.isIdentifier(call.expression.expression)&&call.expression.expression.text==='tools'&&call.expression.name.text==='exec_command');assert.equal(call.arguments.length,1);assert(ts.isObjectLiteralExpression(call.arguments[0]));const parameters=literal(call.arguments[0]);assert(typeof parameters.cmd==='string');
 const second=sf.statements[1];assert(ts.isExpressionStatement(second)&&ts.isCallExpression(second.expression));const print=second.expression;assert(ts.isIdentifier(print.expression)&&print.expression.text==='text');assert.equal(print.arguments.length,1);const output=print.arguments[0];assert(ts.isPropertyAccessExpression(output)&&ts.isIdentifier(output.expression)&&output.expression.text===declaration.name.text&&output.name.text==='output','Only direct original result.output is attributable');
 return{command:parameters.cmd,parameters,sourceKind:'custom-exec-ast',inputSha256:sha(input),binding:declaration.name.text,forwardedField:'output',childExitCodeObserved:null,astContract:'const result=await tools.exec_command(literalObject);text(result.output);'};
}
export function decodeToolRequest(payload){
 assert(typeof payload.call_id==='string'&&payload.call_id);
 if(payload.type==='custom_tool_call')return{...parseCustomExecInput(payload),callId:payload.call_id,name:payload.name,requestType:payload.type};
 assert.equal(payload.type,'function_call');assert(typeof payload.arguments==='string');const parameters=JSON.parse(payload.arguments);assert(parameters&&typeof parameters==='object'&&!Array.isArray(parameters));const command=['cmd','command','code'].map(k=>parameters[k]).find(v=>typeof v==='string')??null;
 return{command,parameters,sourceKind:'function-call-json',inputSha256:sha(payload.arguments),callId:payload.call_id,name:payload.name,requestType:payload.type};
}
export function decodeToolOutput(payload,request){
 assert.equal(payload.call_id,request.callId,'Original outer call_id pairing');
 if(request.requestType==='custom_tool_call'){
  assert.equal(payload.type,'custom_tool_call_output');assert(Array.isArray(payload.output)&&payload.output.length===2,'Observed custom exec metadata+one forwarded stdout block');
  for(const block of payload.output)assert(block?.type==='input_text'&&typeof block.text==='string');
  const metadata=payload.output[0].text,stdout=payload.output[1].text,completed=/^Script completed\nWall time [0-9]+(?:\.[0-9]+)? seconds\nOutput:\n$/.test(metadata);
  return{stdout,outputSha256:sha(JSON.stringify(payload.output)),carrierMetadataSha256:sha(metadata),carrierKind:'custom-exec-input_text-pair',outerCompleted:completed,childExitCodeObserved:null,exitEvidence:'Not printed: text(result.output) omits nested tool exit_code. Do not infer numeric child exit from Script completed.'};
 }
 assert.equal(payload.type,'function_call_output');const stdout=typeof payload.output==='string'?payload.output:JSON.stringify(payload.output),match=/Process exited with code (\d+)/.exec(stdout);
 return{stdout,outputSha256:sha(typeof payload.output==='string'?payload.output:JSON.stringify(payload.output)),carrierKind:'legacy-function-call-output',outerCompleted:match!==null,childExitCodeObserved:match?Number(match[1]):null,exitEvidence:match?'Observed legacy tool-rendered exit code':'Unobserved legacy exit code'};
}
export function decodeToolPair({requestRow,outputRow,source,requestSource=source,outputSource=source,requestLine,outputLine}){
 assert.equal(requestSource,source);assert.equal(outputSource,source);assert(requestRow.type==='response_item'&&outputRow.type==='response_item');assert(Number.isInteger(requestLine)&&Number.isInteger(outputLine)&&requestLine<outputLine);assert(Number.isFinite(Date.parse(requestRow.timestamp))&&Number.isFinite(Date.parse(outputRow.timestamp))&&Date.parse(requestRow.timestamp)<=Date.parse(outputRow.timestamp));const request=decodeToolRequest(requestRow.payload),output=decodeToolOutput(outputRow.payload,request);
 return{source,requestLine,outputLine,at:outputRow.timestamp,requestedAt:requestRow.timestamp,request,output};
}
export function jsonObjects(text){
 assert(typeof text==='string'&&Buffer.byteLength(text)<=32*1024*1024);const out=[];
 for(let start=0;start<text.length;start++){if(text[start]!=='{')continue;let depth=0,quoted=false,escaped=false;for(let i=start;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}if(c==='"'){quoted=true;continue}if(c==='{')depth++;else if(c==='}'&&--depth===0){try{out.push(JSON.parse(text.slice(start,i+1)))}catch{}start=i;break}}}return out;
}

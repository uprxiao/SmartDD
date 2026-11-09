// Finite actual tool carriers, never evaluate model JS or invent child exit.
import assert from 'node:assert/strict';
import {decodeToolPair} from './exec-carrier.mjs';
export function execOutput({call,output,source='runtime-observation',requestedAt,at}){
 const pair=decodeToolPair({requestRow:{type:'response_item',timestamp:requestedAt,payload:call},outputRow:{type:'response_item',timestamp:at,payload:output},source,requestLine:1,outputLine:2});
 assert.equal(pair.invocations.length,1);const v=pair.invocations[0].output;
 if(v.carrierKind==='custom-sequential-full-result')return{ongoing:!!v.runningSession,sessionId:v.runningSession??null,exitCode:v.childExitCodeObserved,stdout:v.stdout,carrier:v.carrierKind};
 assert.equal(v.carrierKind,'legacy-function-call-output');const text=v.stdout;
 let m=/^Chunk ID: ([a-f0-9]{6,64})\nWall time: ([0-9]+(?:\.[0-9]+)?) seconds\nProcess running with session ID ([0-9]+)\nOriginal token count: ([0-9]+)\nOutput:\n/.exec(text);
 if(m)return{ongoing:true,sessionId:Number(m[3]),exitCode:null,stdout:text.slice(m[0].length),carrier:'legacy-running'};
 m=/^Chunk ID: ([a-f0-9]{6,64})\nWall time: ([0-9]+(?:\.[0-9]+)?) seconds\nProcess exited with code (-?[0-9]+)\nOriginal token count: ([0-9]+)\nOutput:\n/.exec(text);assert(m,'Unverified exec terminal/running format');assert.equal(v.childExitCodeObserved,Number(m[3]));
 return{ongoing:false,sessionId:null,exitCode:Number(m[3]),stdout:text.slice(m[0].length),carrier:'legacy-terminal'};
}
export function cliEnvelope(text){let code=null,position=null;const head=/^willyou-app: ([A-Z][A-Z0-9_]{0,63})\n/.exec(text);if(head){code=head[1];position='before';text=text.slice(head[0].length);}else{const tail=/\nwillyou-app: ([A-Z][A-Z0-9_]{0,63})\n?$/.exec(text);if(tail){code=tail[1];position='after';text=text.slice(0,tail.index);}}const value=JSON.parse(text.trim());assert(value&&typeof value==='object'&&!Array.isArray(value));if(code)assert.equal(value.error?.code,code);return{value,diagnosticCode:code,diagnosticPosition:position};}
export function mcpEnvelope(output){let v=output;
 if(Array.isArray(v)){assert.equal(v.length,1);assert(['text','input_text'].includes(v[0].type));assert.equal(typeof v[0].text,'string');v=v[0].text;}
 if(typeof v==='string')v=JSON.parse(v);
 assert(v&&typeof v==='object'&&!Array.isArray(v));
 if(v.schema==='willyou-app-result-v2'||v.error)return v;
 assert(Array.isArray(v.content),'Unverified MCP output carrier');assert(Object.keys(v).every(k=>['content','structuredContent','structured_content','isError','_meta'].includes(k)));assert.equal(v.content.length,1);assert.equal(v.content[0].type,'text');const text=JSON.parse(v.content[0].text);const structured=v.structuredContent??v.structured_content;if(structured)assert.deepEqual(structured,text);assert(text?.schema==='willyou-app-result-v2'||text?.error);return text;
}

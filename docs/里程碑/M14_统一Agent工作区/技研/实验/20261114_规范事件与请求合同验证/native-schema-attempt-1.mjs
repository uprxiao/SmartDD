import Ajv from '/private/tmp/willyou-m14-global-f3zh527k/node_modules/ajv/dist/ajv.js';
import addFormats from '/private/tmp/willyou-m14-global-f3zh527k/node_modules/ajv-formats/dist/index.js';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root='/private/tmp/willyou-m14-contract-probe',schemaRoot='/private/tmp/willyou-m14-global-f3zh527k/codex-schema';
const ajv=new Ajv({strict:false,allErrors:true,allowUnionTypes:true});addFormats(ajv);
for(const format of ['uint','uint32','uint64','int32','int64','double','float'])ajv.addFormat(format,{type:'number',validate:x=>Number.isFinite(x)});
const validators=new Map(),used=new Map();
function validate(name,data){if(!validators.has(name)){const raw=readFileSync(join(schemaRoot,name+'.json'),'utf8');used.set(name,raw);validators.set(name,ajv.compile(JSON.parse(raw)));}const fn=validators.get(name);assert(fn(data),JSON.stringify({name,errors:fn.errors}));}
const frames=JSON.parse(readFileSync(join(root,'codex-frames.json')));let nativeNotifications=0;
for(const f of frames){if(f.method){validate('ServerNotification',f);nativeNotifications++;}}
const amendment={acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}};
const cases=[
 ['CommandExecutionRequestApprovalParams',{threadId:'t',turnId:'turn',itemId:'command',startedAtMs:1,kind:'command',availableDecisions:['accept','acceptForSession',amend,'decline','cancel'],command:'git status'}],
 ['CommandExecutionRequestApprovalResponse',{decision:amend}],
 ['CommandExecutionRequestApprovalResponse',{decision:'acceptForSession'}],
 ['ToolRequestUserInputParams',{threadId:'t',turnId:'turn',itemId:'input',isBlocking:false,questions:[{id:'q',header:'Choice',question:'Pick',options:[{label:'A',description:'Choice A'}]},{id:'secret',header:'Secret',question:'Synthetic secret',isSecret:true,options:null}]}],
 ['ToolRequestUserInputResponse',{answers:{q:{answers:['A']},secret:{answers:['FAKE_SECRET_123']}}}],
 ['McpServerElicitationRequestParams',{threadId:'t',turnId:null,serverName:'fixture',mode:'form',message:'Form',requestedSchema:{type:'object',properties:{count:{type:'integer',minimum:1,maximum:3},flag:{type:'boolean'}},required:['count','flag']}}],
 ['McpServerElicitationRequestResponse',{action:'accept',content:{count:2,flag:false}}],
 ['McpServerElicitationRequestParams',{threadId:'t',turnId:null,serverName:'fixture',mode:'url',message:'Auth',url:'https://example.invalid/auth',elicitationId:'e'}],
 ['McpServerElicitationRequestParams',{threadId:'t',turnId:null,serverName:'fixture',mode:'openai/userVerification',challenge:'fixture',description:'device proof',title:'Verify'}],
 ['McpServerElicitationRequestParams',{threadId:'t',serverName:'fixture',mode:'form',message:'Array',requestedSchema:{type:'object',properties:{tags:{type:'array',items:{type:'string',enum:['A','B']},minItems:1}},required:['tags']}}],
];
for(const [name,data] of cases)validate(name,data);
writeFileSync(join(root,'native-schema-result.json'),JSON.stringify({nativeNotificationsValidated:nativeNotifications,generatedFixtureCases:cases.length,fixtures:cases.map(([schema,value])=>({schema,value})),schemas:[...used.keys()],strict:false,numericFormatCheck:'finite only; all supplied identifiers and counters small safe integers',scope:'Schema compatibility only, not actual interactive native calls'},null,2)+'\n');
console.log(JSON.stringify({nativeNotifications,cases:cases.length}));

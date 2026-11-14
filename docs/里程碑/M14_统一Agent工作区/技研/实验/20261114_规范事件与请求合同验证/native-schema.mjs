import Ajv from '/private/tmp/willyou-m14-global-f3zh527k/node_modules/ajv/dist/ajv.js';
import addFormats from '/private/tmp/willyou-m14-global-f3zh527k/node_modules/ajv-formats/dist/index.js';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root='/private/tmp/willyou-m14-contract-probe',schemaRoot=join(root,'codex-schema-experimental');
const ajv=new Ajv({strict:false,allErrors:true,allowUnionTypes:true});addFormats(ajv);
for(const format of ['uint','uint16','uint32','uint64','int32','int64','double','float'])ajv.addFormat(format,{type:'number',validate:x=>{
 if(['double','float'].includes(format))return Number.isFinite(x);
 if(!Number.isSafeInteger(x))return false;
 if(format.startsWith('u')&&x<0)return false;
 if(format==='uint16')return x<=65535;
 if(format==='uint32')return x<=4294967295;
 if(format==='int32')return x>=-2147483648&&x<=2147483647;
 return true;
}});
const validators=new Map(),used=new Map();
function validate(name,data){if(!validators.has(name)){const raw=readFileSync(join(schemaRoot,name+'.json'),'utf8');used.set(name,raw);validators.set(name,ajv.compile(JSON.parse(raw)));}const fn=validators.get(name);if(!fn(data)){writeFileSync(join(root,'native-schema-failure.json'),JSON.stringify({name,data,errors:fn.errors},null,2));throw new Error('Schema mismatch: '+name+' '+(data.method||data.mode||''));}}
const frames=JSON.parse(readFileSync(join(root,'codex-frames.json')));let nativeNotifications=0;
const internal={'rawResponse/completed':'v2/RawResponseCompletedNotification','rawResponseItem/completed':'v2/RawResponseItemCompletedNotification'};
for(const f of frames){if(f.method){if(internal[f.method])validate(internal[f.method],f.params);else validate('ServerNotification',f);nativeNotifications++;}}
const amendment={acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}};
const cases=[
 ['CommandExecutionRequestApprovalParams',{threadId:'t',turnId:'turn',itemId:'command',startedAtMs:1,kind:'command',availableDecisions:['accept','acceptForSession',amendment,'decline','cancel'],command:'git status'}],
 ['CommandExecutionRequestApprovalResponse',{decision:amendment}],
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
const standard=JSON.parse(readFileSync('/private/tmp/willyou-m14-global-f3zh527k/codex-schema/ServerNotification.json'));
const known=new Set(standard.oneOf.map(x=>x.properties.method.enum[0]));
writeFileSync(join(root,'native-schema-result.json'),JSON.stringify({nativeNotificationsValidated:nativeNotifications,generatedFixtureCases:cases.length,fixtures:cases.map(([schema,value])=>({schema,value})),schemas:[...used.keys()],strict:false,numericFormatCheck:'finite floats; safe-integer bounds including uint16/uint32/int32',standardSchemaMissingObservedMethods:[...new Set(frames.filter(x=>x.method&&!known.has(x.method)).map(x=>x.method))],scope:'Schema compatibility only, not actual interactive native calls'},null,2)+'\n');
console.log(JSON.stringify({nativeNotifications,cases:cases.length}));

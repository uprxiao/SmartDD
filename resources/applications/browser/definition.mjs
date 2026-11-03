import {browserOutputSchema} from './output-schemas.mjs';
import commands from '../../../src/shared/browser-s1-commands.json' with {type:'json'};

// S1 is a partial package. S3 adds the remaining commands from the canonical map generator.
export function browserDefinition(runtime,resultEnvelope){
 const field={limit:{type:'integer',minimum:1},text:{type:['string','number','boolean'],maxLength:262144},boolean:{type:'boolean'},format:{type:'string',enum:['png','jpeg']},load:{type:'string',enum:['load','domcontentloaded','networkidle']},state:{type:'string',enum:['visible','hidden']},timeout:{type:'integer',minimum:1,maximum:90000}};
 return{schema:'smartdd-app-package-v2',appId:'browser',version:'0.1.0',displayName:'浏览器',description:'M12 S1基础链路；只包含门槛验证需要的命令，其他能力在后续批次开放。',hostApi:{min:1,max:1},dataApi:1,runtime,module:{id:'browser',contractMajor:1},entry:'cli',connectionContracts:[],connectionSchemas:{},connectionSlots:[],permissions:['browser.read','browser.write'],migrations:[],skills:[{id:'browser',path:'skills/browser',entry:'skills/browser/SKILL.md',description:'经CLI使用本任务的内置浏览器，引用失效时重新观察，未知结果先查询回执。',template:true}],capabilities:commands.map(command=>{
  const policy={id:command.id,contractMajor:2,title:command.command.join(' '),semantics:command.semantics,permission:'browser.'+command.semantics,slots:{required:[],conditional:[]},retry:command.semantics==='read'?'safe-read':'never',...(command.semantics==='write'?{protection:{kind:'operation-receipt',object:'browser_operation',key:'requestId'}}:{}),binding:{cli:{command:command.command}}};
  return{...policy,input:{type:'object',properties:Object.fromEntries(Object.entries(command.fields).map(([name,type])=>[name,field[type]])),required:command.required,additionalProperties:false},output:resultEnvelope('browser',policy,browserOutputSchema(command)),description:policy.title};
 })};
}

import {browserOutputSchema} from './output-schemas.mjs';
import commands from '../../../src/shared/browser-commands.generated.json' with {type:'json'};

export function browserDefinition(runtime,resultEnvelope){
 return{schema:'smartdd-app-package-v2',appId:'browser',version:'0.1.2',displayName:'浏览器',description:'经CLI使用本任务的内置浏览器。',hostApi:{min:1,max:1},dataApi:1,runtime,module:{id:'browser',contractMajor:1},entry:'cli',connectionContracts:[],connectionSchemas:{},connectionSlots:[],permissions:['browser.read','browser.write'],migrations:[],skills:[{id:'browser',path:'skills/browser',entry:'skills/browser/SKILL.md',description:'经CLI使用本任务的内置浏览器，引用失效时重新观察，未知结果先查询回执。',template:true},{id:'reproduce-bug',path:'skills/reproduce-bug',entry:'skills/reproduce-bug/SKILL.md',description:'按用户提供的Bug复现、修复后在同一登录态验证并报告证据；通过本会话禅道Skill读取Bug，未提供时向用户确认环境和账号。',template:true}],capabilities:commands.map(command=>{
  const policy={id:command.id,contractMajor:2,title:command.command.join(' '),semantics:command.semantics,permission:'browser.'+command.semantics,slots:{required:[],conditional:[]},retry:command.semantics==='read'?'safe-read':'never',...(command.semantics==='write'?{protection:{kind:'operation-receipt',object:'browser_operation',key:'requestId'}}:{}),binding:{cli:{command:command.command}}};
  return{...policy,input:command.input,output:resultEnvelope('browser',policy,browserOutputSchema(command)),description:policy.title};
 })};
}

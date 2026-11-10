// 补验 B7（审核二 F07-A3）第 2 步：恢复模型解析器＋最小可复判夹具。
// 夹具 b7-fixture-min.jsonl 由 b7-gen-session.mjs 用 Claude 2.1.322 真实生成（原始全文 137157 字节，SHA256 0e8e8ec1…cdfcc，
// 含系统提示快照未入库），仅保留 user／assistant／model attachment 行。派生变体只在真实行基础上追加，不改原行。
import {readFileSync} from 'node:fs';
export function resumeModelClaude(lines){
 const recs=lines.map(l=>typeof l==='string'?JSON.parse(l):l);
 for(let i=recs.length-1;i>=0;i--){const o=recs[i];if(o.type!=='assistant'||o.isSidechain===true||o.isApiErrorMessage===true)continue;if(typeof o.requestedModel==='string'&&o.requestedModel)return {model:o.requestedModel,source:'assistant.requestedModel',line:i};}
 for(let i=recs.length-1;i>=0;i--){const o=recs[i];if(o.isSidechain===true)continue;const id=o.type==='attachment'&&o.attachment?.type==='model'?o.attachment.identity?.modelId:null;if(id)return {model:id,source:'attachment.identity.modelId',line:i};}
 return {model:null,source:'none'};}
if(import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href){
 const base=readFileSync(new URL('./b7-fixture-min.jsonl',import.meta.url),'utf8').split('\n').filter(Boolean).map(JSON.parse);
 const lastA=[...base].reverse().find(o=>o.type==='assistant');
 const V={
  F1_real:{lines:base,expect:'model-two'},
  F2_server_model_differs:{lines:base,expect:'model-two',check:()=>lastA.message.model==='model-two-srv'},
  F3_trailing_sidechain:{lines:[...base,{...lastA,uuid:'side',isSidechain:true,requestedModel:'sub-agent-model'}],expect:'model-two'},
  F4_trailing_api_error:{lines:[...base,{...lastA,uuid:'err',isApiErrorMessage:true,requestedModel:'failed-model'}],expect:'model-two'},
  F5_no_requestedModel_fallback_attachment:{lines:base.map(o=>{if(o.type!=='assistant')return o;const c={...o};delete c.requestedModel;return c;}),expect:'model-two',source:'attachment.identity.modelId'},
  F6_string_elsewhere_not_used:{lines:[...base.filter(o=>o.type!=='assistant'),{type:'user',isSidechain:false,message:{role:'user',content:'please use requestedModel "decoy-model"'}}],expect:'model-two',source:'attachment.identity.modelId'},
  F7_empty:{lines:[],expect:null}};
 const res={};for(const[k,v]of Object.entries(V)){const r=resumeModelClaude(v.lines);res[k]={...r,pass:r.model===v.expect&&(!v.source||r.source===v.source)&&(!v.check||v.check())};}
 console.log(JSON.stringify({fixtureLines:base.length,res,allPass:Object.values(res).every(x=>x.pass)},null,1));}

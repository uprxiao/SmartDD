// Synthetic source-scoped configuration and immutable per-request facts only.
import {selectedConnections,availableConnections,validMailDays,projectIntegrationState,mailQueryWindow,mailSourceDiagnostic} from './integration-model.mjs';
export function capturePreviewMailQuery(state,projectId,scene='ready',now=new Date()){
 const source=selectedConnections(state,projectId,'mail').find(c=>c.kind==='local'),raw=source?(source.queryDays===undefined?(state.mailQueryDays??30):source.queryDays):(state.mailQueryDays??30),days=validMailDays(raw)?Number(raw):null,ready=!!source&&availableConnections(state,projectId).some(c=>c.id===source.id);
 const diagnostic=days===null?{state:'failed',title:'查询范围配置无效',reason:'请输入1–100之间的整数天数；未发起读取，也未扩大范围。'}:mailSourceDiagnostic(scene,ready,!!source);
 return {projectId,sourceId:source?.id??null,days,ready,scene,range:days===null?null:mailQueryWindow(days,now),diagnostic};
}
export function savePreviewMailDays(state,projectId,value,expectedSourceId){
 if(!validMailDays(value))return{ok:false,state,reason:'请输入1–100之间的整数天数；未更改配置。'};
 const source=selectedConnections(state,projectId,'mail').find(c=>c.kind==='local');if(!source)return{ok:false,state,reason:'请先为项目选择一个本地读取来源；未更改配置。'};
 if(expectedSourceId!==undefined&&source.id!==expectedSourceId)return{ok:false,state,reason:'项目读取来源已变化；未把原天数保存到其他来源。'};
 const days=Number(value);if(Number(source.queryDays)===days)return{ok:true,state};
 return{ok:true,state:projectIntegrationState({...state,connections:state.connections.map(c=>c.id===source.id?{...c,queryDays:days,revision:(c.revision||0)+1}:c)})};
}

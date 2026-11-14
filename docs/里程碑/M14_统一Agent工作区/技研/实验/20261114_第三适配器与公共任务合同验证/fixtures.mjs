import {randomUUID} from 'node:crypto';
import {claudeNormalizer,codexNormalizer,fixtureNormalizer} from '/private/tmp/willyou-m14-contract-probe/adapters.mjs';
const supported={state:'supported',reason:'fixture only'};
export function definition(id,protocol,control,trace){return {
 id,multiple:true,
 capabilities:profile=>({turns:supported,resume:supported,hostTools:supported,requests:supported,historyInject:protocol==='orbit'?{state:'unsupported',reason:'fixture has no injection'}:supported,inlineHistory:supported,...control.capabilities[profile.id]}),
 create:async(profile,{nativeId,workspace})=>{
  const native=nativeId??id+'-'+randomUUID(),accepted=[];
  trace.push({op:'create',id,profile:profile.id,revision:profile.revision,identity:profile.identity,model:profile.model,credentialRef:profile.credentialRef,nativeId:native,resume:!!nativeId,workspace});
  if(control.failCreate.has(profile.id))throw Error('FIXTURE_OPEN_FAILED');
  const runtime={nativeId:native,closed:false,normalize:protocol==='claude'?claudeNormalizer(accepted,native):protocol==='codex'?codexNormalizer(accepted,native):fixtureNormalizer,
   close:async()=>{runtime.closed=true;trace.push({op:'close',profile:profile.id,nativeId:native});},
   inject:async transfer=>{trace.push({op:'inject',profile:profile.id,nativeId:native,transfer:structuredClone(transfer)});return {state:control.transfer.get(profile.id)??'accepted'};},
   inline:async transfer=>{trace.push({op:'inline',profile:profile.id,nativeId:native,transfer:structuredClone(transfer)});return {state:control.inline.get(profile.id)??'accepted'};},
   start:async(input,emit)=>{
    if(runtime.closed)throw Error('CLOSED_RUNTIME');trace.push({op:'start',profile:profile.id,model:profile.model,nativeId:native,input:structuredClone(input)});
    if(control.submit.get(profile.id)==='unknown')return {state:'unknown'};
    accepted.push(input.id);const item=input.id+'.output',text=profile.id+':'+input.text;
    const frames=protocol==='claude'?[{type:'assistant',session_id:native,message:{id:item,content:[{type:'text',text}]}},{type:'result',session_id:native,user_message_uuid:input.id,is_error:false}]:protocol==='codex'?[{method:'item/completed',params:{threadId:native,item:{id:item,type:'agentMessage',text}}},{method:'turn/completed',params:{threadId:native,turn:{id:input.id,status:'completed'}}}]:[{op:'text',key:item,version:1,body:text,done:true},{op:'end',key:input.id}];
    for(const frame of frames)emit(frame);return {state:'accepted',outputId:item,text};
   }};
  await control.afterCreate?.(profile,runtime);return runtime;
 }
};}

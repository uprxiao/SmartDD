// Exact canonical reader reused from frozen T120/T125 Native proof; no source execution.
import assert from'node:assert/strict';
export function canonicalNativeUser({rows,cwd,nativeId,text,after=0}){assert(typeof text==='string'&&text.length>0&&Number.isFinite(after));const metas=rows.filter(r=>r.type==='session_meta').map(r=>r.payload);assert(metas.length<=1,'No ambiguous session metadata');const meta=metas[0];if(!meta||meta.cwd!==cwd||meta.id!==nativeId||meta.cli_version!=='0.166.0')return null;const matches=[];let currentTurnId;
 for(let i=0;i<rows.length;i++){const r=rows[i],p=r.payload??{};if(r.type==='event_msg'&&p.type==='task_started')currentTurnId=p.turn_id??r.turn_id;let message,form,role;
  if(r.type==='response_item'&&p.type==='message'&&p.role==='user'&&Array.isArray(p.content)&&p.content.length&&p.content.every(c=>c.type==='input_text'&&typeof c.text==='string')){message=p.content.map(c=>c.text).join('\n');form='response_item-user-input_text';role='user';}
  else if(r.type==='event_msg'&&p.type==='user_message'&&(p.role===undefined||p.role==='user')&&typeof p.message==='string'){message=p.message;form='event_msg-user_message';role='user';}
  if(message!==text||!form)continue;const at=Date.parse(r.timestamp);if(!Number.isFinite(at)||at<after)continue;matches.push({line:i+1,at:r.timestamp,nativeSessionId:meta.id,cwd:meta.cwd,cliVersion:meta.cli_version,provider:meta.model_provider,canonicalRole:role,sourceForm:form,turnId:p.turn_id??r.turn_id??currentTurnId??null,messageExact:true,textBytes:Buffer.byteLength(text)});
 }
 if(!matches.length)return null;
 if(matches.length>1){assert.equal(matches.length,2,'No duplicate actual user turns');assert(matches[0].turnId&&matches.every(m=>m.turnId===matches[0].turnId),'Dual carriers require same actual Native turn ID');assert.equal(new Set(matches.map(m=>m.sourceForm)).size,2,'Same carrier duplicate is not deduplicated');}
 return{...matches[0],canonicalMessageCount:1,sourceForms:matches.map(m=>m.sourceForm),aliasRows:matches.map(({line,at,sourceForm,turnId})=>({line,at,sourceForm,turnId}))};
}

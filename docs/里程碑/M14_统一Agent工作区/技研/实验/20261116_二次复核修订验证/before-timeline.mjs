// T1.0 research adapter. Not wired to production. Each instance owns its item map.
export const itemTypes = ['user_message','assistant_message','reasoning','proposed_plan',
  'todo_list','user_input_request','file_change','command_execution','file_search','web_search',
  'approval_request','checkpoint','run_interrupt_request','run_interrupt_result','system_notice',
  'error','compaction','handoff','provider_switch','subagent','tool_call'];
const codexItems = {userMessage:'user_message',agentMessage:'assistant_message',reasoning:'reasoning',
  plan:'proposed_plan',fileChange:'file_change',commandExecution:'command_execution',
  fileSearch:'file_search',webSearch:'web_search',contextCompaction:'compaction',
  collabAgentToolCall:'subagent',mcpToolCall:'tool_call',dynamicToolCall:'tool_call'};
const tools = {Bash:'command_execution',Write:'file_change',Edit:'file_change',MultiEdit:'file_change',
  Glob:'file_search',Grep:'file_search',Read:'file_search',WebSearch:'web_search',WebFetch:'web_search',
  TodoWrite:'todo_list',ExitPlanMode:'proposed_plan',AskUserQuestion:'user_input_request',Agent:'subagent',Task:'subagent'};
const diagnosticReasons = {
  'account/updated':'account metadata; account settings own the display',
  'remoteControl/status/changed':'remote control is outside the desktop task timeline',
  'thread/readState/changed':'read cursor, not a visible message',
  'turn/moderationMetadata':'internal moderation metadata; warnings/errors handled separately',
  'thread/goal/cleared':'goal bookkeeping; goal completion notice is a separate event',
};
export function normalizer(actor) {
  const items = new Map(); let ordinal = 0, currentTurn = actor, lastT = 0;
  function item(type, id, data, time, mode='replace', final=false) {
    const key = actor + ':' + id;
    const old = items.get(key);
    if (old?.final && mode === 'append') return {kind:'diagnostic', reason:'late delta after finalized item', id:key};
    const x = {kind:'item',type,id:key,ordinal:old?.ordinal ?? ++ordinal,
      revision:(old?.revision ?? 0)+1,turnId:currentTurn,actor,at:time,
      startedAt:old?.startedAt ?? time,final,
      text: mode==='append' ? (old?.text ?? '')+(data.text ?? '') : (data.text ?? old?.text ?? ''),
      data};
    items.set(key,x);return x;
  }
  return function(e) {
    const t=e.t ?? ++lastT, p=e.params ?? {}, raw=p.item, out=[];
    const emit=(type,id,data={},mode='replace',final=false)=>out.push(item(type,id,data,t,mode,final));
    const diagnostic=reason=>out.push({kind:'diagnostic',reason});
    const unmapped=reason=>out.push({kind:'unmapped',reason});
    const settle=(status,turnId=currentTurn)=>{
      for(const old of [...items.values()]) if(!old.final&&old.turnId===turnId&&!old.data?.background) {
        out.push(item(old.type,old.id.slice(actor.length+1),{...old.data,settledBy:status},t,'replace',true));
      }
    };
    if(e.driver==='host') {
      if(e.type==='process_exit'){settle('process_exit');out.push({kind:'turn',status:e.data?.confirmedTerminal??'failed'});}
      else if(itemTypes.includes(e.type)) emit(e.type,e.id,e.data,'replace',true);
      else unmapped('unknown host timeline type');
    } else if(e.driver==='codex') {
      if(p.turnId) currentTurn=p.turnId;
      if(e.method==='item/agentMessage/delta') emit('assistant_message',p.itemId,{text:p.delta},'append');
      else if(e.method==='item/reasoning/textDelta'||e.method==='item/reasoning/summaryTextDelta') emit('reasoning',p.itemId,{text:p.delta},'append');
      else if(e.method==='item/commandExecution/outputDelta') emit('command_execution',p.itemId,{text:p.delta},'append');
      else if(e.method==='item/started'||e.method==='item/completed') {
        const type=codexItems[raw?.type];
        if(!type) unmapped('unknown visible item '+raw?.type);
        else emit(type,raw.id,{...raw,text:raw.text ?? raw.output ?? raw.aggregatedOutput},'replace',e.method==='item/completed');
      } else if(/requestApproval$/.test(e.method ?? '')) emit('approval_request','request:'+e.id,{requestId:e.id,...p});
      else if(e.method==='item/tool/requestUserInput'||e.method==='mcpServer/elicitation/request') emit('user_input_request','request:'+e.id,{requestId:e.id,...p});
      else if(e.method==='serverRequest/resolved') out.push({kind:'request_resolved',requestId:p.requestId});
      else if(e.method==='turn/started') {currentTurn=p.turn.id;out.push({kind:'turn',status:'working',turnId:currentTurn,at:t});}
      else if(e.method==='turn/completed') {
        const err=p.turn.error; const limited=err?.codexErrorInfo==='usageLimitExceeded'||err?.code==='usage_limit';
        settle(p.turn.status,p.turn.id);
        out.push({kind:'turn',turnId:p.turn.id,status:limited?'limited':({completed:'completed',interrupted:'stopped',failed:'failed'}[p.turn.status]??'failed'),resetAt:err?.resetAt,at:t});
      } else if(e.method==='thread/tokenUsage/updated') out.push({kind:'usage',...p.tokenUsage,turnId:p.turnId});
      else if(e.method==='account/rateLimits/updated') out.push({kind:'limits',...p.rateLimits});
      else if(e.method==='thread/started') out.push({kind:'binding',nativeId:p.thread?.id});
      else if(e.method==='thread/status/changed') out.push({kind:'runtime_status',...p});
      else if(e.method==='turn/plan/updated') emit('todo_list','plan:'+currentTurn,p);
      else if(e.method==='error') emit('error','error:'+t,p,'replace',true);
      else if(['warning','configWarning','deprecationNotice','guardianWarning','hook/started','hook/completed','mcpServer/startupStatus/updated','item/autoApprovalReview/started','item/autoApprovalReview/completed'].includes(e.method)) {
        emit('system_notice',(p.run?.id ?? p.itemId ?? e.method)+':'+currentTurn,{notice:e.method,...p},'replace',!/started$/.test(e.method));
      } else if(diagnosticReasons[e.method]) diagnostic(diagnosticReasons[e.method]);
      else unmapped('unknown native method '+e.method);
    } else if(e.driver==='claude') {
      if(e.type==='assistant'||e.type==='user') {
        const content=e.message?.content;
        if(typeof content==='string') emit(e.type==='user'?'user_message':'assistant_message',e.uuid,{text:content},'replace',true);
        else for(const [i,b] of (content??[]).entries()) {
          if(b.type==='text'||b.type==='thinking') emit(b.type==='thinking'?'reasoning':e.type==='user'?'user_message':'assistant_message',e.uuid+':'+i,{text:b.text??b.thinking},'replace',true);
          else if(b.type==='tool_use') emit(tools[b.name]??'tool_call',b.id,{tool:b.name,input:b.input});
          else if(b.type==='tool_result') {
            const old=items.get(actor+':'+b.tool_use_id);
            emit(old?.type??'tool_call',b.tool_use_id,{result:b.content,error:b.is_error},'replace',true);
          } else unmapped('unknown Claude content block '+b.type);
        }
      } else if(e.type==='result') {
        settle(e.is_error?'failed':'completed');
        out.push({kind:'usage',...e.usage});
        out.push({kind:'turn',turnId:currentTurn,status:e.is_error?'failed':'completed',at:t,error:e.subtype});
      } else if(e.type==='system'&&e.subtype==='init') out.push({kind:'binding',nativeId:e.session_id,model:e.model});
      else if(e.type==='system'&&e.subtype==='thinking_tokens') out.push({kind:'usage',estimatedThinkingTokens:e.estimated_tokens,estimated:true});
      else if(e.type==='system'&&e.subtype==='compact_boundary') emit('compaction',e.uuid,e,'replace',true);
      else if(e.type==='stream_event') {
        const s=e.event;
        if(s.type==='content_block_delta') emit(s.delta?.thinking?'reasoning':'assistant_message',e.uuid+':'+s.index,{text:s.delta?.text??s.delta?.thinking??''},'append');
        else if(['message_start','message_delta','message_stop','content_block_start','content_block_stop'].includes(s.type)) out.push({kind:'stream_control',control:s.type});
        else unmapped('unknown Claude stream event '+s.type);
      } else if(e.type==='system') emit('system_notice',e.uuid,{notice:e.subtype},'replace',true);
      else unmapped('unknown Claude message '+e.type);
    } else if(e.driver==='acp') {
      const u=p.update;
      if(e.method==='session/update') {
        const type={agent_message_chunk:'assistant_message',user_message_chunk:'user_message',agent_thought_chunk:'reasoning',tool_call:'tool_call',tool_call_update:'tool_call',plan:'todo_list'}[u.sessionUpdate];
        if(type) emit(type,u.toolCallId??u.sessionUpdate+':'+currentTurn,{...u,text:u.content?.text},u.sessionUpdate.endsWith('_chunk')?'append':'replace',u.status==='completed');
        else if(['available_commands_update','config_option_update','current_mode_update','session_info_update','usage_update'].includes(u.sessionUpdate)) out.push({kind:'capabilities',update:u});
        else unmapped('unknown ACP update '+u.sessionUpdate);
      } else if(e.method==='session/request_permission') emit('approval_request','request:'+e.id,p);
      else if(e.method==='session/prompt') {emit('user_message','prompt:'+e.id,{text:p.prompt?.map(x=>x.text??'').join('')},'replace',true);out.push({kind:'turn',status:'working'});}
      else if(e.result?.stopReason) out.push({kind:'turn',status:e.result.stopReason==='cancelled'?'stopped':'completed'});
      else if(['initialize','session/new'].includes(e.method)||!e.method) diagnostic('ACP handshake/response metadata; binding and completion are separate');
      else unmapped('unknown ACP method '+e.method);
    } else unmapped('unknown driver '+e.driver);
    return out;
  };
}

// Work duration is the union of intervals, not the sum of overlapping calls.
export function workDuration(intervals) {
  let total=0,end=-Infinity;
  for(const [a,b] of [...intervals].sort((x,y)=>x[0]-y[0])) {total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
  return total;
}

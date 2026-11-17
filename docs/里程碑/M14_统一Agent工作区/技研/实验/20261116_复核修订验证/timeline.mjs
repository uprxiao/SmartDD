// T1.1 research adapter. Not wired to production. Each instance owns its item map.
export const itemTypes = ['user_message','assistant_message','reasoning','proposed_plan',
  'todo_list','user_input_request','file_change','command_execution','file_search','web_search',
  'approval_request','checkpoint','run_interrupt_request','run_interrupt_result','system_notice',
  'error','compaction','handoff','provider_switch','subagent','tool_call','notification','thread_created'];
const codexItems = {userMessage:'user_message',agentMessage:'assistant_message',reasoning:'reasoning',
  plan:'assistant_message',fileChange:'file_change',commandExecution:'command_execution',
  fileSearch:'file_search',webSearch:'web_search',contextCompaction:'compaction',
  collabAgentToolCall:'subagent',mcpToolCall:'tool_call',dynamicToolCall:'tool_call'};
const tools = {Bash:'command_execution',Write:'file_change',Edit:'file_change',MultiEdit:'file_change',
  Glob:'file_search',Grep:'file_search',Read:'file_search',WebSearch:'web_search',WebFetch:'web_search',
  TodoWrite:'todo_list',TaskCreate:'todo_list',TaskUpdate:'todo_list',TaskList:'todo_list',ExitPlanMode:'proposed_plan',AskUserQuestion:'user_input_request',Agent:'subagent',Task:'subagent'};
const diagnosticReasons = {
  'account/updated':'account metadata; account settings own the display',
  'remoteControl/status/changed':'remote control is outside the desktop task timeline',
  'thread/readState/changed':'read cursor, not a visible message',
  'turn/moderationMetadata':'internal moderation metadata; warnings/errors handled separately',
};
export function normalizer(actor) {
  const items = new Map(); let ordinal = 0, currentTurn = actor, lastT = 0;
  // RV06：Claude 任务清单按 taskId 聚合为一张 todo_list（TaskCreate 结果里的 task.id；TaskUpdate 的 taskId／status），TodoWrite 整体替换
  const todo = {tasks: new Map(), pendingCreate: new Map(), order: []};
  const TODO_TOOLS = new Set(['TaskCreate','TaskUpdate','TaskList','TodoWrite']);
  const todoUses = new Map();
  function item(type, id, data, time, mode='replace', final=false) {
    const nodeId=data.nodeId;
    const key = actor + ':' + (nodeId?nodeId+':':'') + id;
    const old = items.get(key);
    if (old?.final && mode === 'append') return {kind:'diagnostic', reason:'late delta after finalized item', id:key};
    const x = {kind:'item',type,id:key,ordinal:old?.ordinal ?? ++ordinal,
      revision:(old?.revision ?? 0)+1,turnId:currentTurn,actor,at:time,
      startedAt:old?.startedAt ?? time,final,nodeId,
      text: mode==='append' ? (old?.text ?? '')+(data.text ?? '') : (data.text ?? old?.text ?? ''),
      data};
    items.set(key,x);return x;
  }
  return function(e) {
    const t=e.t ?? ++lastT, p=e.params ?? {}, raw=p.item, out=[];
    const nodeId=e.driver==='claude'&&e.parent_tool_use_id?e.parent_tool_use_id:undefined;
    const emit=(type,id,data={},mode='replace',final=false)=>out.push(item(type,id,{...data,...(nodeId?{nodeId,parentToolUseId:nodeId}: {})},t,mode,final));
    const diagnostic=reason=>out.push({kind:'diagnostic',reason});
    const unmapped=reason=>out.push({kind:'unmapped',reason});
    const settle=(status,turnId=currentTurn)=>{
      for(const old of [...items.values()]) if(!old.final&&old.turnId===turnId&&!old.data?.background) {
        out.push(item(old.type,old.id.slice(actor.length+1+(old.nodeId?old.nodeId.length+1:0)),{...old.data,settledBy:status},t,'replace',true));
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
        // 需求 R02：Codex 不出计划卡。原生 plan 条目按普通回答显示并保留 nativeType 以便追溯（复核 AR04）；turn/plan/updated 是结构化任务清单，走 todo_list
        else emit(type,raw.id,{...raw,...(raw.type==='plan'?{nativeType:'plan'}:{}),text:raw.text ?? raw.output ?? raw.aggregatedOutput},'replace',e.method==='item/completed');
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
      else if(e.method==='thread/goal/updated') out.push({kind:'goal',status:p.goal?.status,objective:p.goal?.objective,timeUsedSeconds:p.goal?.timeUsedSeconds,tokensUsed:p.goal?.tokensUsed,source:'codex'});
      else if(e.method==='thread/goal/cleared') out.push({kind:'goal',cleared:true,source:'codex'});
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
          if(b.type==='text'&&e.type==='assistant'&&/^(Goal set: |Goal cleared: |No goal set|Goal active: )/.test(b.text??'')) {
            const t0=b.text; const m=/^Goal active: ([\s\S]+?) \((?:not yet evaluated|(\d+) turns?)\)/.exec(t0);
            out.push(t0.startsWith('Goal set: ')?{kind:'goal',status:'active',objective:t0.slice(10).trim(),source:'claude-text'}:m?{kind:'goal',status:'active',objective:m[1],turns:m[2]?Number(m[2]):0,source:'claude-text'}:{kind:'goal',cleared:true,source:'claude-text'});
          }
          else if(b.type==='text'||b.type==='thinking') emit(b.type==='thinking'?'reasoning':e.type==='user'?'user_message':'assistant_message',e.uuid+':'+i,{text:b.text??b.thinking},'replace',true);
          else if(b.type==='tool_use'&&TODO_TOOLS.has(b.name)) {
            todoUses.set(b.id,b);
            if(b.name==='TodoWrite') { todo.tasks.clear(); todo.order=[]; for(const [k,x] of (b.input?.todos??[]).entries()) { const id=String(x.id??k+1); todo.tasks.set(id,{id,subject:x.content??x.subject,status:x.status??'pending',activeForm:x.activeForm}); todo.order.push(id); } emit('todo_list','todo',{items:todo.order.map(id=>todo.tasks.get(id))}); }
            // TaskUpdate 只记期望值，等成功结果再改状态；失败保留原状态并显示错误（RR03）
          }
          else if(b.type==='tool_use') emit(tools[b.name]??'tool_call',b.id,{tool:b.name,input:b.input});
          else if(b.type==='tool_result'&&todoUses.has(b.tool_use_id)) {
            const use=todoUses.get(b.tool_use_id);
            if(use.name==='TaskCreate'&&!b.is_error) {
              const text=typeof b.content==='string'?b.content:JSON.stringify(b.content);
              const id=String(e.tool_use_result?.task?.id ?? (/Task #(\d+)/.exec(text)??[])[1] ?? b.tool_use_id);
              todo.tasks.set(id,{id,subject:use.input?.subject,status:'pending',activeForm:use.input?.activeForm}); if(!todo.order.includes(id)) todo.order.push(id);
              emit('todo_list','todo',{items:todo.order.map(k=>todo.tasks.get(k))});
            } else if(use.name==='TaskUpdate') {
              const id=String(e.tool_use_result?.taskId ?? use.input?.taskId); const old=todo.tasks.get(id)??{id};
              const text=typeof b.content==='string'?b.content:JSON.stringify(b.content);
              if(b.is_error||e.tool_use_result?.success===false) todo.tasks.set(id,{...old,lastError:{requested:use.input?.status,message:text.slice(0,200)}});
              else { const to=e.tool_use_result?.statusChange?.to ?? use.input?.status; const {lastError,...rest}=old; todo.tasks.set(id,{...rest,...(to?{status:to}:{}),...(use.input?.subject?{subject:use.input.subject}:{})}); }
              if(!todo.order.includes(id)) todo.order.push(id);
              emit('todo_list','todo',{items:todo.order.map(k=>todo.tasks.get(k))});
            } else diagnostic('task-list tool result folded into todo_list');
          }
          else if(b.type==='tool_result') {
            const old=items.get(actor+':'+(nodeId?nodeId+':':'')+b.tool_use_id);
            emit(old?.type??'tool_call',b.tool_use_id,{result:b.content,error:b.is_error},'replace',true);
          } else unmapped('unknown Claude content block '+b.type);
        }
      } else if(e.type==='result'&&nodeId) {
        emit('notification','child-result:'+e.uuid,{status:e.is_error?'failed':'completed',text:e.result},'replace',true);
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
      else if(e.result?.stopReason) {
        const reason=e.result.stopReason,status={end_turn:'completed',cancelled:'stopped',max_turn_requests:'failed',refusal:'failed',max_tokens:'limited'}[reason]??'failed';
        settle(status);out.push({kind:'turn',status,reason,...(reason==='max_tokens'?{limitKind:'output_tokens',automaticRetry:false}: {})});
      }
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

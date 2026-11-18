import { SCENARIOS } from '../../../prototypes/m6-codex/src/m14-model.mjs';

export const scenes=SCENARIOS;
export const projectTitle='M14 状态对照';
export const sizes=[['light','ylight',1440,900],['dark','ydark',1440,900],['narrow','ylight',950,780]];

// Serialized into the exact isolated App process for fixture setup only.
export function seed(db, fixture) {
 const stamp=new Date().toISOString();
 const turn=db.prepare(`INSERT INTO agent_turns
   (turn_id,task_id,input_ref,client_input_id,source_kind,status,accepted_at,started_at,ended_at,error_code)
   VALUES(?,?,?,?,'user',?,?,?,?,?)`);
 const item=db.prepare(`INSERT INTO agent_items
   (item_id,task_id,turn_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at)
   VALUES(?,?,?,?,?,1,?,?,?,?,?)`);
 const addRequest=db.prepare(`INSERT INTO agent_requests
   (request_id,task_id,class,kind,origin_json,payload_ref,status,created_at,updated_at)
   VALUES(?,?,?,?,?,?,'pending',?,?)`);
 const addChange=db.prepare(`INSERT INTO agent_turn_changes
   (turn_id,task_id,status,changed_files_json,incomplete_reason,before_ref,after_ref) VALUES(?,?,?,?,?,?,?)`);
 const states={live:'started',done:'completed',failed:'failed',limited:'failed',stopped:'interrupted',unknown:'unknown'};
 const toolTypes={thought:'reasoning',message:'assistant_message',command:'command_execution',read:'file_search',edit:'file_change',created:'file_change',tool:'tool_call',native:'subagent',sysnote:'system_notice',notice:'system_notice',error:'error',plan:'proposed_plan',todo:'todo_list',compaction:'compaction'};
 const json=JSON.stringify;
 const idFor=(task,id)=>task+'-'+id;
 const addQueue=db.prepare("INSERT INTO agent_directory_queue(queue_id,directory_identity,task_id,kind,state,accepted_order,created_at) VALUES(?,?,?,'write',?,?,?)");
 let queueOrder=0;
 function request(scene,task,turnId) {
  if(!scene.pending)return;
  const entries=scene.turns.flatMap(t=>t.entries??[]);
  const approval=entries.find(e=>e.kind==='approval');
  const plan=entries.find(e=>e.kind==='plan');
  const fields=Object.fromEntries(entries.find(e=>e.kind==='business')?.fields??[]);
  const mailContent={mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[fields['收件人']],cc:[],bcc:[],subject:fields['主题'],text:fields['正文'],html:null,inReplyTo:null,references:[],attachmentIds:[]};
  const mailId='6b1a7015-61d8-4cc7-96d4-c3b8585a430b', draftId='6b1a7015-61d8-4cc7-96d4-c3b8585a430a';
  const mailReview={schema:'willyou-mail-send-v1',intentId:mailId,projectId:fixture.projectId,sourceTaskId:task,sourceRunId:'fixture-run',draftId,draftRevision:1,draftContentHash:'a'.repeat(64),connectionId:'6b1a7015-61d8-4cc7-96d4-c3b8585a430c',identityRevision:1,configRevision:1,policyRevision:1,bindingRevision:1,identityHash:'b'.repeat(64),smtpConfigHash:'c'.repeat(64),fromAddress:fields['发件账号']?.split('（')[0],content:mailContent,attachments:[],rawHash:'d'.repeat(64),frozenHash:'e'.repeat(64),messageId:'<m14-fixture@example.invalid>',priorUnknownExecutionIds:[],reviewHash:'f'.repeat(64)};
  const page={id:'fixture-document',url:scene.access?.pageUrl};
  const browserTarget={projectId:fixture.projectId,pages:[page]};
  const config={
   approval:['native','command_approval',{params:{command:approval?.command,cwd:fixture.cwd,reason:approval?.reason}}],
   question:['native','user_input',{params:{questions:[{id:'format',question:scene.question?.title,options:scene.question?.options.map(([label,description])=>({label,description})),isOther:true}]}}],
   business:['host_business','host_business',{businessKind:'mail_send',phase:'waiting_user',title:'需要批准：发送邮件',review:mailReview,data:{entry:'mcp',call:{operation:'mail_send_execute',arguments:{intentId:mailId,expectedReviewHash:mailReview.reviewHash}},requestId:'fixture-mail',originCallHash:'0'.repeat(64),policyStamp:'1'.repeat(64),mailIntentId:mailId},options:[{label:'批准发送',value:'allow'},{label:'手动修改',value:'edit'},{label:'让 Agent 按我的说明修改',value:'agentedit'}]}],
   access:['host_business','host_business',{businessKind:'browser_access',phase:'waiting_user',title:'跨任务浏览器授权',review:{requester:task,targetTaskId:fixture.browserTarget,mode:'control',pages:browserTarget.pages},data:{targetTaskId:fixture.browserTarget,mode:'control',target:browserTarget},options:[{label:'允许观察',value:'observe'},{label:'允许控制',value:'control'}]}],
   plan:['native','plan_approval',{input:{plan:plan?.steps?.join('\n')}}],
  };
  const [cls,kind,payload]=config[scene.pending];
  addRequest.run(idFor(task,'request'),task,cls,kind,json({taskId:task,turnId}),json(payload),stamp,stamp);
 }
 function writeHistory(task,scene,children=[]) {
  let ordinal=0;
  const add=(turnId,type,payload,live=false,nodeId=null)=>{
   const key=idFor(task,++ordinal);
   item.run(key,task,turnId,type,ordinal,key,json(payload),live?null:'completed',stamp,stamp);
   if(nodeId)db.prepare('UPDATE agent_items SET node_id=? WHERE item_id=?').run(nodeId,key);
  };
  for(const [n,t] of scene.turns.entries()){
   const turnId=idFor(task,t.id), start=new Date(Date.now()-(t.elapsed??26)*1000).toISOString();
   const status=t.user?.failed?'failed':scene.id==='starting'?'dispatching':states[t.state]??'completed';
   turn.run(turnId,task,json({text:t.user?.text??''}),turnId,status,start,t.user?.failed?null:start,t.state==='live'?null:stamp,t.user?.failed?'REJECTED':t.state==='unknown'?'RESULT_UNKNOWN':null);
   if(t.switchBefore){
    add(turnId,'provider_switch',{from:t.switchBefore.from,to:t.switchBefore.to});
    add(turnId,'handoff',{kind:t.switchBefore.mode==='delta'?'incremental':'full',text:t.switchBefore.covered,omissions:t.switchBefore.omitted==='无'?[]:[t.switchBefore.omitted]});
   }
   if(t.user)add(turnId,'user_message',{text:t.user.text.replaceAll('/workspace/SmartDD',fixture.cwd),attachments:t.user.attachments});
   for(const e of t.entries??[]){
    const type=toolTypes[e.kind];
    if(!type)continue;
    const payload={
     text:e.lines?.join('\n\n')??e.text,phase:e.kind==='message'?'commentary':undefined,
     name:e.title??e.tool??e.name,command:e.cmd,cwd:fixture.cwd,output:e.output,
     status:e.kind==='native'?e.state:e.live?'running':'completed',input:{file_path:e.path,description:e.title},
     description:e.title,severity:e.level==='warn'?'warning':e.level,title:e.title??(e.kind==='sysnote'||e.kind==='notice'?e.text:undefined),nativeNodeIds:e.kind==='native'?['fixture-node']:undefined,childLog:e.kind==='native'?e.steps:undefined,
     plan:e.steps?.join('\n'),detail:e.detail??e.text,message:e.detail??e.title,
     entries:e.items?.map(([content,state],i)=>({id:String(i),subject:content,status:state==='done'?'completed':state==='doing'?'in_progress':'pending'})),
    };
    add(turnId,type,payload,!!e.live||e.kind==='native'&&e.state==='running');
    if(e.kind==='native')for(const step of e.steps??[])add(null,'subagent_message',{text:step},false,'fixture-node');
   }
   if(t.final?.length&&!t.streaming)add(turnId,'assistant_message',{text:t.final.join('\n\n').replaceAll('/workspace/SmartDD',fixture.cwd)});
   if(t.length)add(turnId,'error',{message:'已达到输出长度上限',limited:{kind:'output'}});
   if(t.user?.failed)add(turnId,'error',{message:t.user.failed});
   if(t.state==='limited')add(turnId,'error',{message:'已达到使用额度',limited:{kind:'usage',resetAt:scene.limit?.resetAt}});
   if(t.changes){
    const actualRefs=fixture.snapshots?.[scene.id];
    const refs=n===0?actualRefs:null;
    const changeStatus=t.diffState?.kind==='preparing'?'capturing':t.diffState?.kind==='incomplete'?'incomplete':t.diffState||!t.changes.length?'none':'complete';
    const reason=t.diffState?.note??(t.diffState?.kind==='reclaimed'?'快照已清理（空间回收）':t.diffState?.kind==='storage-full'?'影子库空间已满':null);
    const files=t.changes.map(file=>({path:file.path,added:file.add??null,removed:file.del??null,binary:!!file.bin||!!file.binary}));
    addChange.run(turnId,task,changeStatus,json(files),reason,refs?.[0]??null,refs?.[1]??null);
    add(turnId,'files_changed',{turnId,status:changeStatus,reason,fileCount:files.length});
   }
  }
  if(scene.queued)for(const q of scene.queued){
   const id=idFor(task,q.id);
   turn.run(id,task,json({text:q.text}),id,'accepted',stamp,null,null,null);
   add(id,'user_message',{text:q.text});
   db.prepare('UPDATE agent_items SET native_key=? WHERE turn_id=? AND type=?').run('input:'+id,id,'user_message');
  }
  const goal=scene.turns.flatMap(t=>t.entries??[]).find(e=>e.kind==='goal');
  if(goal){
   const binding=idFor(task,'binding'),driver=goal.agent==='claude'?'claude-sdk':'codex-app-server';
   db.prepare(`INSERT INTO agent_bindings(binding_id,task_id,driver_id,profile_id,continuation_hash,state_root,cwd_identity,created_at)
     VALUES(?,?,?,?,?,?,?,?)`).run(binding,task,driver,'fixture-ui',task.replaceAll('-','').repeat(2),fixture.cwd,fixture.cwd,stamp);
   db.prepare(`INSERT INTO agent_goals(task_id,binding_id,objective,status,paused_reason,turns,time_used_s,updated_at)
     VALUES(?,?,?,?,?,?,?,?)`).run(task,binding,goal.objective,goal.status==='waiting-children'?'paused':goal.status,goal.status==='waiting-children'?'waiting_children':null,goal.turns,goal.secs,stamp);
   if(goal.agent==='claude')db.prepare("UPDATE agent_tasks SET selection_json=json_set(selection_json,'$.driverId','claude-sdk') WHERE task_id=?").run(task);
  }
  const finalTurn=scene.turns.at(-1)?.id;
  if(scene.id==='plan')db.prepare("UPDATE agent_tasks SET selection_json=json_set(selection_json,'$.driverId','claude-sdk') WHERE task_id=?").run(task);
  request(scene,task,finalTurn?idFor(task,finalTurn):null);
  const identity=fixture.cwd+':'+scene.id;
  if(children.some(({child})=>child.state==='queued'&&!child.branch))addQueue.run(task,identity,task,'active',++queueOrder,stamp);
  for(const {id,child} of children){
   const delivered=child.state==='done'||scene.status==='done'||scene.id==='merge-check';
   const strategy=child.branch?'git':'serial';
   const target={title:child.title,profile:{name:child.target},strategy,directoryIdentity:identity,...(scene.id==='merge-check'?{mergeFailures:2}:{})};
   db.prepare('UPDATE agent_tasks SET parent_task_id=? WHERE task_id=?').run(task,id);
   db.prepare(`INSERT INTO agent_delegations(delegation_id,parent_task_id,child_task_id,target_json,access,request_key,delivery_state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id,task,id,json(target),child.access==='只读'?'read':'write',id,delivered?'delivered':child.state==='queued'?'queued':'running',stamp,stamp);
   const attempt=child.turns?.length??1;
   if(child.state==='queued'&&!child.branch)addQueue.run(id,identity,id,'queued',++queueOrder,stamp);
   db.prepare(`INSERT INTO agent_delegation_attempts(attempt_id,delegation_id,ordinal,kind,input_ref,created_at,merge_check_json)
      VALUES(?,?,?,?,'{}',?,?)`).run(id,id,attempt,attempt>1?'rework':'initial',stamp,scene.id==='merge-check'?json({pass:false,reason:'合成冲突'}):scene.id==='team-done'&&child.branch?json({pass:true}):null);
   if(child.branch)db.prepare(`INSERT INTO agent_workspaces(workspace_id,task_id,child_task_id,kind,repo_root,path,branch,state,created_at,updated_at)
      VALUES(?,?,?,'git_worktree',?,?,?,'ready',?,?)`).run(id,task,id,fixture.cwd,fixture.worktrees[id],child.branch,stamp,stamp);
   writeHistory(id,{turns:child.turns??[]});
   const childTurn=child.turns?.at(-1)?.id;
   if(childTurn)db.prepare('UPDATE agent_delegation_attempts SET child_turn_id=? WHERE attempt_id=?').run(idFor(id,childTurn),id);
   if(child.approval)addRequest.run(idFor(id,'request'),id,'native','command_approval',json({taskId:id,turnId:childTurn?idFor(id,childTurn):null}),json({params:{...child.approval,cwd:fixture.cwd}}),stamp,stamp);
   add(finalTurn?idFor(task,finalTurn):null,'subtask',{childTaskId:id,title:child.title,profileName:child.target,status:delivered?'delivered':'running',workspaceMode:strategy==='git'?'worktree':'shared',access:child.access==='只读'?'read':'write'});
  }
 }
 db.transaction(()=>{
  for(const {id,scene,children} of fixture.tasks)writeHistory(id,scene,children);
  db.prepare('UPDATE agent_tasks SET archived_at=? WHERE task_id=?').run(stamp,fixture.archived);
  addRequest.run(fixture.blocker,fixture.blocker,'native','command_approval',json({taskId:fixture.blocker}),json({params:{command:'fixture'}}),stamp,stamp);
 })();
}

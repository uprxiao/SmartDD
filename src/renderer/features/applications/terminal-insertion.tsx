import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {agentTasksStore} from '@renderer/core/agent-tasks-store';
import {agentComposerTargets} from '@renderer/features/agent-tasks/composer-target';
import {observer} from 'mobx-react-lite';
import {ArrowUpRight,SquareTerminal} from 'lucide-react';
import {APPLICATION_SKILL_EXAMPLES,type ApplicationTerminalSource,type ApplicationTerminalBinding} from '@shared/application-terminal';
import {TERMINAL_CONTEXT_LIMITS,type TerminalTarget} from '@shared/file-terminal';
import {rpc} from '@renderer/lib/ipc';
import {navigation} from '@renderer/core/navigation';
import {tasksStore} from '@renderer/core/tasks-store';
import {currentFileTerminal} from '@renderer/features/files/terminal-context/store';
import {unwrap} from './api';
/** A detail retains its explicitly selected target. It never searches running tasks for a replacement. */
const LegacyApplicationTerminalButton=observer(function LegacyApplicationTerminalButton({projectId,source,onInserted,disabled=false,label='插入终端引用',compact=false,variant='default',target:explicitTarget}:{projectId:string;source:ApplicationTerminalSource;onInserted?:()=>void;disabled?:boolean;label?:string;compact?:boolean;variant?:'default'|'example';target?:TerminalTarget}){
 const [target]=useState(()=>{if(explicitTarget)return{...explicitTarget};const task=tasksStore.current;return task&&task.projectId===projectId&&task.ptyId&&task.archivedAt===null&&tasksStore.terminals.get(task.id)===task.ptyId?{taskId:task.id,ptyId:task.ptyId}:null;}),[state,setState]=useState<'idle'|'inserting'|'inserted'|'failed'|'unknown'>('idle'),[notice,setNotice]=useState('');
 const live=useRef(true),busy=useRef(false),binding=useRef<ApplicationTerminalBinding|null>(null),sourceKey=JSON.stringify(source),initialSource=useRef(sourceKey),epoch=useRef(0);
 const selected=explicitTarget?tasksStore.byId.get(explicitTarget.taskId):tasksStore.current,current=!!target&&selected?.id===target.taskId&&selected.projectId===projectId&&selected.ptyId===target.ptyId&&selected.archivedAt===null&&tasksStore.terminals.get(target.taskId)===target.ptyId&&sourceKey===initialSource.current&&(!explicitTarget||explicitTarget.taskId===target.taskId&&explicitTarget.ptyId===target.ptyId);
 const currentRef=useRef(current);currentRef.current=current;
 const release=()=>{const value=binding.current;binding.current=null;if(value)void rpc.applications.terminalRelease(value.id).catch(()=>{});};
 useEffect(()=>{live.current=true;return()=>{live.current=false;epoch.current++;release();};},[]);
 useEffect(()=>{if(!current){epoch.current++;release();if(busy.current){setState('unknown');setNotice('目标已变化；原投递结果待核实，不会自动重发');}}},[current]);
 const insert=async()=>{
  if(!current||disabled||busy.current||state==='unknown'||state==='inserted'||!target)return;busy.current=true;const sequence=++epoch.current;setState('inserting');setNotice('正在插入终端输入…');let dispatched=false,timer:ReturnType<typeof setTimeout>|undefined;
  const active=()=>live.current&&currentRef.current&&epoch.current===sequence;
  try{const prepared=unwrap(await rpc.applications.terminalBind({projectId,target,source}));if(!active()){void rpc.applications.terminalRelease(prepared.id).catch(()=>{});return;}binding.current=prepared;
   timer=setTimeout(()=>{if(active()){setState('unknown');setNotice('插入结果未知；尚未收到确认，不会自动重发');}},TERMINAL_CONTEXT_LIMITS.acknowledgementMs);
   const operationId=crypto.randomUUID();dispatched=true;const reply=await rpc.applications.terminalInsert({bindingId:prepared.id,operationId});if(!active())return;
   // This endpoint wraps every started native write in a receipt. A typed
   // rejection here is a host guard failure before dispatch, not a lost reply.
   if(!reply.ok){setState('failed');setNotice(reply.message);return;}const receipt=reply.value;
   if(receipt.operationId!==operationId)throw new Error('终端回执与本次引用不匹配');if(receipt.state!=='inserted'){setState(receipt.state);setNotice(receipt.message);return;}
   setState('inserted');setNotice('已插入终端输入，尚未提交');onInserted?.();navigation.openTask(target.taskId);
   // React must unmount the modal and finish restoring its trigger first.
   // Focusing the terminal while the modal is open is rejected by the browser.
   for(let i=0;i<30;i++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(navigation.currentViewId!=='task'||navigation.currentTaskId!==target.taskId||tasksStore.current?.ptyId!==target.ptyId)break;if(document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"]'))continue;const terminal=currentFileTerminal();if(terminal?.taskId===target.taskId&&terminal.ptyId===target.ptyId){terminal.focus();break;}}
  }catch(error){if(active()){setState(dispatched?'unknown':'failed');setNotice(dispatched?'插入结果未知；不会自动重发':error instanceof Error?error.message:'引用未插入');}}
  finally{clearTimeout(timer);release();busy.current=false;}
 };
 const example=source.kind==='skill'?APPLICATION_SKILL_EXAMPLES[source.appId+':'+source.skillId]:null;
 if(variant==='example'&&example&&!compact){
  const prepare=!current||disabled,action=prepare?'准备新任务':state==='inserting'?'正在插入…':label;
  return <div className="m10-terminal-insertion m10-session-example"><button className="m10-example" aria-label={action} disabled={!prepare&&(!current||disabled||state==='inserting'||state==='unknown'||state==='inserted')} onClick={()=>{if(prepare)navigation.prepareApplicationTask(projectId,example);else void insert();}}><span>“{example}”</span>{prepare&&<small className="m10-example-action">准备新任务</small>}<ArrowUpRight size={13}/></button><small className="m10-muted">{prepare?'前往本项目的新任务输入；原会话保留，不自动开始。':`目标：${selected?.title} · 仅插入，不自动回车`}</small>{notice&&<p className="m10-note" role="status">{notice}</p>}</div>;
 }

 return <div className="m10-terminal-insertion">{example&&!compact&&<p className="m10-muted">“{example}”</p>}
 {example&&(!current||disabled)?<button className="m10-button secondary" onClick={()=>navigation.prepareApplicationTask(projectId,example)}>{compact&&<SquareTerminal size={14}/>} {compact?label:'准备新任务'}{!compact&&<ArrowUpRight size={13}/>}</button>:<button className="m10-button secondary" disabled={!current||disabled||state==='inserting'||state==='unknown'||state==='inserted'} onClick={()=>void insert()}>{compact&&<SquareTerminal size={14}/>} {state==='inserting'?'正在插入…':label}{!compact&&<ArrowUpRight size={13}/>}</button>}
 {!compact&&<small className="m10-muted">{current&&!disabled?`目标：${selected?.title} · 仅插入，不自动回车`:'请先在本项目打开一个运行中的终端；不会自动选择其他任务。'}</small>}{notice&&<p className="m10-note" role="status">{notice}</p>}</div>;
});

const AgentReferenceButton=observer(function AgentReferenceButton({taskId,...props}:ComponentProps<typeof LegacyApplicationTerminalButton>&{taskId:string}){
 const [state,setState]=useState<'idle'|'busy'|'done'|'failed'>('idle'),[notice,setNotice]=useState('');const live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const task=agentTasksStore.tasks.find(t=>t.taskId===taskId),valid=task?.projectId===props.projectId;
 const insert=async()=>{if(!valid||pending.current||state==='done')return;pending.current=true;setState('busy');setNotice('正在核对原引用…');const selected=navigation.currentAgentTaskId;
  try{const value=await rpc.agentTasks.applicationReference(taskId,props.source);if(!live.current)return;if(navigation.currentAgentTaskId!==selected||value.taskId!==taskId||value.projectId!==props.projectId)throw Error('目标已变化，引用未插入');navigation.openAgentTask(taskId);
   let target=agentComposerTargets.current;for(let i=0;i<60&&target?.taskId!==taskId;i++){await new Promise<void>(r=>requestAnimationFrame(()=>r()));if(navigation.currentAgentTaskId!==taskId)throw Error('目标任务已切换，引用未插入');target=agentComposerTargets.current;}
   if(!target||target.taskId!==taskId||target.projectId!==props.projectId)throw Error('目标输入框尚不可用，引用未插入');target.insert(value.text);setState('done');setNotice('已插入任务草稿，尚未发送');props.onInserted?.();
  }catch(e){if(live.current){setState('failed');setNotice(e instanceof Error?e.message:String(e));}}finally{pending.current=false;}
 };
 return <div className="m10-terminal-insertion"><button type="button" className="m10-button secondary" disabled={!valid||props.disabled||state==='busy'||state==='done'} onClick={()=>void insert()}>{state==='busy'?'正在核对…':props.label??'插入任务引用'}</button>{!props.compact&&<small className="m10-muted">目标：{task?.title??'任务不可用'} · 仅插入草稿，不自动发送</small>}{notice&&<p role="status">{notice}</p>}</div>;
});
export const ApplicationTerminalButton=observer(function ApplicationTerminalButton(props:ComponentProps<typeof LegacyApplicationTerminalButton>&{agentTaskId?:string}){
 const [agentTaskId]=useState(()=>props.agentTaskId??(!props.target&&agentTasksStore.enabled?agentTasksStore.tasks.find(t=>t.taskId===(navigation.currentViewId==='agentTask'?navigation.currentAgentTaskId:navigation.applicationAgentTaskId)&&t.projectId===props.projectId)?.taskId:null));
 return agentTaskId?<AgentReferenceButton {...props} taskId={agentTaskId}/>:<LegacyApplicationTerminalButton {...props}/>;
});

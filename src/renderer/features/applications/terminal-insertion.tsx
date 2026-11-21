import {useEffect,useRef,useState} from 'react';
import {agentTasksStore} from '@renderer/core/agent-tasks-store';
import {agentComposerTargets} from '@renderer/features/agent-tasks/composer-target';
import {observer} from 'mobx-react-lite';
import {when} from 'mobx';
import {ArrowUpRight,SquareTerminal} from 'lucide-react';
import {toast} from 'sonner';
import {APPLICATION_SKILL_EXAMPLES,type ApplicationTerminalSource} from '@shared/application-terminal';
import {rpc} from '@renderer/lib/ipc';
import {navigation} from '@renderer/core/navigation';
interface ReferenceProps {
  projectId: string;
  source: ApplicationTerminalSource;
  onInserted?: () => void;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
  variant?: 'default' | 'example';
  agentTaskId?: string;
}

const AgentReferenceButton=observer(function AgentReferenceButton({taskId,...props}:ReferenceProps&{taskId:string}){
 const [state,setState]=useState<'idle'|'busy'|'done'|'failed'>('idle'),[notice,setNotice]=useState('');const live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const task=agentTasksStore.tasks.find(t=>t.taskId===taskId),valid=task?.projectId===props.projectId;
 const insert=async()=>{
  if(!valid||pending.current||state==='done')return;
  pending.current=true;setState('busy');setNotice('正在核对原引用…');
  const selected=navigation.currentAgentTaskId, sourceView=navigation.currentViewId;
  let navigated=false;
  const stillAtTarget=()=>navigation.currentViewId==='agentTask'&&navigation.currentAgentTaskId===taskId;
  const matchedComposer=()=>{
   const target=agentComposerTargets.current;
   return target?.taskId===taskId&&target.projectId===props.projectId ? target : null;
  };
  try{
   const value=await rpc.agentTasks.applicationReference(taskId,props.source);
   if(!live.current)return;
   if(navigation.currentAgentTaskId!==selected||navigation.currentViewId!==sourceView||value.taskId!==taskId||value.projectId!==props.projectId)throw Error('目标已变化，引用未插入');
   navigation.openAgentTask(taskId);
   navigated=true;
   await when(()=>!stillAtTarget()||matchedComposer()!==null,{timeout:5000}).catch(()=>{});
   if(!stillAtTarget())throw Error('目标任务已切换，引用未插入');
   const target=matchedComposer();
   if(!target)throw Error('目标输入框尚不可用，引用未插入');
   target.insert(value.text);
   if(live.current){setState('done');setNotice('已插入任务草稿，尚未发送');}
   props.onInserted?.();
  }catch(e){
   const message=e instanceof Error?e.message:String(e);
   if(live.current){setState('failed');setNotice(message);}
   if(navigated)toast.error(message);
  }finally{pending.current=false;}
 };
 return <div className="m10-terminal-insertion"><button type="button" className="m10-button secondary" disabled={!valid||props.disabled||state==='busy'||state==='done'} onClick={()=>void insert()}>{state==='busy'?'正在核对…':props.label??'插入任务引用'}</button>{!props.compact&&<small className="m10-muted">目标：{task?.title??'任务不可用'} · 仅插入草稿，不自动发送</small>}{notice&&<p role="status">{notice}</p>}</div>;
});
export const ApplicationTerminalButton=observer(function ApplicationTerminalButton(props:ReferenceProps){
 const [agentTaskId]=useState(()=>props.agentTaskId??agentTasksStore.tasks.find(task=>
  task.taskId===(navigation.currentViewId==='agentTask'?navigation.currentAgentTaskId:navigation.applicationAgentTaskId)&&task.projectId===props.projectId
 )?.taskId);
 if(agentTaskId)return <AgentReferenceButton {...props} taskId={agentTaskId}/>;
 const example=props.source.kind==='skill'?APPLICATION_SKILL_EXAMPLES[props.source.appId+':'+props.source.skillId]:null;
 if(example){
  const prepare=()=>navigation.prepareApplicationTask(props.projectId,example);
  if(props.variant==='example'&&!props.compact)return <div className="m10-terminal-insertion m10-session-example"><button type="button" className="m10-example" aria-label="准备新任务" onClick={prepare}><span>“{example}”</span><small className="m10-example-action">准备新任务</small><ArrowUpRight size={13}/></button><small className="m10-muted">前往本项目的新任务输入，不自动开始。</small></div>;
  return <div className="m10-terminal-insertion"><button type="button" className="m10-button secondary" onClick={prepare}>{props.compact&&<SquareTerminal size={14}/>} {props.compact?props.label:'准备新任务'}{!props.compact&&<ArrowUpRight size={13}/>}</button></div>;
 }
 return <div className="m10-terminal-insertion"><button type="button" className="m10-button secondary" disabled>{props.label??'插入任务引用'}</button>{!props.compact&&<small className="m10-muted">请先打开本项目的目标任务。</small>}</div>;
});
